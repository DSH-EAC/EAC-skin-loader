/**
 * 皮肤自动补齐器（docs/git-distribution.md §3.4，计划 §四.2/§四.3）。
 *
 * 运行位置：加载器 host 半（Node 侧）——下载、校验、安装都是宿主能力，client 半（浏览器）
 * 无文件系统/网络安装面。它复用宿主 `pluginManager` 服务安装缺失皮肤（**不自行执行 pnpm、
 * 不直写 profile 清单**），状态持久化在加载器自有 settings 命名空间的 `provisioning`
 * volatile 字段（与 activeSkin 激活事实严格分字段，互不触碰）。
 *
 * 纪律（计划 §四.2 安全要求，逐条落实见各函数注释）：
 * - 下载来源只来自清单（运行期不接受任何外部 URL）；缓存文件名由包名派生并做字符集白名单；
 * - 实际字节数 + SHA256 双校验，先写 `.part` 临时文件、校验通过后原子改名；
 * - 超时、每制品有限重试、模块级单例防重复任务；
 * - 网络失败绝不阻断加载器启动（run 全程异步 + catch 包裹）；
 * - 兼容/构建审批错误如实透传，不自动绕过、不无限重试；
 * - **不调用任何皮肤切换操作**（activeSkin 不因补齐改变）；新装皮肤由宿主 installBundle
 *   自动 select 启用 → 皮肤经 `registerSkin` 完成登记（公约 R1）。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Dsh017PluginManagerService, Dsh017SettingsService } from "../adapter/dsh-0.1.7-host.ts";
import type { Disposer, Logger } from "../protocol.ts";
import { SETTINGS_NAMESPACE } from "../protocol.ts";
import { defaultTimers, raceTimeout, type Timers } from "../client/runtime/clock.ts";
import {
  emptyProvisioningState,
  readProvisioningState,
  toSettingsPatch,
  type ProvisioningItemState,
  type ProvisioningState,
} from "./provisioning-state.ts";
import type { SkinArtifact, SkinsManifest } from "./skins-manifest.ts";

/** 补齐器可调依赖（全部可注入，node --test 用 fake 顶替）。 */
export interface SkinProvisionerOptions {
  /** 固定版本皮肤制品清单（已通过 parseSkinsManifest 校验）。 */
  manifest: SkinsManifest;
  /** 宿主插件管理服务（安装/状态查询）。 */
  pluginManager: Dsh017PluginManagerService;
  /** host 侧 settings 服务（状态读取 + 落盘）。 */
  settings: Dsh017SettingsService;
  /** settings 命名空间（缺省公约保留面）。 */
  namespace?: string;
  /** 下载缓存目录（缺省 OS 临时目录下的加载器专属目录）。 */
  cacheDir?: URL;
  /** 结构化 logger。 */
  logger: Logger;
  /** 可注入定时器（测试用 fake 时钟）。 */
  timers?: Timers;
  /** 可注入 fetch（测试用 stub）。 */
  fetchImpl?: typeof fetch;
  /** 时间源（测试注入）。 */
  now?: () => number;
  /** settings 轮询间隔（ms）：观察 autoProvision 开关 / retry 指令 / 外部状态变化。 */
  pollIntervalMs?: number;
  /** 单次下载超时（ms）。 */
  downloadTimeoutMs?: number;
  /** 每制品累计尝试上限（超过后停在 failed，等待用户显式重试）。 */
  maxTotalAttempts?: number;
}

export interface SkinProvisioner {
  /**
   * 启动补齐器：立即跑一轮 reconcile + 补齐（异步，不阻塞 apply 返回），
   * 并登记 settings 轮询。返回组合 disposer（ctx.effect 登记，unload 逆序释放）。
   */
  start(): Disposer;
  /** 供测试/调试：手动触发一轮（与轮询互斥，单例防重入）。 */
  runOnce(): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
/** 累计尝试上限：超过后停在 failed，等待用户显式重试（不无限重试）。 */
const DEFAULT_MAX_TOTAL_ATTEMPTS = 5;
/** pluginManager 可用性守卫：超过该时长仍未启动补齐 → 如实上报降级（docs/git-distribution.md §3.4）。 */
export const PROVISIONING_START_GUARD_MS = 30_000;

/** 缓存目录名（加载器自有数据目录，不写 pnpm 包目录、不写 profile）。 */
const CACHE_DIR_NAME = "dsh-ui-skin-loader-cache";

/** 单次写 settings 的有界等待（ms）——落盘挂死不得拖死补齐循环。 */
const STATE_WRITE_TIMEOUT_MS = 10_000;

/**
 * 模块级单例：host 半模块每进程只实例化一次；HMR/重复 apply 不会产生第二个
 * 补齐器（计划 §四.3「多次点击或 reload 不产生重复安装任务」的宿主侧保障；
 * 多浏览器窗口共享同一 host 进程，天然单例）。
 */
let activeProvisioner: { started: boolean } | null = null;

/**
 * 包名+版本 → 缓存文件名安全片段。字符集白名单 `[A-Za-z0-9._-]`，映射后必须
 * 非空——防路径穿越与怪文件名（计划 §四.2「限制下载来源和文件名」）。
 */
function cacheKeyFor(name: string, version: string): string {
  const raw = `${name}-${version}`;
  const sanitized = raw.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "-");
  if (sanitized.length === 0 || !/^[A-Za-z0-9._-]+$/.test(sanitized)) {
    throw new Error(`skin package "${name}" cannot be mapped to a safe cache filename`);
  }
  return sanitized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从 settings describe() 里找本命名空间的当前值与 revision。 */
function readNamespaceSnapshot(
  settings: Dsh017SettingsService,
  namespace: string,
): { value: unknown; revision: number } | null {
  for (const descriptor of settings.describe()) {
    if (descriptor.ns === namespace) {
      return { value: descriptor.value, revision: descriptor.revision };
    }
  }
  return null;
}

export function createSkinProvisioner(options: SkinProvisionerOptions): SkinProvisioner {
  const { manifest, pluginManager, settings, logger } = options;
  const namespace = options.namespace ?? SETTINGS_NAMESPACE;
  const timers = options.timers ?? defaultTimers;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Date.now());
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const maxTotalAttempts = options.maxTotalAttempts ?? DEFAULT_MAX_TOTAL_ATTEMPTS;
  const timestamp = (): string => new Date(now()).toISOString();

  const cacheDirPath = options.cacheDir
    ? fileURLToPath(options.cacheDir)
    : join(tmpdir(), CACHE_DIR_NAME);

  let disposed = false;
  let running = false;
  let pollHandle: unknown = null;
  let lastSeenRevision = -1;

  // ---------------------------------------------------------------- 状态落盘
  /** 把状态写入 settings（按字段合并，只触碰 provisioning）；有界等待，失败降级记日志。 */
  async function persist(state: ProvisioningState): Promise<void> {
    try {
      const outcome = await raceTimeout(
        settings.update(namespace, toSettingsPatch(state)),
        STATE_WRITE_TIMEOUT_MS,
        timers,
      );
      if (outcome.kind === "timeout") {
        logger.warn("provisioning state write timed out", { namespace });
      } else if (outcome.kind === "rejected") {
        logger.warn("provisioning state write failed", {
          namespace,
          error: describeFailure(outcome.error),
        });
      }
    } catch (error) {
      logger.warn("provisioning state write threw", { namespace, error: describeFailure(error) });
    }
  }

  // ---------------------------------------------------------------- 下载校验
  /**
   * 下载单个制品到缓存（原子落盘）。返回缓存文件的平台绝对路径。
   * 校验链：content-length 预检 → 有界读取（超出即拒）→ 字节数比对 → SHA256 比对 → 改名。
   * 已存在的缓存命中（同字节数同哈希）直接复用，不重复下载。
   */
  async function downloadVerified(artifact: SkinArtifact): Promise<string> {
    const key = cacheKeyFor(artifact.name, artifact.version);
    const finalPath = join(cacheDirPath, `${key}.tgz`);
    const partPath = `${finalPath}.part`;

    try {
      const existing = await stat(finalPath);
      if (existing.isFile() && existing.size === artifact.bytes) {
        const bytes = await readFile(finalPath);
        if (sha256Hex(bytes) === artifact.sha256) {
          logger.debug("skin artifact cache hit", { name: artifact.name, version: artifact.version });
          return finalPath;
        }
      }
    } catch {
      // 缓存未命中（ENOENT 等）→ 正常下载路径。
    }

    await mkdir(cacheDirPath, { recursive: true });
    const controller = new AbortController();
    const timeout = timers.setTimeout(
      () => controller.abort(`download timed out after ${downloadTimeoutMs}ms`),
      downloadTimeoutMs,
    );
    try {
      const response = await fetchImpl(artifact.url, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) {
        throw new Error(`download failed with HTTP ${response.status} for ${artifact.name}@${artifact.version}`);
      }
      const declared = response.headers.get("content-length");
      if (declared !== null && Number(declared) !== artifact.bytes) {
        throw new Error(
          `download content-length ${declared} does not match manifest bytes ${artifact.bytes} for ${artifact.name}@${artifact.version}`,
        );
      }
      if (response.body === null) {
        throw new Error(`download returned an empty body for ${artifact.name}@${artifact.version}`);
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > artifact.bytes) {
            throw new Error(
              `download exceeded manifest bytes for ${artifact.name}@${artifact.version} (got >${artifact.bytes})`,
            );
          }
          chunks.push(value);
        }
      }
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (total !== artifact.bytes) {
        throw new Error(
          `download byte count ${total} does not match manifest bytes ${artifact.bytes} for ${artifact.name}@${artifact.version}`,
        );
      }
      const digest = sha256Hex(body);
      if (digest !== artifact.sha256) {
        throw new Error(
          `download sha256 mismatch for ${artifact.name}@${artifact.version} (got ${digest}, expected ${artifact.sha256})`,
        );
      }
      // 原子落盘：先写 .part（校验已通过），再同目录改名。
      await writeFile(partPath, body);
      await rename(partPath, finalPath);
      logger.info("skin artifact downloaded and verified", {
        name: artifact.name,
        version: artifact.version,
        bytes: artifact.bytes,
      });
      return finalPath;
    } finally {
      timers.clearTimeout(timeout);
    }
  }

  // ---------------------------------------------------------------- 安装状态
  /** listBundles() → 包名 → {installed, version, enabled}；服务抛错由调用方按失败处理。 */
  async function listInstalledBundles(): Promise<
    Map<string, { installed: boolean; version?: string; enabled: boolean }>
  > {
    const bundles = await pluginManager.listBundles();
    const map = new Map<string, { installed: boolean; version?: string; enabled: boolean }>();
    for (const bundle of bundles) {
      map.set(bundle.name, {
        installed: bundle.installed === true,
        version: typeof bundle.version === "string" ? bundle.version : undefined,
        enabled: bundle.enabled === true,
      });
    }
    return map;
  }

  // ---------------------------------------------------------------- 主循环
  /**
   * 一轮补齐：读状态 → 读开关/指令 → reconcile 策略 → 串行安装缺失项 → 落盘。
   * 任何异常都被捕获并记日志（网络失败不得阻断加载器启动，也不得杀死轮询）。
   */
  async function runCycle(): Promise<void> {
    if (disposed || running) return;
    running = true;
    try {
      const snapshot = readNamespaceSnapshot(settings, namespace);
      if (!snapshot || !isPlainObject(snapshot.value)) return;
      const autoProvision = snapshot.value.autoProvision !== false;
      const command = isPlainObject(snapshot.value.provisionCommand) ? snapshot.value.provisionCommand : null;

      let state = readProvisioningState(snapshot.value) ?? emptyProvisioningState(manifest.releaseSet);
      if (state.releaseSet !== manifest.releaseSet) {
        // 清单换了发布集合：旧状态作废重新 reconcile；用户排除项保留（尊重用户决定）。
        const carried = Object.entries(state.items).filter(([, item]) => item.status === "excluded");
        state = emptyProvisioningState(manifest.releaseSet);
        for (const [name, item] of carried) state.items[name] = item;
      }

      let stateDirty = false;
      let explicitRetry = false;

      // ---- 用户指令（client 半控制台写入）：retry = 失败项重置为 pending（重置累计尝试）。
      if (command && command.kind === "retry") {
        explicitRetry = true;
        for (const item of Object.values(state.items)) {
          if (item.status === "failed") {
            item.status = "pending";
            item.attempts = 0;
            delete item.error;
            item.updatedAt = timestamp();
            stateDirty = true;
          }
        }
      }
      if (command !== null) {
        // 指令消费后清除（一次性；写空对象 = 字段清空）。
        await raceTimeout(
          settings.update(namespace, { provisionCommand: {} }),
          STATE_WRITE_TIMEOUT_MS,
          timers,
        );
      }

      // ---- 开关关闭：不发起新任务（计划 §五「关闭自动补齐」）；显式 retry 仍执行。
      if (!autoProvision && !explicitRetry) {
        if (stateDirty) await persist(state);
        return;
      }

      // ---- reconcile：对照宿主实际安装状态（计划 §四.2「查询实际已安装和启用状态」）
      let bundles: Map<string, { installed: boolean; version?: string; enabled: boolean }>;
      try {
        bundles = await listInstalledBundles();
      } catch (error) {
        logger.warn("provisioner could not list host bundles", { error: describeFailure(error) });
        return;
      }

      const pending: SkinArtifact[] = [];
      for (const artifact of manifest.skins) {
        const bundle = bundles.get(artifact.name);
        const existing = state.items[artifact.name];
        const item: ProvisioningItemState = existing ?? {
          status: "pending",
          targetVersion: artifact.version,
          attempts: 0,
          updatedAt: timestamp(),
        };

        if (item.status === "excluded") {
          state.items[artifact.name] = item;
          continue;
        }
        if (!bundle || !bundle.installed) {
          if (item.status === "installed" || item.status === "present") {
            // 用户在补齐成功后卸载：尊重用户决定，不自动补回（计划 §四.3）。
            item.status = "excluded";
            item.updatedAt = timestamp();
            delete item.installedVersion;
            state.items[artifact.name] = item;
            stateDirty = true;
            logger.info("skin was removed by the user after provisioning; excluded from auto-provision", {
              name: artifact.name,
            });
            continue;
          }
          // 累计尝试已达上限的 failed 项保持 failed（不无限重试，等显式 retry 指令重置）；
          // 只有本轮会真正尝试的项才回到 pending——否则状态会说谎（显示待安装却永远不装）。
          const canAttempt = item.attempts < maxTotalAttempts;
          if (canAttempt && item.status !== "pending") {
            item.status = "pending";
            item.updatedAt = timestamp();
            stateDirty = true;
          }
          item.targetVersion = artifact.version;
          state.items[artifact.name] = item;
          if (canAttempt) pending.push(artifact);
          continue;
        }
        // 宿主已安装：同版本 → installed；不同版本 → present（不覆盖，展示差异）。
        if (bundle.version === artifact.version) {
          if (item.status !== "installed" || item.installedVersion !== bundle.version) {
            item.status = "installed";
            item.installedVersion = bundle.version;
            delete item.error;
            item.updatedAt = timestamp();
            state.items[artifact.name] = item;
            stateDirty = true;
          }
          continue;
        }
        if (item.status !== "present" || item.installedVersion !== bundle.version) {
          item.status = "present";
          item.installedVersion = bundle.version;
          item.updatedAt = timestamp();
          state.items[artifact.name] = item;
          stateDirty = true;
          logger.info("host already has a different version of a skin; leaving it untouched", {
            name: artifact.name,
            manifestVersion: artifact.version,
            hostVersion: bundle.version ?? null,
          });
        }
      }
      if (Object.keys(state.items).length > 0 && state.startedAt === undefined) {
        state.startedAt = timestamp();
        stateDirty = true;
      }
      if (stateDirty) await persist(state);

      // ---- 串行安装缺失项（一次一个，避免 profile 写竞争；计划 §四.2）
      let progressed = false;
      for (const artifact of pending) {
        if (disposed) break;
        // 每个制品安装前重读开关（用户可在中途关闭）。
        const current = readNamespaceSnapshot(settings, namespace);
        if (current && isPlainObject(current.value) && current.value.autoProvision === false) {
          logger.info("auto-provision disabled mid-run; stopping", {});
          break;
        }
        const item = state.items[artifact.name];
        // 每轮对每个 pending 制品尝试一次；累计上限由 reconcile 阶段的 maxTotalAttempts 把关。
        if (!item || item.status !== "pending") continue;
        item.status = "installing";
        item.attempts += 1;
        item.updatedAt = timestamp();
        await persist(state);

        try {
          const cachedPath = await downloadVerified(artifact);
          await pluginManager.installBundle(cachedPath, {
            requestId: `ui-skin-loader-provision-${artifact.name}-${now()}`,
          });
          const after = await listInstalledBundles();
          const installed = after.get(artifact.name);
          if (!installed || !installed.installed) {
            throw new Error(`install reported success but "${artifact.name}" is not installed per the host`);
          }
          item.status = "installed";
          item.installedVersion = installed.version ?? artifact.version;
          delete item.error;
          logger.info("skin provisioned", { name: artifact.name, version: item.installedVersion });
        } catch (error) {
          const message = describeFailure(error);
          item.status = "failed";
          item.error = message;
          logger.error("skin provisioning failed", { name: artifact.name, error: message });
        }
        item.updatedAt = timestamp();
        state.items[artifact.name] = item;
        await persist(state);
        progressed = true;
      }

      // ---- 收尾：没有 pending/installing 残留则记 completedAt（本轮有推进才写）。
      const items = Object.values(state.items);
      const unfinished = items.some((item) => item.status === "pending" || item.status === "installing");
      if (!unfinished && items.length > 0 && progressed) {
        state.completedAt = timestamp();
        await persist(state);
      }
    } catch (error) {
      logger.error("provisioning cycle threw", { error: describeFailure(error) });
    } finally {
      running = false;
    }
  }

  /** 轮询：revision 变化才动作（开关 / retry 指令 / 外部状态变化）。 */
  function poll(): void {
    if (disposed) return;
    const snapshot = readNamespaceSnapshot(settings, namespace);
    if (!snapshot) return;
    if (snapshot.revision === lastSeenRevision) return;
    lastSeenRevision = snapshot.revision;
    void runCycle();
  }

  return {
    start(): Disposer {
      if (activeProvisioner) {
        // 已有活动补齐器（HMR 重放 apply）：复用既有实例，不叠加轮询。
        return () => undefined;
      }
      const self = { started: true };
      activeProvisioner = self;
      // 首轮异步启动：不阻塞 apply 返回（计划 §三.3「不能阻塞加载器界面启动」）。
      const firstRun = timers.setTimeout(() => {
        void runCycle();
      }, 0);
      if (timers.setInterval && timers.clearInterval) {
        pollHandle = timers.setInterval(poll, pollIntervalMs);
      }
      return () => {
        timers.clearTimeout(firstRun);
        if (pollHandle !== null) {
          timers.clearInterval?.(pollHandle);
          pollHandle = null;
        }
        disposed = true;
        if (activeProvisioner === self) activeProvisioner = null;
      };
    },
    runOnce: runCycle,
  };
}

/** 错误 → 可读消息（插件管理器会把 pnpm/兼容诊断放进 message）。 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** SHA256（小写十六进制）。 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
