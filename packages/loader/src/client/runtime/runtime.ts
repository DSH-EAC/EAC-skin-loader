/**
 * SkinRuntime——加载器 client 半的核心运行时（T2.4，公约 §4 的完整实现）。
 *
 * 结构与数据流（task-6 报告附图与此一致）：
 *
 *   皮肤 apply ──registerSkin(reg)──▶ discovered 表（登记 ≠ 激活，R1）
 *                                        │
 *   switchTo(id) ──▶ [generation 序列化] ──▶ ①校验 ──▶ ②退出旧皮肤（10s 超时→suspect-residue）
 *                                        ──▶ ③激活新皮肤（10s 超时/signal→回滚 default + deactivate 兜底）
 *                                        ──▶ ④落盘 host settings（写后落盘）──▶ ⑤notify
 *                                                                        │
 *   host settings ◀── configForms.set ──────────────────────────────────┘
 *        │ SSE settings/document-updated
 *        ▼
 *   其他标签页：远端事实 ≠ 本地 current → 重放同一切换（一致则幂等跳过）
 *
 * 关键语义（细节见各方法 JSDoc 与 task-6-report.md）：
 * - 全局互斥在 client 半单点裁决（公约 §4.1）；持久化事实来源是 host settings；
 *   每个 settle 点都让内存状态与持久化值一致（写后落盘）。
 * - generation 令牌：新 switchTo 使在途切换作废——旧激活 signal 被 abort，
 *   旧 run 不再提交；若旧 run 正在激活，由旧 run 自己对新皮肤做 deactivate 兜底。
 * - 激活期副作用经 SkinSlotHandle 记账，deactivate（含兜底）逆序撤除。
 * - 第六触发（宿主侧停用/卸载 active 皮肤，api-notes §9：disable → fiber dispose → off()）：
 *   off() 立即撤销加载器账本的全部登记（不依赖已死的 fiber），随后进入短宽限去抖——
 *   宽限内同 id 重新登记（HMR）→ 丢弃旧 husk、经标准激活路径重新激活新登记对象；
 *   宽限期满未重登记 → shutdownActive + 落回 default + 持久化改写 default + faultLog。
 * - dispose（加载器停用/宿主退出，触发 3/4）经 ctx.effect 登记：deactivate 当前皮肤，
 *   但**不改写**持久化值——用户选择保留到下次启动恢复（公约 §4.4 恢复义务）。
 */

import {
  CONVENTION_ID,
  DEFAULT_SKIN_ID,
  SETTINGS_NAMESPACE,
  type Disposer,
  type FaultEntry,
  type SkinContext,
  type SkinInfo,
  type SkinLoaderService,
  type SkinRegistration,
  type SkinRuntime,
  type SwitchResult,
} from "../../protocol.ts";
import type { DshAdapter } from "../../adapter/types.ts";
import { defaultTimers, raceTimeout, type Timers } from "./clock.ts";
import { createConsoleLogger, createSkinLogger } from "./logger.ts";
import { describeError, faultTimestamp, MAX_FAULT_LOG, SettingsStore } from "./persistence.ts";

/** 隔离标记（公约 §4.4「故障隔离」；fault = 激活失败，suspect-residue = 关闭未证实）。 */
type IsolationMark = "fault" | "suspect-residue";

interface DiscoveredEntry {
  reg: SkinRegistration;
  /** 反登记 epoch 令牌：同 id 重注册（HMR）后，旧 off() 变 no-op。 */
  token: number;
  /** 不兼容原因；存在时拒绝激活（公约 §3/§8）。 */
  incompatible?: string;
  /** 隔离标记集合（激活失败与残留疑似可并存）。 */
  marks: Set<IsolationMark>;
  /** 公约 §6 自愿槽位贡献声明（登记原文，仅展示）。 */
  slots?: SkinRegistration["slots"];
}

/** 一次成功激活的记账（deactivate 兜底与 dispose 都靠它）。 */
interface ActiveRecord {
  /** 激活时捕获的 entry 引用——即使随后被反登记，兜底关闭仍可达。 */
  entry: DiscoveredEntry;
  controller: AbortController;
  /** 激活期经 SkinSlotHandle 登记的席位，逆序撤除。 */
  disposers: Disposer[];
  cleanupWarnings: string[];
  deactivateStarted: boolean;
  /**
   * 关闭封账标记：shutdownActive 一旦开始，此后 SkinSlotHandle 的任何登记
   * （无视 abort signal 的挂死激活恢复后补注册）立即被撤除——公约 §4.3
   * 「不得残留半个新皮肤」不依赖皮肤的自觉。
   */
  closed: boolean;
}

interface InFlightSwitch {
  epoch: number;
  /** 永不 reject 的 settle 镜像（序列化等待用）。 */
  settled: Promise<void>;
}

/** active 皮肤被反登记后的重登记宽限窗口（宿主侧停用触发的 HMR 去抖）。 */
interface GraceWindow {
  id: string;
  /** off() 时的 active record（账本已撤销、closed/deactivateStarted 已置位）。 */
  record: ActiveRecord;
  timer: unknown;
  settled: boolean;
}

export interface SkinRuntimeOptions {
  /** 必须基于加载器自身 client ctx 构造的 adapter（task-5 报告 §3.4 的 per-ctx 告戒）。 */
  adapter: DshAdapter;
  /** 结构化 logger；默认 console。 */
  logger?: SkinContext["logger"];
  /** 可注入定时器（测试用 fake 时钟）；默认 globalThis。 */
  timers?: Timers;
  /** 切换超时（ms）：deactivate 与 activate 各自独立计时，公约/brief 定为 10s。 */
  timeouts?: { deactivateMs?: number; activateMs?: number };
  /**
   * 启动恢复参数（ms）：readyMs = 等 settings 命名空间就绪的上限；
   * graceMs = 等 persisted 皮肤重新登记的宽限（皮肤 bundle 在加载器之后材料化）。
   */
  recovery?: { readyMs?: number; graceMs?: number };
  /**
   * active 皮肤被反登记（宿主侧停用/卸载）后的重登记宽限去抖（ms）——
   * HMR 场景旧 off() 与新 registerSkin 快速接连；默认 300ms，测试可注入 fake 时钟。
   */
  unregisterGraceMs?: number;
  /** faultLog 时间戳来源（测试可注入）。 */
  now?: () => number;
}

export interface SkinRuntimeController {
  /** ctx.provide(SERVICE_NAME, …) 的冻结 service 面（registerSkin + SkinRuntime 公共面）。 */
  expose(): SkinLoaderService;
  /**
   * 生命周期启动（client apply 的 ctx.effect 体内调用）：登记跨标签页监听 +
   * 异步启动恢复，返回 ctx.effect 的清理 disposer（async——cordis unload 会等待）。
   */
  start(): Disposer;
}

const DEFAULT_DEACTIVATE_MS = 10_000;
const DEFAULT_ACTIVATE_MS = 10_000;
const DEFAULT_RECOVERY_READY_MS = 10_000;
const DEFAULT_RECOVERY_GRACE_MS = 5_000;
const DEFAULT_UNREGISTER_GRACE_MS = 300;

/** 本加载器支持的公约 major（从 CONVENTION_ID 解析，公约 §8：按 major 匹配）。 */
const SUPPORTED_MAJOR = Number(/\/v(\d+)$/.exec(CONVENTION_ID)?.[1] ?? Number.NaN);

const SKIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const API_VERSION_PATTERN = /^dsh\.ecosystem\.ui-skin-loader\/v(\d+)$/;

/** api-notes §8.3：跨标签页设置变更事件（host 每命名空间文档变更时 emit）。 */
const DOCUMENT_UPDATED_EVENT = "settings/document-updated";

/** 不兼容判定（登记期，可读原因；公约 §3 id 正则 + §8 major 匹配）。 */
function computeIncompatible(id: string, apiVersion: string): string | undefined {
  if (!SKIN_ID_PATTERN.test(id)) {
    return `skin id "${id}" does not match the covenant id pattern [a-z0-9]+(?:[.-][a-z0-9]+)* (covenant §3)`;
  }
  const match = API_VERSION_PATTERN.exec(apiVersion);
  if (!match) {
    return `apiVersion "${apiVersion}" is not a dsh.ecosystem.ui-skin-loader/v{N} version (covenant §3)`;
  }
  const major = Number(match[1]);
  if (major !== SUPPORTED_MAJOR) {
    return `apiVersion "${apiVersion}" declares major v${major}, but this loader implements v${SUPPORTED_MAJOR} (covenant §8)`;
  }
  return undefined;
}

export function createSkinRuntime(options: SkinRuntimeOptions): SkinRuntimeController {
  const { adapter } = options;
  const timers = options.timers ?? defaultTimers;
  const logger = options.logger ?? createConsoleLogger("ui-skin-loader");
  const deactivateMs = options.timeouts?.deactivateMs ?? DEFAULT_DEACTIVATE_MS;
  const activateMs = options.timeouts?.activateMs ?? DEFAULT_ACTIVATE_MS;
  const recoveryReadyMs = options.recovery?.readyMs ?? DEFAULT_RECOVERY_READY_MS;
  const recoveryGraceMs = options.recovery?.graceMs ?? DEFAULT_RECOVERY_GRACE_MS;
  const unregisterGraceMs = options.unregisterGraceMs ?? DEFAULT_UNREGISTER_GRACE_MS;
  const timestamp = (): string => faultTimestamp(options.now);

  const store = new SettingsStore(adapter, timers, (message, details) =>
    logger.warn(message, details),
  );

  // ------------------------------------------------------------------ 状态
  const discovered = new Map<string, DiscoveredEntry>();
  const subscribers = new Set<() => void>();
  const recoveryWaits = new Map<string, (ok: boolean) => void>();
  let faultLogMirror: FaultEntry[] = [];

  let registrationToken = 0;
  let switchEpoch = 0;
  let currentId: string = DEFAULT_SKIN_ID;
  let active: ActiveRecord | null = null;
  let aborter: AbortController | null = null;
  let inFlight: InFlightSwitch | null = null;
  let disposed = false;
  let stopPromise: Promise<void> | null = null;
  let lifecycleStarted = false;
  let recoveryStarted = false;
  let userInteracted = false;
  let syncOff: Disposer | null = null;
  let syncFormOff: Disposer | null = null;
  let pendingSyncCheck = false;
  let syncCheckScheduled = false;
  let grace: GraceWindow | null = null;

  // ------------------------------------------------------------- 通知 / 故障
  function notify(): void {
    for (const cb of [...subscribers]) {
      try {
        cb();
      } catch (error) {
        logger.warn("state subscriber threw", { error: describeError(error) });
      }
    }
  }

  /** 追加故障事件（内存镜像有界 + 透写持久化；写失败只降级记日志）。 */
  async function appendFault(entry: FaultEntry): Promise<void> {
    faultLogMirror = [...faultLogMirror, entry].slice(-MAX_FAULT_LOG);
    await store.writeFaultLog(faultLogMirror);
  }

  /**
   * 立即撤销一个 active record 的全部加载器账本登记（第六触发的第一动作）：
   * 逆序撤除 SkinSlotHandle 记账的席位——**不调用皮肤的 deactivate**（宿主停用场景
   * 皮肤 fiber 已死，撤销不得依赖它）；随后 abort 激活 signal（公约 §4.2：激活被中止）。
   * deactivateStarted 置位使后续任何 shutdownActive 不再跑已死 fiber 的 deactivate。
   */
  function revokeActiveLedger(record: ActiveRecord): void {
    record.closed = true;
    record.deactivateStarted = true;
    record.controller.abort(`skin "${record.entry.reg.id}" was unregistered while active (host-side disable/uninstall)`);
    releaseLedger(record);
  }

  function reportLedgerFailure(record: ActiveRecord, error: unknown): void {
    const skinId = record.entry.reg.id;
    const message = `slot cleanup of skin "${skinId}" threw: ${describeError(error)}; marked suspect-residue`;
    record.entry.marks.add("suspect-residue");
    record.cleanupWarnings.push(message);
    logger.warn(message);
    void appendFault({ at: timestamp(), skinId, kind: "deactivate-failed", message });
  }

  function releaseLedger(record: ActiveRecord): void {
    const disposers = record.disposers.splice(0);
    for (const off of disposers.reverse()) {
      try {
        off();
      } catch {
        // Tracked releases report their own failure; continue with the remaining leases.
      }
    }
  }

  /**
   * 宽限期满未重登记：宿主停用的皮肤单方面退出——落回 default + 持久化改写 default +
   * faultLog（触发源标注宿主侧停用/unregister）。若期间有其他切换接管（active 已易主），
   * 其自身落盘已保证一致性，这里不再干预。
   */
  async function graceExpiry(): Promise<void> {
    const window = grace;
    if (!window || window.settled) {
      return;
    }
    window.settled = true;
    grace = null;
    if (disposed || active !== window.record) {
      return;
    }
    switchEpoch++; // 作废可能仍在途的该皮肤激活工作（其 signal 已在撤销时 abort）
    await shutdownActive();
    const message = `active skin "${window.id}" was unregistered while active (host-side disable/uninstall); its loader-ledger registrations were revoked immediately and no compatible re-registration arrived within ${unregisterGraceMs}ms — fell back to default`;
    logger.warn(message);
    await appendFault({ at: timestamp(), skinId: window.id, kind: "active-unregistered", message });
    await persist(DEFAULT_SKIN_ID, []);
    notify();
  }

  // ------------------------------------------------------------------ 登记
  function registerSkin(reg: SkinRegistration): Disposer {
    if (disposed) {
      throw new Error("ui-skin-loader runtime is shut down; cannot register skins");
    }
    if (typeof reg !== "object" || reg === null) {
      throw new TypeError("registerSkin expects a SkinRegistration object");
    }
    for (const field of ["apiVersion", "id", "name", "version"] as const) {
      const value = reg[field];
      if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`SkinRegistration.${field} must be a non-empty string`);
      }
    }
    if (typeof reg.activate !== "function") {
      throw new TypeError("SkinRegistration.activate must be a function");
    }
    if (typeof reg.deactivate !== "function") {
      throw new TypeError("SkinRegistration.deactivate must be a function");
    }
    const incompatible = computeIncompatible(reg.id, reg.apiVersion);
    const token = ++registrationToken;
    // 同 id 重注册（如 HMR 重放 apply）：替换登记，继承隔离标记；旧 off() 靠 token 失效。
    const previous = discovered.get(reg.id);
    discovered.set(reg.id, {
      reg,
      token,
      incompatible,
      marks: previous?.marks ?? new Set<IsolationMark>(),
      slots: Array.isArray(reg.slots) ? [...reg.slots] : undefined,
    });
    if (!incompatible) {
      const wake = recoveryWaits.get(reg.id);
      if (wake) {
        recoveryWaits.delete(reg.id);
        wake(true);
      }
      // 宽限去抖命中：active 皮肤被反登记后同 id 重新登记（HMR）——丢弃旧 husk
      //（旧激活副作用已在 off() 时随账本撤销，不调用已死 fiber 的 deactivate），
      // 经标准激活路径重新激活新登记对象（加载器是唯一事实来源，观感由新代码提供）。
      const window = grace;
      if (window && window.id === reg.id && !window.settled) {
        timers.clearTimeout(window.timer);
        window.settled = true;
        grace = null;
        if (active === window.record) {
          active = null;
          aborter = null;
          currentId = DEFAULT_SKIN_ID;
          logger.info("skin re-registered during the active-unregister grace window; re-activating", {
            skinId: reg.id,
          });
          void switchToInternal(reg.id).then((result) => {
            if (!result.ok) {
              logger.warn("grace re-activation failed", { skinId: reg.id, error: result.error });
            }
          });
        }
      }
    }
    logger.info("skin registered", {
      skinId: reg.id,
      version: reg.version,
      incompatible: incompatible ?? null,
    });
    notify();
    return () => {
      // stale off（同 id 已被更新注册替换）是 no-op——HMR 旧 fiber 的清理不会误删新登记。
      const current = discovered.get(reg.id);
      if (!current || current.token !== token) {
        return;
      }
      discovered.delete(reg.id);
      // active 皮肤被反登记 = 宿主侧停用/卸载（api-notes §9：disable → fiber dispose → off()）：
      // 立即撤销加载器账本（被禁用皮肤的观感残留清零），再进入短宽限去抖（HMR 保护）。
      const activeRecord = active;
      if (activeRecord && activeRecord.entry.reg.id === reg.id) {
        revokeActiveLedger(activeRecord);
        grace = {
          id: reg.id,
          record: activeRecord,
          timer: timers.setTimeout(() => {
            void graceExpiry();
          }, unregisterGraceMs),
          settled: false,
        };
        logger.info("active skin unregistered; ledger revoked, re-registration grace window started", {
          skinId: reg.id,
          graceMs: unregisterGraceMs,
        });
      }
      logger.info("skin unregistered", { skinId: reg.id });
      notify();
    };
  }

  // ------------------------------------------------------------ 激活/关闭
  function createSkinContext(reg: SkinRegistration, signal: AbortSignal, record: ActiveRecord): SkinContext {
    const canRegister = (): boolean => !record.closed && !signal.aborted;
    function track(off: Disposer): Disposer {
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        const index = record.disposers.indexOf(release);
        if (index !== -1) record.disposers.splice(index, 1);
        try {
          off();
        } catch (error) {
          reportLedgerFailure(record, error);
          throw error;
        }
      };
      // An upstream registration can synchronously trigger shutdown before returning.
      if (!canRegister()) {
        try { release(); } catch { /* Failure was reported by the tracked release. */ }
        return () => undefined;
      }
      record.disposers.push(release);
      return release;
    }
    return {
      logger: createSkinLogger(reg.id),
      signal,
      slots: {
        register(componentOptions, component) {
          if (!canRegister()) return () => undefined;
          return track(adapter.slots.register(componentOptions, component));
        },
        inject(key, callback) {
          if (!canRegister()) return () => undefined;
          return track(adapter.slots.inject(key, () => {
            if (!canRegister()) return;
            return callback();
          }));
        },
      },
    };
  }

  /**
   * 彻底关闭当前激活皮肤（公约 §4.3/§4.4）：deactivate 先行（10s 超时；超时/抛错 →
   * suspect-residue + faultLog + warning，**继续关闭流程**），随后逆序撤除 SkinSlotHandle
   * 记账的席位兜底（无论 deactivate 自述进度）。current 归位 default。
   */
  async function shutdownActive(): Promise<{ warning?: string }> {
    const record = active;
    active = null;
    aborter = null;
    if (!record) {
      return {};
    }
    const skinId = record.entry.reg.id;
    // 从此刻起本 record 封账：deactivate 等待窗口内恢复的激活代码再登记的席位会被立即撤除。
    record.closed = true;
    const warnings: string[] = [];
    if (!record.deactivateStarted) {
      record.deactivateStarted = true;
      // 同步抛错也折算成 rejection（公约：不得因皮肤 deactivate 抛错而中断关闭流程）。
      const deactivation = Promise.resolve().then(() => record.entry.reg.deactivate());
      const outcome = await raceTimeout(deactivation, deactivateMs, timers);
      if (outcome.kind === "timeout") {
        const message = `deactivate of skin "${skinId}" timed out after ${deactivateMs}ms; marked suspect-residue (shutdown could not be verified)`;
        record.entry.marks.add("suspect-residue");
        warnings.push(message);
        await appendFault({ at: timestamp(), skinId, kind: "deactivate-timeout", message });
      } else if (outcome.kind === "rejected") {
        const message = `deactivate of skin "${skinId}" threw: ${describeError(outcome.error)}; marked suspect-residue`;
        record.entry.marks.add("suspect-residue");
        warnings.push(message);
        await appendFault({ at: timestamp(), skinId, kind: "deactivate-failed", message });
      }
    }
    // 兜底：SkinSlotHandle 记账的席位逆序撤除（公约 §4.3「退出后不可观测」的加载器侧保障）。
    releaseLedger(record);
    warnings.push(...record.cleanupWarnings);
    currentId = DEFAULT_SKIN_ID;
    notify();
    return { warning: warnings.length > 0 ? warnings.join("; ") : undefined };
  }

  function joinWarnings(warnings: string[]): string | undefined {
    return warnings.length > 0 ? warnings.join("; ") : undefined;
  }

  /** 落盘 + 如实上报：写失败 → warning + faultLog（本地切换仍已生效，持久化降级）。 */
  async function persist(id: string, warnings: string[]): Promise<void> {
    const accepted = await store.writeActiveSkin(id);
    if (!accepted) {
      const message = `failed to persist activeSkin="${id}" to host settings (namespace ${SETTINGS_NAMESPACE})`;
      warnings.push(message);
      logger.warn(message);
      await appendFault({ at: timestamp(), skinId: id, kind: "persist-failed", message });
    }
  }

  // --------------------------------------------------------------- 切换状态机
  /**
   * 五触发统一入口（换肤 / 手动停用 / 隔离重试 / 恢复 / 跨标签页重放都走这里）。
   * 任何激活路径不得绕过 switchTo（R6 的加载器镜像）。
   */
  async function switchToInternal(target: string): Promise<SwitchResult> {
    const epoch = ++switchEpoch;
    // generation：新请求使在途切换作废（旧激活 signal 被 abort；旧 run 自行兜底后落定）。
    aborter?.abort(`switch superseded by a newer switch request (epoch ${epoch})`);
    aborter = null;
    const prior = inFlight?.settled ?? Promise.resolve();
    const promise = runSwitch(target, epoch, prior);
    const settled = promise.then(
      () => undefined,
      () => undefined,
    );
    inFlight = { epoch, settled };
    try {
      return await promise;
    } finally {
      if (inFlight?.epoch === epoch) {
        inFlight = null;
      }
      if (pendingSyncCheck && !disposed) {
        scheduleSyncCheck();
      }
    }
  }

  /**
   * 单次切换的相位流。prior 是上一个 in-flight 的 settle 镜像——本 run 的所有相位
   * 都在 prior 落定之后才开始（严格串行，杜绝两 run 交错的 deactivate/activate 竞态）。
   */
  async function runSwitch(target: string, epoch: number, prior: Promise<void>): Promise<SwitchResult> {
    await prior;
    const supersededResult = (): SwitchResult => ({
      ok: false,
      error: `switch to "${target}" was superseded by a newer switch request`,
      rolledBackTo: currentId,
    });
    const disposedResult = (): SwitchResult => ({
      ok: false,
      error: "ui-skin-loader runtime is shut down",
      rolledBackTo: currentId,
    });

    if (disposed) {
      return disposedResult();
    }
    if (epoch !== switchEpoch) {
      return supersededResult();
    }

    // ---- 相位 0：校验（已登记 / 兼容 / 非当前 / 隔离标记显式重试）----
    let entry: DiscoveredEntry | undefined;
    if (target !== DEFAULT_SKIN_ID) {
      entry = discovered.get(target);
      if (!entry) {
        return {
          ok: false,
          error: `skin "${target}" is not registered`,
          rolledBackTo: currentId,
        };
      }
      if (entry.incompatible) {
        return {
          ok: false,
          error: `skin "${target}" is incompatible: ${entry.incompatible}`,
          rolledBackTo: currentId,
        };
      }
    }
    if (target === currentId) {
      return {
        ok: false,
        error:
          target === DEFAULT_SKIN_ID
            ? "default (no skin) is already active"
            : `skin "${target}" is already active`,
        rolledBackTo: currentId,
      };
    }
    const warnings: string[] = [];
    if (entry && (entry.marks.has("fault") || entry.marks.has("suspect-residue"))) {
      // 公约 §4.3.5 隔离动作后允许用户显式重试（brief §3 授权 fault，suspect-residue
      // 同路径处理——两者都是加载器的怀疑而非事实，永久封锁没有恢复出口）。
      const marks = [...entry.marks].join("+");
      entry.marks.clear();
      notify();
      const message = `explicit switchTo cleared the "${marks}" isolation mark of skin "${target}" and retries activation`;
      logger.info(message);
      await appendFault({ at: timestamp(), skinId: target, kind: "explicit-retry", message });
    }

    // ---- 相位 1：退出旧皮肤（公约 §4.4：激活新皮肤前必须先完成 deactivate）----
    if (active) {
      const outcome = await shutdownActive();
      if (outcome.warning) {
        warnings.push(outcome.warning);
      }
      if (disposed) {
        return disposedResult(); // stop() 语义：不改写持久化值（用户选择保留给恢复）
      }
      if (epoch !== switchEpoch) {
        // 旧皮肤已退出、新皮肤未接管：落盘 default 保持「持久化 == 内存」不变量，
        // 否则远端/恢复会把已退出的皮肤当作事实来源重新拉起。
        await persist(DEFAULT_SKIN_ID, warnings);
        return { ...supersededResult(), warning: joinWarnings(warnings) };
      }
    }

    // ---- 相位 2：激活新皮肤（default = 纯停用，无此相位）----
    if (entry) {
      const targetEntry: DiscoveredEntry = entry;
      const controller = new AbortController();
      const record: ActiveRecord = {
        entry: targetEntry,
        controller,
        disposers: [],
        cleanupWarnings: [],
        deactivateStarted: false,
        closed: false,
      };
      active = record;
      aborter = controller;
      const skinContext = createSkinContext(targetEntry.reg, controller.signal, record);
      // 同步抛错折算成 rejection；activate 恰好调用一次（幂等保护）。
      let activationPromise: Promise<void> | null = null;
      const activation = (): Promise<void> =>
        (activationPromise ??= Promise.resolve().then(() =>
          targetEntry.reg.activate(skinContext),
        ));
      const outcome = await raceTimeout(activation(), activateMs, timers, () =>
        controller.abort(`activation of skin "${target}" timed out after ${activateMs}ms`),
      );

      if (disposed) {
        // 停机接管清理（stop() 会 deactivate 本 record）；本 run 不再提交任何状态。
        // 给已 abort 的激活一个 tick 的落定窗（不无限等待——皮肤可以无视 signal）。
        controller.abort("ui-skin-loader runtime is shutting down");
        await raceTimeout(activation(), 0, timers);
        return disposedResult();
      }
      if (epoch !== switchEpoch) {
        // 被更新的请求取代：旧激活作废，但**这个半激活的新皮肤由本 run 负责兜底关闭**
        // （新 run 只知道 current=default，无从得知它）。同样只等一个 tick。
        controller.abort(`switch to "${target}" was superseded by a newer switch request`);
        await raceTimeout(activation(), 0, timers);
        const rolled = await shutdownActive();
        if (rolled.warning) {
          warnings.push(rolled.warning);
        }
        await persist(DEFAULT_SKIN_ID, warnings);
        return { ...supersededResult(), warning: joinWarnings(warnings) };
      }
      if (record.closed || active !== record) {
        const rolled = active === record ? await shutdownActive() : {};
        if (rolled.warning) warnings.push(rolled.warning);
        await persist(DEFAULT_SKIN_ID, warnings);
        return {
          ok: false,
          error: `activation of skin "${target}" was closed before commit`,
          warning: joinWarnings(warnings),
          rolledBackTo: currentId,
        };
      }
      if (outcome.kind === "timeout") {
        controller.abort(`activation of skin "${target}" timed out after ${activateMs}ms`);
        // activate 永不返回也要回滚：只给一个 tick 的落定窗，随后立即 deactivate 兜底。
        await raceTimeout(activation(), 0, timers);
        const reason = `activate of skin "${target}" timed out after ${activateMs}ms`;
        const rolled = await shutdownActive();
        if (rolled.warning) {
          warnings.push(rolled.warning);
        }
        targetEntry.marks.add("fault");
        notify();
        await appendFault({
          at: timestamp(),
          skinId: target,
          kind: "activate-timeout",
          message: `${reason}; rolled back to default${rolled.warning ? `; ${rolled.warning}` : ""}`,
        });
        await persist(DEFAULT_SKIN_ID, warnings);
        notify();
        return {
          ok: false,
          error: reason,
          warning: joinWarnings(warnings),
          rolledBackTo: DEFAULT_SKIN_ID,
        };
      }
      if (outcome.kind === "rejected") {
        const reason = `activate of skin "${target}" threw: ${describeError(outcome.error)}`;
        const rolled = await shutdownActive();
        if (rolled.warning) {
          warnings.push(rolled.warning);
        }
        targetEntry.marks.add("fault");
        notify();
        await appendFault({
          at: timestamp(),
          skinId: target,
          kind: "activate-failed",
          message: `${reason}; rolled back to default${rolled.warning ? `; ${rolled.warning}` : ""}`,
        });
        await persist(DEFAULT_SKIN_ID, warnings);
        notify();
        return {
          ok: false,
          error: reason,
          warning: joinWarnings(warnings),
          rolledBackTo: DEFAULT_SKIN_ID,
        };
      }

      // ---- 相位 3：提交 + 落盘（写后落盘：持久化事实 == 已完成的本地事实）----
      currentId = target;
      aborter = null;
      await persist(target, warnings);
      notify();
      const warning = joinWarnings(warnings);
      return warning === undefined ? { ok: true } : { ok: true, warning };
    }

    // ---- 目标 default：纯停用已在上面的相位 1 完成 ----
    await persist(DEFAULT_SKIN_ID, warnings);
    notify();
    const warning = joinWarnings(warnings);
    return warning === undefined ? { ok: true } : { ok: true, warning };
  }

  // ------------------------------------------------------------- 启动恢复
  function waitForRegistration(id: string): Promise<boolean> {
    const entry = discovered.get(id);
    if (entry && !entry.incompatible) {
      return Promise.resolve(true);
    }
    if (recoveryGraceMs <= 0) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const handle = timers.setTimeout(() => {
        recoveryWaits.delete(id);
        resolve(false);
      }, recoveryGraceMs);
      recoveryWaits.set(id, (ok) => {
        timers.clearTimeout(handle);
        recoveryWaits.delete(id);
        resolve(ok);
      });
    });
  }

  /**
   * 启动恢复（公约 §4.4「跨重启恢复用户选择」）：读 host settings activeSkin →
   * 已登记则经同一 switchTo 状态机重放（标记 recovery，失败落 default + faultLog）；
   * 未登记（被卸载）→ 落 default 并把持久化值改写为 default。
   */
  async function recover(): Promise<void> {
    if (disposed || recoveryStarted) {
      return;
    }
    recoveryStarted = true;
    const read = await store.waitForReady(recoveryReadyMs);
    if (disposed) {
      return;
    }
    if (read.status === "unavailable") {
      // 命名空间不可用（host 半未运行）：恢复搁置；后续远端事件仍会驱动收敛。
      logger.warn("startup recovery skipped: settings namespace unavailable", {
        namespace: SETTINGS_NAMESPACE,
      });
      return;
    }
    faultLogMirror = read.faultLog.slice(-MAX_FAULT_LOG);
    const persisted = read.activeSkin;
    if (persisted === DEFAULT_SKIN_ID) {
      logger.info("startup recovery: no skin persisted");
      return;
    }
    if (userInteracted) {
      logger.info("startup recovery skipped: a switch was requested during startup", {
        persisted,
      });
      return;
    }
    const registered = await waitForRegistration(persisted);
    if (disposed || userInteracted) {
      return;
    }
    // 宽限期内登记又反登记（或登记的是不兼容条目）等同未登记：走落 default 路径。
    const registeredEntry = discovered.get(persisted);
    if (!registered || !registeredEntry || registeredEntry.incompatible) {
      // 皮肤被卸载/禁用：落回 default 并把持久化值改写为 default（brief §4）。
      const message = `persisted activeSkin "${persisted}" was not re-registered at startup (or re-registered as incompatible); falling back to default`;
      logger.warn(message);
      await appendFault({
        at: timestamp(),
        skinId: persisted,
        kind: "recovery-unregistered",
        message,
      });
      const accepted = await store.writeActiveSkin(DEFAULT_SKIN_ID);
      if (!accepted) {
        const persistMessage = `failed to rewrite persisted activeSkin to default after unregistered recovery`;
        await appendFault({
          at: timestamp(),
          skinId: persisted,
          kind: "persist-failed",
          message: persistMessage,
        });
      }
      notify();
      return;
    }
    logger.info("startup recovery: replaying persisted skin", { skinId: persisted });
    const result = await switchToInternal(persisted);
    if (!result.ok) {
      // switchTo 失败路径已回滚 default 并落盘；这里补一条恢复语境的故障事件。
      await appendFault({
        at: timestamp(),
        skinId: persisted,
        kind: "recovery-failed",
        message: `recovery activation of "${persisted}" failed: ${result.error}`,
      });
    } else if (result.warning) {
      logger.warn("startup recovery completed with warnings", {
        skinId: persisted,
        warning: result.warning,
      });
    }
  }

  // ------------------------------------------------------------ 跨标签页同步
  function onRemoteDocumentUpdated(args: unknown[]): void {
    const namespace = args[0];
    // 事件载荷 = (entryId, revision)（dsh-settings emit）；载荷形状意外时保守处理为可能相关。
    if (typeof namespace === "string" && namespace !== SETTINGS_NAMESPACE) {
      return;
    }
    scheduleSyncCheck();
  }

  function scheduleSyncCheck(): void {
    pendingSyncCheck = true;
    if (syncCheckScheduled) {
      return;
    }
    syncCheckScheduled = true;
    queueMicrotask(() => {
      syncCheckScheduled = false;
      void syncCheck();
    });
  }

  /** 远端事实 ≠ 本地 current → 重放同一切换；一致 → 幂等跳过（含自身写入的回声）。 */
  async function syncCheck(): Promise<void> {
    if (disposed) {
      pendingSyncCheck = false;
      return;
    }
    if (inFlight) {
      return; // 切换在途：落定后 finally 会重新调度（其自身落盘是最终事实）。
    }
    pendingSyncCheck = false;
    const read = store.readSync();
    if (read.status === "unavailable") {
      return;
    }
    const persisted = read.activeSkin;
    if (persisted === currentId) {
      return;
    }
    logger.info("cross-tab sync: replaying remote activeSkin change", {
      from: currentId,
      to: persisted,
    });
    const result = await switchToInternal(persisted);
    if (!result.ok) {
      logger.debug("cross-tab replay finished with error", { error: result.error });
    }
  }

  // ------------------------------------------------------------------ 停机
  /** 触发 3/4（加载器停用/宿主退出）的统一停机：deactivate 当前皮肤，**不改写持久化值**——用户选择保留给下次启动恢复。 */
  function stop(): Promise<void> {
    if (stopPromise) {
      return stopPromise;
    }
    disposed = true;
    stopPromise = (async () => {
      switchEpoch++; // 在途 run 全部作废（其相位边界检查 disposed/epoch）
      aborter?.abort("ui-skin-loader runtime is shutting down");
      aborter = null;
      for (const resolve of recoveryWaits.values()) {
        resolve(false);
      }
      recoveryWaits.clear();
      if (grace) {
        timers.clearTimeout(grace.timer);
        grace.settled = true;
        grace = null;
      }
      const listenerDisposers = [syncOff, syncFormOff];
      syncOff = null;
      syncFormOff = null;
      for (const off of listenerDisposers.reverse()) {
        try {
          off?.();
        } catch (error) {
          const message = `runtime listener cleanup threw: ${describeError(error)}; suspected listener residue`;
          logger.warn(message);
          void appendFault({ at: timestamp(), skinId: "(runtime)", kind: "deactivate-failed", message });
        }
      }
      pendingSyncCheck = false;
      if (inFlight) {
        await inFlight.settled; // 在途 run 观察 disposed 后有界落定
      }
      // protocol SkinContext.signal 契约：加载器停用是激活中止的合法原因——
      // committed 皮肤的 signal 在此中止（半激活的已在上方 aborter 分支处理）。
      active?.controller.abort("ui-skin-loader runtime is shutting down");
      const outcome = await shutdownActive();
      if (outcome.warning) {
        logger.warn("skin shutdown finished with warnings", { warning: outcome.warning });
      }
      subscribers.clear();
    })();
    return stopPromise;
  }

  // -------------------------------------------------------------- 公共面
  function list(): SkinInfo[] {
    return [...discovered.values()].map((entry) => ({
      id: entry.reg.id,
      name: entry.reg.name,
      version: entry.reg.version,
      ...(entry.reg.author === undefined ? {} : { author: entry.reg.author }),
      ...(entry.reg.description === undefined ? {} : { description: entry.reg.description }),
      ...(entry.reg.tags === undefined ? {} : { tags: [...entry.reg.tags] }),
      ...(entry.reg.preview === undefined ? {} : { preview: entry.reg.preview }),
      ...(entry.reg.settingsHint === undefined ? {} : { settingsHint: entry.reg.settingsHint }),
      ...(entry.slots === undefined ? {} : { slots: entry.slots.map((slot) => ({ ...slot })) }),
      status: entry.marks.has("suspect-residue")
        ? "suspect-residue"
        : entry.marks.has("fault")
          ? "fault"
          : entry.reg.id === currentId
            ? "active"
            : "discovered",
      ...(entry.incompatible === undefined ? {} : { incompatible: entry.incompatible }),
    }));
  }

  const runtime: SkinRuntime = {
    list,
    current: () => currentId,
    async switchTo(id) {
      userInteracted = true;
      return switchToInternal(id);
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
  };

  const controller: SkinRuntimeController = {
    expose() {
      const service: SkinLoaderService = {
        ...runtime,
        registerSkin,
      };
      return Object.freeze(service);
    },
    start() {
      if (lifecycleStarted) {
        throw new Error("ui-skin-loader runtime lifecycle already started");
      }
      lifecycleStarted = true;
      // api-notes §8.3：跨标签页重放直接订阅 settings/document-updated。
      // 事件载荷 = (entryId, revision)——收集为参数数组再交给处理器。
      syncOff = adapter.remote.$on(DOCUMENT_UPDATED_EVENT, (...args: unknown[]) =>
        onRemoteDocumentUpdated(args),
      );
      // 第二触发源（T2.7 V7 实机缺陷修复）：上游对 document-updated 的消费是异步的
      // mirror.load()，事件当下本端快照可能还是旧值（读旧 → 幂等跳过 → 永不重放）。
      // 快照回源时订阅者被通知，把它也接到 syncCheck 上；自身写入回声与在途切换
      // 由 syncCheck 既有语义幂等消化（inFlight 早退 + 落定后 finally 重查）。
      const initialRead = store.readSync();
      let observedSelection = initialRead.status === "ready" ? initialRead.activeSkin : undefined;
      syncFormOff = store.onChange(() => {
        const read = store.readSync();
        if (read.status !== "ready" || read.activeSkin === observedSelection) return;
        observedSelection = read.activeSkin;
        // Unrelated faultLog updates and our own selection-write echoes are not remote switches.
        if (read.activeSkin !== currentId) scheduleSyncCheck();
      });
      void recover();
      return () => stop();
    },
  };
  return controller;
}
