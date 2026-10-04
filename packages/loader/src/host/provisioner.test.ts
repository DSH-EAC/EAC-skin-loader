/**
 * 皮肤补齐器单测（node --test；全部依赖注入，无真实网络/文件系统之外的副作用）。
 *
 * 覆盖计划 §五 验收矩阵里可本地判定的行：
 * - 首次补齐（缺失项安装并登记状态）
 * - 已安装部分皮肤（只装缺失项；成功项不重复安装）
 * - 已有不同版本（不覆盖，present + 版本差异）
 * - 用户主动卸载（excluded，不在每次启动强制补回）
 * - 关闭自动补齐（不发起新任务）
 * - 失败重试（显式指令重置累计尝试；累计上限内自动重试，超限停 failed）
 * - 下载中断 / hash / 大小错误（不安装损坏资产，不标记成功，错误如实保留）
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

import { createSkinProvisioner } from "./provisioner.ts";
import { parseSkinsManifest, loadSkinsManifest } from "./skins-manifest.ts";
import { normalizeProvisioningState, readProvisioningState } from "./provisioning-state.ts";
import { projectProvisioningView, createProvisioningFacade } from "../client/console/provisioning.ts";
import type { Logger } from "../protocol.ts";

// ---------------------------------------------------------------------------
// 测试基建
// ---------------------------------------------------------------------------

const AURORA_SHA = createHash("sha256").update("aurora-tarball-bytes").digest("hex");
const XP_SHA = createHash("sha256").update("xp-tarball-bytes").digest("hex");

const MANIFEST = {
  manifestVersion: 1,
  generatedAt: "2026-10-05T00:00:00.000Z",
  releaseSet: "v1.2.0",
  allowInsecureUrl: true,
  skins: [
    {
      name: "@dsh-eac/skin-aurora",
      version: "1.2.0",
      skinId: "dsh-eac.skin.aurora",
      url: "http://cache.test/dsh-eac-skin-aurora-1.2.0.tgz",
      sha256: AURORA_SHA,
      bytes: "aurora-tarball-bytes".length,
      dshPeerRange: "0.1.7-rc.2 || 0.2.0-rc.2",
    },
    {
      name: "@dsh-eac/skin-xp",
      version: "1.2.0",
      skinId: "dsh-eac.skin.xp",
      url: "http://cache.test/dsh-eac-skin-xp-1.2.0.tgz",
      sha256: XP_SHA,
      bytes: "xp-tarball-bytes".length,
      dshPeerRange: "0.1.7-rc.2 || 0.2.0-rc.2",
    },
  ],
};

function silentLogger(): Logger {
  const noop = () => undefined;
  return { debug: noop, info: noop, warn: noop, error: noop };
}

interface FakeHostState {
  value: Record<string, unknown>;
  revision: number;
}

/**
 * 与宿主 dsh-settings 的 mergeLayers 同形（lib/index.js L281）：对象字段逐键**深合并**，
 * 不是字段级替换——空对象清不掉已存在的键。fake 必须复刻这一点，否则会掩盖
 * 「retry 指令清除无效」这类只在真实宿主上复现的缺陷（本轮修复的回归来源）。
 */
function deepMerge(
  under: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...under };
  for (const [key, value] of Object.entries(over)) {
    const current = merged[key];
    const bothPlainObjects =
      current !== null && typeof current === "object" && !Array.isArray(current) &&
      value !== null && typeof value === "object" && !Array.isArray(value);
    merged[key] = bothPlainObjects
      ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
      : value;
  }
  return merged;
}

/** host 侧 settings 服务的内存实现（describe/update 语义与 dsh-settings 一致：深合并）。 */
function fakeSettings(initial: Record<string, unknown> = {}) {
  const state: FakeHostState = { value: { ...initial }, revision: 1 };
  return {
    state,
    describe() {
      return [{ ns: "dsh-ui-skin-loader", value: state.value, revision: state.revision }];
    },
    async update(_ns: string, patch: Record<string, unknown>) {
      state.value = deepMerge(state.value, patch);
      state.revision += 1;
    },
  };
}

/** 宿主 pluginManager 的内存实现：installBundle 把 tarball 记账为已安装。 */
function fakeManager(initial: Array<{ name: string; version?: string; enabled?: boolean }> = []) {
  const installed = new Map<string, { version?: string; enabled: boolean }>();
  for (const entry of initial) {
    installed.set(entry.name, { version: entry.version, enabled: entry.enabled ?? true });
  }
  const installCalls: Array<{ spec: string; requestId?: string }> = [];
  return {
    installCalls,
    installed,
    async listBundles() {
      return [...installed.entries()].map(([name, meta]) => ({
        name,
        version: meta.version,
        enabled: meta.enabled,
        installed: true,
        removable: true,
      }));
    },
    async installBundle(spec: string, options?: { requestId?: string }) {
      installCalls.push({ spec, requestId: options?.requestId });
      // 真实宿主从 tarball 里读包名/版本；fake 用请求序号模拟 aurora→xp 顺序。
      const name = spec.includes("skin-aurora") ? "@dsh-eac/skin-aurora" : "@dsh-eac/skin-xp";
      installed.set(name, { version: "1.2.0", enabled: true });
      return { ok: true };
    },
  };
}

/** fetch stub 的响应体：字节 + 可选伪造的 content-length（覆盖「声明对但流超发」路径）。 */
interface FakeBody {
  bytes: Uint8Array;
  declaredLength?: number;
}

/** fetch stub：按 URL 返回字节（或抛错/给错字节），覆盖下载校验路径。 */
function fakeFetch(bodies: Record<string, Uint8Array | Error | FakeBody>) {
  return (async (url: string | URL) => {
    const key = String(url);
    const body = bodies[key];
    if (!body) {
      return { ok: false, status: 404, headers: { get: () => null }, body: null };
    }
    if (body instanceof Error) {
      throw body;
    }
    const bytes = body instanceof Uint8Array ? body : body.bytes;
    const declared = body instanceof Uint8Array ? null : (body.declaredLength ?? null);
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === "content-length" ? (declared === null ? String(bytes.byteLength) : String(declared)) : null) },
      body: {
        getReader() {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: body };
            },
          };
        },
      },
    };
  }) as unknown as typeof fetch;
}

interface Harness {
  settings: ReturnType<typeof fakeSettings>;
  manager: ReturnType<typeof fakeManager>;
  cacheDir: URL;
  runOnce(): Promise<void>;
  cleanup(): Promise<void>;
}

async function createHarness(overrides?: {
  manager?: ReturnType<typeof fakeManager>;
  bodies?: Record<string, Uint8Array | Error | FakeBody>;
  initialSettings?: Record<string, unknown>;
  maxTotalAttempts?: number;
}): Promise<Harness> {
  const settings = fakeSettings(overrides?.initialSettings ?? {});
  const manager = overrides?.manager ?? fakeManager();
  const bodies: Record<string, Uint8Array | Error | FakeBody> = overrides?.bodies ?? {
    "http://cache.test/dsh-eac-skin-aurora-1.2.0.tgz": new TextEncoder().encode("aurora-tarball-bytes"),
    "http://cache.test/dsh-eac-skin-xp-1.2.0.tgz": new TextEncoder().encode("xp-tarball-bytes"),
  };
  const dir = await mkdtemp(join(tmpdir(), "usl-provision-test-"));
  const cacheDir = pathToFileURL(join(dir, "cache") + "/");
  const parsed = parseSkinsManifest(MANIFEST);
  assert.equal(parsed.ok, true, "test manifest must be well-formed");
  const provisioner = createSkinProvisioner({
    manifest: parsed.ok ? parsed.manifest : (undefined as never),
    pluginManager: manager,
    settings: settings as unknown as Parameters<typeof createSkinProvisioner>[0]["settings"],
    cacheDir,
    logger: silentLogger(),
    fetchImpl: fakeFetch(bodies),
    now: () => 1_700_000_000_000,
    pollIntervalMs: 60_000,
    maxTotalAttempts: overrides?.maxTotalAttempts ?? 5,
  });
  return {
    settings,
    manager,
    cacheDir,
    runOnce: () => provisioner.runOnce(),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// 清单校验（fail-closed）
// ---------------------------------------------------------------------------

test("parseSkinsManifest accepts a well-formed manifest", () => {
  const parsed = parseSkinsManifest(MANIFEST);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.manifest.skins.length, 2);
    assert.equal(parsed.manifest.releaseSet, "v1.2.0");
  }
});

test("parseSkinsManifest rejects bad sha256 / bytes / duplicate names / insecure urls", () => {
  const badSha = {
    ...MANIFEST,
    skins: [{ ...MANIFEST.skins[0], sha256: "ZZ" }, MANIFEST.skins[1]],
  };
  assert.equal(parseSkinsManifest(badSha).ok, false);

  const badBytes = {
    ...MANIFEST,
    skins: [{ ...MANIFEST.skins[0], bytes: 0 }, MANIFEST.skins[1]],
  };
  assert.equal(parseSkinsManifest(badBytes).ok, false);

  const dup = {
    ...MANIFEST,
    skins: [MANIFEST.skins[0], MANIFEST.skins[0]],
  };
  assert.equal(parseSkinsManifest(dup).ok, false);

  // 发布形态禁止 http（allowInsecureUrl 未置位）。
  const insecure = JSON.parse(JSON.stringify(MANIFEST));
  delete insecure.allowInsecureUrl;
  assert.equal(parseSkinsManifest(insecure).ok, false);

  assert.equal(parseSkinsManifest({ ...MANIFEST, manifestVersion: 99 }).ok, false);
  assert.equal(parseSkinsManifest(null).ok, false);
});

test("loadSkinsManifest fails closed on unreadable / corrupt files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "usl-manifest-test-"));
  try {
    const missing = await loadSkinsManifest(pathToFileURL(join(dir, "absent.json")));
    assert.equal(missing.ok, false);

    const corrupt = join(dir, "corrupt.json");
    await writeFile(corrupt, "{not json", "utf8");
    const parsed = await loadSkinsManifest(pathToFileURL(corrupt));
    assert.equal(parsed.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 状态归一化（防御性：损坏值不崩溃）
// ---------------------------------------------------------------------------

test("normalizeProvisioningState drops corrupt entries instead of throwing", () => {
  assert.equal(normalizeProvisioningState(null), null);
  assert.equal(normalizeProvisioningState({ version: 99 }), null);
  const state = normalizeProvisioningState({
    version: 1,
    releaseSet: "v1.2.0",
    items: {
      "@dsh-eac/skin-aurora": { status: "installed", targetVersion: "1.2.0", attempts: 1, updatedAt: "t" },
      "@dsh-eac/skin-bad": { status: "nonsense", targetVersion: "1.2.0", attempts: 0, updatedAt: "t" },
      "@dsh-eac/skin-worse": null,
    },
  });
  assert.ok(state);
  assert.deepEqual(Object.keys(state?.items ?? {}), ["@dsh-eac/skin-aurora"]);
  assert.equal(readProvisioningState({ provisioning: { version: 1, releaseSet: "r", items: {} } })?.releaseSet, "r");
  assert.equal(readProvisioningState(undefined), null);
});

// ---------------------------------------------------------------------------
// 补齐策略矩阵
// ---------------------------------------------------------------------------

test("provisions missing skins serially and records installed state", async () => {
  const h = await createHarness();
  try {
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 2);
    const state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.status, "installed");
    assert.equal(state?.items["@dsh-eac/skin-xp"]?.status, "installed");
    assert.equal(state?.releaseSet, "v1.2.0");
    // 缓存文件真实落盘（供隔离核验）。
    await assert.doesNotReject(() => stat(join(h.cacheDir.pathname.replace(/^\/(?=[A-Za-z]:)/, ""), "dsh-eac-skin-aurora-1.2.0.tgz")));
  } finally {
    await h.cleanup();
  }
});

test("second run installs nothing new (success is not reinstalled)", async () => {
  const h = await createHarness();
  try {
    await h.runOnce();
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 2);
  } finally {
    await h.cleanup();
  }
});

test("only missing skins are installed when some already exist", async () => {
  const h = await createHarness({ manager: fakeManager([{ name: "@dsh-eac/skin-aurora", version: "1.2.0" }]) });
  try {
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 1);
    assert.equal(h.manager.installCalls[0]?.spec.includes("skin-xp"), true);
    const state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.status, "installed");
    assert.equal(state?.items["@dsh-eac/skin-xp"]?.status, "installed");
  } finally {
    await h.cleanup();
  }
});

test("a different installed version is kept (present) and never overwritten", async () => {
  const h = await createHarness({
    manager: fakeManager([{ name: "@dsh-eac/skin-aurora", version: "0.9.0" }]),
  });
  try {
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 1); // 只补 xp
    const state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.status, "present");
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.installedVersion, "0.9.0");
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.targetVersion, "1.2.0");
  } finally {
    await h.cleanup();
  }
});

test("a skin the user removed after provisioning is excluded and not reinstalled", async () => {
  const h = await createHarness();
  try {
    await h.runOnce(); // aurora + xp installed
    h.manager.installed.delete("@dsh-eac/skin-aurora"); // 用户卸载
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 2); // 没有第三笔
    const state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.status, "excluded");
    // 再跑一轮也不会补回。
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 2);
  } finally {
    await h.cleanup();
  }
});

test("autoProvision=false issues no new installs", async () => {
  const h = await createHarness({ initialSettings: { autoProvision: false } });
  try {
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 0);
    const state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"], undefined);
  } finally {
    await h.cleanup();
  }
});

test("sha256 mismatch leaves the skin failed with the real reason, nothing installed", async () => {
  // 与清单字节数一致、内容不同 → 绕过长度预检，命中 sha256 校验（精确 20 字节）。
  const bogus = new Uint8Array("aurora-tarball-bytes".length).fill(1);
  assert.equal(bogus.byteLength, "aurora-tarball-bytes".length);
  const h = await createHarness({
    bodies: {
      "http://cache.test/dsh-eac-skin-aurora-1.2.0.tgz": bogus,
      "http://cache.test/dsh-eac-skin-xp-1.2.0.tgz": new TextEncoder().encode("xp-tarball-bytes"),
    },
  });
  try {
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 1); // 只有 xp
    const state = readProvisioningState(h.settings.state.value);
    const item = state?.items["@dsh-eac/skin-aurora"];
    assert.equal(item?.status, "failed");
    assert.match(item?.error ?? "", /sha256 mismatch/);
    // 损坏资产不得留在缓存正式位（.part 已清理 / 从未改名）。
    await assert.rejects(() =>
      stat(join(h.cacheDir.pathname.replace(/^\/(?=[A-Za-z]:)/, ""), "dsh-eac-skin-aurora-1.2.0.tgz")),
    );
  } finally {
    await h.cleanup();
  }
});

test("byte-count mismatch is rejected before install", async () => {
  const wrongSize = new TextEncoder().encode("aurora-tarball-bytes-but-longer");
  const h = await createHarness({
    bodies: {
      // 声明长度与清单一致、但流超发 → 有界读取必须拒收（content-length 预检骗不过）。
      "http://cache.test/dsh-eac-skin-aurora-1.2.0.tgz": { bytes: wrongSize, declaredLength: "aurora-tarball-bytes".length },
      "http://cache.test/dsh-eac-skin-xp-1.2.0.tgz": new TextEncoder().encode("xp-tarball-bytes"),
    },
  });
  try {
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 1);
    const state = readProvisioningState(h.settings.state.value);
    assert.match(state?.items["@dsh-eac/skin-aurora"]?.error ?? "", /byte count .* does not match/);
  } finally {
    await h.cleanup();
  }
});

test("network failure does not prevent other skins from provisioning", async () => {
  const h = await createHarness({
    bodies: {
      "http://cache.test/dsh-eac-skin-aurora-1.2.0.tgz": new Error("ECONNRESET"),
      "http://cache.test/dsh-eac-skin-xp-1.2.0.tgz": new TextEncoder().encode("xp-tarball-bytes"),
    },
  });
  try {
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 1);
    const state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.status, "failed");
    assert.equal(state?.items["@dsh-eac/skin-xp"]?.status, "installed");
  } finally {
    await h.cleanup();
  }
});

test("total attempts are capped; an explicit retry command resets them exactly once", async () => {
  const h = await createHarness({
    bodies: {
      "http://cache.test/dsh-eac-skin-aurora-1.2.0.tgz": new Error("boom"),
      "http://cache.test/dsh-eac-skin-xp-1.2.0.tgz": new TextEncoder().encode("xp-tarball-bytes"),
    },
    maxTotalAttempts: 2,
  });
  try {
    await h.runOnce();
    await h.runOnce();
    await h.runOnce(); // 第三轮：已达累计上限，不再尝试
    let state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.attempts, 2);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.status, "failed");

    // 用户点「重试失败项」→ 指令消费（kind → "consumed"）+ attempts 归零重新进入 pending。
    h.settings.state.value.provisionCommand = { kind: "retry", at: "now" };
    h.settings.state.revision += 1;
    await h.runOnce();
    state = readProvisioningState(h.settings.state.value);
    // 回归（真实宿主深合并语义）：指令必须被覆盖为已消费，而不是残留 kind:"retry"。
    const command = h.settings.state.value.provisionCommand as { kind?: string } | undefined;
    assert.equal(command?.kind, "consumed");
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.status, "failed");
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.attempts, 1);
    // aurora 下载必败 → installBundle 永不触达；计数里只有 xp 首轮那一次成功安装。
    assert.equal(h.manager.installCalls.length, 1);

    // 后续 cycle（无新指令）：累计上限内的自动重试恰好一次（attempts 1→2），
    // 然后停 failed——残留的旧指令不得再次重置 attempts（无限重试回归）。
    await h.runOnce();
    state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.attempts, 2);
    assert.equal(h.manager.installCalls.length, 1);

    await h.runOnce();
    state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.status, "failed");
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.attempts, 2);
    assert.equal(h.manager.installCalls.length, 1);
  } finally {
    await h.cleanup();
  }
});

test("a consumed retry command neither retries again nor bypasses the autoProvision toggle", async () => {
  const h = await createHarness({
    bodies: {
      "http://cache.test/dsh-eac-skin-aurora-1.2.0.tgz": new Error("boom"),
      "http://cache.test/dsh-eac-skin-xp-1.2.0.tgz": new TextEncoder().encode("xp-tarball-bytes"),
    },
    maxTotalAttempts: 2,
  });
  try {
    await h.runOnce();
    await h.runOnce(); // aurora attempts=2 → capped failed
    // 用户点了重试，随后立刻关掉自动补齐开关。
    h.settings.state.value.provisionCommand = { kind: "retry", at: "t1" };
    h.settings.state.value.autoProvision = false;
    h.settings.state.revision += 1;
    await h.runOnce(); // 显式 retry：消费指令、重置并尝试一次（attempts 0→1；xp 已装，计数不变）
    assert.equal(h.manager.installCalls.length, 1);
    const state = readProvisioningState(h.settings.state.value);
    assert.equal(state?.items["@dsh-eac/skin-aurora"]?.attempts, 1);

    // 之后每轮都必须被「开关关闭 + 无有效指令」拦下：不再有新尝试。
    await h.runOnce();
    await h.runOnce();
    assert.equal(h.manager.installCalls.length, 1);
    const later = readProvisioningState(h.settings.state.value);
    assert.equal(later?.items["@dsh-eac/skin-aurora"]?.attempts, 1);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 控制台投影（client 侧）
// ---------------------------------------------------------------------------

test("projectProvisioningView counts statuses and survives a missing host section", () => {
  const empty = projectProvisioningView(undefined);
  assert.equal(empty.available, false);
  assert.equal(empty.enabled, true);

  const view = projectProvisioningView({
    autoProvision: true,
    provisioning: {
      version: 1,
      releaseSet: "v1.2.0",
      items: {
        "@dsh-eac/skin-aurora": { status: "installed", targetVersion: "1.2.0", attempts: 1, updatedAt: "t", installedVersion: "1.2.0" },
        "@dsh-eac/skin-xp": { status: "failed", targetVersion: "1.2.0", attempts: 2, updatedAt: "t", error: "boom" },
        "@dsh-eac/skin-qq98": { status: "present", targetVersion: "1.2.0", attempts: 0, updatedAt: "t", installedVersion: "0.9.0" },
      },
    },
  });
  assert.equal(view.available, true);
  assert.equal(view.counts.installed, 1);
  assert.equal(view.counts.failed, 1);
  assert.equal(view.counts.present, 1);
  assert.deepEqual(view.items.map((item) => item.name), [
    "@dsh-eac/skin-aurora",
    "@dsh-eac/skin-qq98",
    "@dsh-eac/skin-xp",
  ]);
});

test("provisioning facade reads the namespace and writes toggle/retry commands", async () => {
  const settings = fakeSettings({
    autoProvision: true,
    provisioning: { version: 1, releaseSet: "v1.2.0", items: {} },
  });
  const adapter = {
    settings: {
      get() {
        let listeners: Array<() => void> = [];
        return {
          getSnapshot: () => ({ status: "ready", value: settings.state.value, revision: settings.state.revision, writable: true }),
          get: () => ({ status: "ready", value: settings.state.value, revision: settings.state.revision, writable: true }),
          subscribe(listener: () => void) {
            listeners = [...listeners, listener];
            return () => {
              listeners = listeners.filter((l) => l !== listener);
            };
          },
          async set(field: string, value: unknown) {
            settings.state.value = { ...settings.state.value, [field]: value };
            settings.state.revision += 1;
            for (const listener of listeners) listener();
            return true;
          },
        };
      },
    },
  } as never;
  const facade = createProvisioningFacade(adapter);
  const view = facade.snapshot();
  assert.equal(view.available, true);
  assert.equal(view.enabled, true);
  assert.equal(await facade.setEnabled(false), true);
  assert.equal(facade.snapshot().enabled, false);
  assert.equal(await facade.requestRetry(), true);
  const command = settings.state.value.provisionCommand as { kind?: string } | undefined;
  assert.equal(command?.kind, "retry");
});
