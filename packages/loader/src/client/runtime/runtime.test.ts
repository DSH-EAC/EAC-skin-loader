/**
 * SkinRuntime 状态机单测（T2.4）。brief §6 测试清单的下限全覆盖 + 补充路径。
 *
 * 确定性策略：全部超时走注入的 fake 时钟（手动 advance，不真实等待 10s）；
 * settings / slots / remote 均为按 api-notes 语义形状构造的 fakes。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  DshAdapter,
  DshSettingsForm,
  SettingsSnapshot,
} from "../../adapter/types.ts";
import {
  DEFAULT_SKIN_ID,
  SETTINGS_NAMESPACE,
  type FaultEntry,
  type LoaderSettingsValue,
  type SkinRegistration,
} from "../../protocol.ts";
import { createSkinRuntime, type SkinRuntimeController } from "./runtime.ts";
// ---------------------------------------------------------------------- fakes

/** 手动推进的 fake 时钟：timers 面与 runtime 的 Timers 接口一致。 */
function createFakeClock() {
  let nowMs = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers = {
    setTimeout(fn: () => void, ms: number): unknown {
      const id = ++seq;
      pending.set(id, { at: nowMs + ms, fn });
      return id;
    },
    clearTimeout(handle: unknown): void {
      pending.delete(handle as number);
    },
  };
  /** 让全部挂起微任务跑完（macrotask 泵，与 fake 时钟无关）。 */
  const pump = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  async function advance(ms: number): Promise<void> {
    const target = nowMs + ms;
    for (;;) {
      let bestId: number | undefined;
      let bestAt = Number.POSITIVE_INFINITY;
      for (const [id, timer] of pending) {
        if (timer.at <= target && timer.at < bestAt) {
          bestAt = timer.at;
          bestId = id;
        }
      }
      if (bestId === undefined) {
        break;
      }
      const timer = pending.get(bestId);
      pending.delete(bestId);
      nowMs = Math.max(nowMs, bestAt);
      timer?.fn();
      await pump();
    }
    nowMs = target;
    await pump();
  }
  return { timers, advance, pump, now: () => nowMs, pendingCount: () => pending.size };
}

/** api-notes §8.2 语义形状的 fake settings form（ready 前提下稳定引用）。 */
function createFakeSettings(initial: Partial<LoaderSettingsValue> = {}) {
  let snapshot: SettingsSnapshot<LoaderSettingsValue> = {
    status: "ready",
    value: {
      activeSkin: DEFAULT_SKIN_ID,
      faultLog: [],
      diagnosticsEnabled: false,
      ...initial,
    },
    revision: 1,
    writable: true,
  };
  const listeners = new Set<() => void>();
  const writes: Array<{ field: string; value: unknown }> = [];
  const pendingRemote = new Map<string, unknown>();
  let failNextWrite = false;
  const form: DshSettingsForm<LoaderSettingsValue> = {
    get: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async set(field: string, value: unknown) {
      writes.push({ field, value: structuredClone(value) });
      if (failNextWrite) {
        failNextWrite = false;
        return false;
      }
      snapshot = {
        ...snapshot,
        value: { ...snapshot.value, [field]: structuredClone(value) },
        revision: snapshot.revision + 1,
      };
      for (const listener of [...listeners]) {
        listener();
      }
      return true;
    },
  };
  return {
    form,
    listenerCount: () => listeners.size,
    writes,
    failNextWrite() {
      failNextWrite = true;
    },
    setLoading() {
      snapshot = { ...snapshot, status: "loading" };
    },
    setReady() {
      snapshot = { ...snapshot, status: "ready" };
      for (const listener of [...listeners]) {
        listener();
      }
    },
    setUnavailable() {
      snapshot = { ...snapshot, status: "unavailable" };
    },
    /** 模拟「远端（其他标签页）写入了该命名空间」。 */
    setRemoteValue(field: string, value: unknown) {
      snapshot = {
        ...snapshot,
        value: { ...snapshot.value, [field]: structuredClone(value) },
        revision: snapshot.revision + 1,
      };
      for (const listener of [...listeners]) {
        listener();
      }
    },
    /**
     * 模拟「document-updated 事件已到达、但本端 mirror 尚未回源」：远端文档已变，
     * 本端快照对象仍是旧值（实机上 mirror.load() 是事件之后的异步回源）。
     */
    setRemoteValueSilent(field: string, value: unknown) {
      pendingRemote.set(field, structuredClone(value));
    },
    /** 模拟 mirror.load() 完成：远端文档回源到本端快照并通知订阅者（不伴随新事件）。 */
    flushMirrorReload() {
      if (pendingRemote.size === 0) {
        return;
      }
      snapshot = {
        ...snapshot,
        value: { ...snapshot.value, ...Object.fromEntries(pendingRemote) },
        revision: snapshot.revision + 1,
      };
      pendingRemote.clear();
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

/** 语义形状的 fake adapter（slots 记账 + remote 事件收集）。 */
function createFakeAdapter(settings: ReturnType<typeof createFakeSettings>) {
  const remoteListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const slotEntries: Array<{ name: string; dispose: () => void; disposed: boolean }> = [];
  const injectEntries: Array<{ key: string; callback: () => unknown; disposed: boolean }> = [];
  const adapter: DshAdapter = {
    slots: {
      register(options, component) {
        const entry = {
          name: (options as { name: string }).name,
          component,
          disposed: false,
          dispose: () => {
            entry.disposed = true;
          },
        };
        slotEntries.push(entry);
        return () => entry.dispose();
      },
      inject(key, callback) {
        const entry = {
          key,
          callback,
          disposed: false,
          dispose: () => {
            entry.disposed = true;
          },
        };
        injectEntries.push(entry);
        return () => entry.dispose();
      },
    },
    theme: {} as DshAdapter["theme"],
    settings: {
      get<T = Record<string, unknown>>(entryId: string): DshSettingsForm<T> {
        assert.equal(entryId, SETTINGS_NAMESPACE);
        return settings.form as unknown as DshSettingsForm<T>;
      },
    },
    locale: {} as DshAdapter["locale"],
    remote: {
      $on(event: string, listener: (...args: unknown[]) => void) {
        let set = remoteListeners.get(event);
        if (!set) {
          set = new Set();
          remoteListeners.set(event, set);
        }
        set.add(listener);
        return () => {
          set?.delete(listener);
        };
      },
    },
    events: {
      on: () => () => undefined,
    },
    hostInfo: { dshVersion: null, bootRev: null },
  };
  return {
    adapter,
    emitRemote(event: string, ...args: unknown[]) {
      for (const listener of remoteListeners.get(event) ?? []) {
        listener(...args);
      }
    },
    remoteListenerCount: (event: string) => remoteListeners.get(event)?.size ?? 0,
    slotEntries,
    injectEntries,
  };
}

interface FakeSkin extends SkinRegistration {
  calls: string[];
}

function makeSkin(id: string, overrides: Partial<SkinRegistration> = {}): FakeSkin {
  const skin: FakeSkin = {
    apiVersion: "dsh.ecosystem.ui-skin-loader/v1",
    id,
    name: `Skin ${id}`,
    version: "1.0.0",
    activate() {
      return undefined;
    },
    deactivate() {
      return undefined;
    },
    calls: [],
    ...overrides,
  };
  // 调用记账独立于 override 行为：wrapper 先记账再委托用户的 activate/deactivate。
  const userActivate = skin.activate.bind(skin);
  skin.activate = (ctx) => {
    skin.calls.push("activate");
    return userActivate(ctx);
  };
  const userDeactivate = skin.deactivate.bind(skin);
  skin.deactivate = () => {
    skin.calls.push("deactivate");
    return userDeactivate();
  };
  return skin;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  clock: ReturnType<typeof createFakeClock>;
  settings: ReturnType<typeof createFakeSettings>;
  remote: ReturnType<typeof createFakeAdapter>;
  runtime: SkinRuntimeController;
  service: ReturnType<SkinRuntimeController["expose"]>;
  offStart: () => unknown;
}

/** 标准夹具：settings ready（无恢复路径）、fake 时钟、默认 25ms 超时。 */
function createHarness(options?: {
  initialSettings?: Partial<LoaderSettingsValue>;
  timeouts?: { deactivateMs?: number; activateMs?: number };
  recovery?: { readyMs?: number; graceMs?: number };
  unregisterGraceMs?: number;
}): Harness {
  const clock = createFakeClock();
  const settings = createFakeSettings(options?.initialSettings);
  const remote = createFakeAdapter(settings);
  const runtime = createSkinRuntime({
    adapter: remote.adapter,
    timers: clock.timers,
    timeouts: options?.timeouts ?? { deactivateMs: 25, activateMs: 25 },
    recovery: options?.recovery ?? { readyMs: 25, graceMs: 25 },
    unregisterGraceMs: options?.unregisterGraceMs ?? 50,
  });
  const service = runtime.expose();
  const offStart = runtime.start();
  return { clock, settings, remote, runtime, service, offStart };
}

const lastActiveSkinWrite = (settings: ReturnType<typeof createFakeSettings>): unknown => {
  for (let i = settings.writes.length - 1; i >= 0; i--) {
    const write = settings.writes[i];
    if (write?.field === "activeSkin") {
      return write.value;
    }
  }
  return undefined;
};

const lastFaultLogWrite = (settings: ReturnType<typeof createFakeSettings>): FaultEntry[] => {
  for (let i = settings.writes.length - 1; i >= 0; i--) {
    const write = settings.writes[i];
    if (write?.field === "faultLog") {
      return write.value as FaultEntry[];
    }
  }
  return [];
};

// ------------------------------------------------------------------- 正常切换

test("normal switch A→B→default: call order, statuses, current, persistence", async () => {
  const h = createHarness();
  const a = makeSkin("alpha");
  const b = makeSkin("beta");
  h.service.registerSkin(a);
  h.service.registerSkin(b);

  const first = await h.service.switchTo("alpha");
  assert.deepEqual(first, { ok: true });
  assert.equal(h.service.current(), "alpha");
  assert.deepEqual(a.calls, ["activate"]);
  assert.deepEqual(
    h.service.list().map((info) => [info.id, info.status]),
    [
      ["alpha", "active"],
      ["beta", "discovered"],
    ],
  );
  assert.equal(lastActiveSkinWrite(h.settings), "alpha");

  const second = await h.service.switchTo("beta");
  assert.deepEqual(second, { ok: true });
  assert.deepEqual(a.calls, ["activate", "deactivate"]);
  assert.deepEqual(b.calls, ["activate"]);
  assert.equal(h.service.current(), "beta");
  assert.equal(lastActiveSkinWrite(h.settings), "beta");

  const third = await h.service.switchTo(DEFAULT_SKIN_ID);
  assert.deepEqual(third, { ok: true });
  assert.deepEqual(b.calls, ["activate", "deactivate"]);
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
  assert.deepEqual(
    h.service.list().map((info) => info.status),
    ["discovered", "discovered"],
  );
});

test("switchTo validates: unregistered target, already-active target, default already on", async () => {
  const h = createHarness();
  const a = makeSkin("alpha");
  h.service.registerSkin(a);

  const unregistered = await h.service.switchTo("ghost");
  assert.equal(unregistered.ok, false);
  assert.match(unregistered.ok ? "" : unregistered.error, /not registered/);

  await h.service.switchTo("alpha");
  const alreadyActive = await h.service.switchTo("alpha");
  assert.equal(alreadyActive.ok, false);
  assert.match(alreadyActive.ok ? "" : alreadyActive.error, /already active/);
  assert.equal(alreadyActive.ok ? "" : alreadyActive.rolledBackTo, "alpha");
  assert.deepEqual(a.calls, ["activate"]); // 未发生重复 deactivate/activate

  await h.service.switchTo(DEFAULT_SKIN_ID); // 手动停用：合法切换
  const alreadyDefault = await h.service.switchTo(DEFAULT_SKIN_ID);
  assert.equal(alreadyDefault.ok, false);
  assert.match(alreadyDefault.ok ? "" : alreadyDefault.error, /already active/);
  assert.deepEqual(a.calls, ["activate", "deactivate"]);
});

test("subscribe notifies on register/switch/unregister and honors unsubscribe", async () => {
  const h = createHarness();
  const events: string[] = [];
  const off = h.service.subscribe(() => {
    events.push("change");
  });
  const a = makeSkin("alpha");
  const offSkin = h.service.registerSkin(a);
  await h.service.switchTo("alpha");
  assert.equal(events.length, 2); // register + switch 落定
  off();
  offSkin();
  assert.equal(events.length, 2); // 反登记不再通知
});

test("SkinSlotHandle registrations are tracked and reverse-disposed on switch away", async () => {
  const h = createHarness();
  const a = makeSkin("alpha", {
    activate(ctx) {
      ctx.slots.register({ kind: "list", name: "settings.section", id: "alpha-section" }, () => null);
      ctx.slots.inject("settings.section", () => undefined);
    },
  });
  h.service.registerSkin(a);
  await h.service.switchTo("alpha");
  assert.equal(h.remote.slotEntries.length, 1);
  assert.equal(h.remote.injectEntries.length, 1);
  assert.equal(h.remote.slotEntries[0]?.disposed, false);
  await h.service.switchTo(DEFAULT_SKIN_ID);
  assert.equal(h.remote.slotEntries[0]?.disposed, true);
  assert.equal(h.remote.injectEntries[0]?.disposed, true);
});

// ------------------------------------------------------- activate 失败 → 回滚

test("activate throwing rolls back to default, deactivates the half-activated skin, marks fault", async () => {
  const h = createHarness();
  const a = makeSkin("alpha");
  const b = makeSkin("beta", {
    activate() {
      throw new Error("boom during activate");
    },
  });
  h.service.registerSkin(a);
  h.service.registerSkin(b);
  await h.service.switchTo("alpha");

  const result = await h.service.switchTo("beta");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /threw: boom during activate/);
  assert.equal(result.ok ? "" : result.rolledBackTo, DEFAULT_SKIN_ID);
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  // 新皮肤 deactivate 兜底被调用（公约 §4.4：不得残留半个新皮肤）
  assert.deepEqual(b.calls, ["activate", "deactivate"]);
  // fault 标记 + faultLog
  const statusOf = (id: string) => h.service.list().find((info) => info.id === id)?.status;
  assert.equal(statusOf("beta"), "fault");
  const faults = lastFaultLogWrite(h.settings);
  const activateFault = faults.find((entry) => entry.kind === "activate-failed");
  assert.ok(activateFault);
  assert.equal(activateFault.skinId, "beta");
  assert.match(activateFault.message, /boom during activate/);
  // 回滚落盘 default
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
  assert.deepEqual(a.calls, ["activate", "deactivate"]);
});

test("activate timeout aborts the skin signal, rolls back to default via fake clock", async () => {
  const h = createHarness();
  const b = makeSkin("beta", {
    activate(ctx) {
      // 永不返回的激活；skin 收到的 signal 应在超时后被 abort
      return new Promise<void>(() => {
        ctx.signal.addEventListener("abort", () => b.calls.push("signal-aborted"));
      });
    },
  });
  h.service.registerSkin(b);
  const pending = h.service.switchTo("beta");
  await h.clock.pump();
  await h.clock.advance(25); // activateMs = 25

  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /timed out after 25ms/);
  assert.equal(result.ok ? "" : result.rolledBackTo, DEFAULT_SKIN_ID);
  assert.deepEqual(b.calls, ["activate", "signal-aborted", "deactivate"]);
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  assert.equal(h.service.list().find((info) => info.id === "beta")?.status, "fault");
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
});

test("persist failure degrades honestly: ok:true with warning, faultLog entry, local state kept", async () => {
  const h = createHarness();
  const a = makeSkin("alpha");
  h.service.registerSkin(a);
  h.settings.failNextWrite();
  const result = await h.service.switchTo("alpha");
  assert.equal(result.ok, true);
  assert.match(result.ok ? (result.warning ?? "") : "", /failed to persist activeSkin="alpha"/);
  assert.equal(h.service.current(), "alpha");
  const faults = lastFaultLogWrite(h.settings);
  assert.equal(faults.at(-1)?.kind, "persist-failed");
});

// ------------------------------------------------- deactivate 超时/抛错（触发 5 前置）

test("deactivate timeout marks suspect-residue and the switch continues (fake clock)", async () => {
  const h = createHarness();
  const release = deferred();
  const a = makeSkin("alpha", {
    deactivate() {
      return release.promise; // 永不完成的 deactivate
    },
  });
  const b = makeSkin("beta");
  h.service.registerSkin(a);
  h.service.registerSkin(b);
  await h.service.switchTo("alpha");

  const pending = h.service.switchTo("beta");
  await h.clock.pump();
  await h.clock.advance(25); // deactivateMs = 25
  const result = await pending;

  assert.equal(result.ok, true);
  assert.match(result.ok ? (result.warning ?? "") : "", /timed out after 25ms.*suspect-residue/);
  assert.equal(h.service.current(), "beta");
  assert.deepEqual(b.calls, ["activate"]);
  assert.equal(h.service.list().find((info) => info.id === "alpha")?.status, "suspect-residue");
  const faults = lastFaultLogWrite(h.settings);
  assert.equal(faults.at(-1)?.kind, "deactivate-timeout");
  assert.equal(lastActiveSkinWrite(h.settings), "beta");
});

test("deactivate throwing takes the same suspect-residue path", async () => {
  const h = createHarness();
  const a = makeSkin("alpha", {
    deactivate() {
      throw new Error("cleanup exploded");
    },
  });
  const b = makeSkin("beta");
  h.service.registerSkin(a);
  h.service.registerSkin(b);
  await h.service.switchTo("alpha");

  const result = await h.service.switchTo("beta");
  assert.equal(result.ok, true);
  assert.match(result.ok ? (result.warning ?? "") : "", /cleanup exploded/);
  assert.equal(h.service.list().find((info) => info.id === "alpha")?.status, "suspect-residue");
  assert.equal(lastFaultLogWrite(h.settings).at(-1)?.kind, "deactivate-failed");
  assert.equal(h.service.current(), "beta");
});

// ------------------------------------------------------------------- generation

test("generation: a newer switchTo supersedes the in-flight one and aborts its activation signal", async () => {
  const h = createHarness();
  const release = deferred();
  const a = makeSkin("alpha");
  const b = makeSkin("beta", {
    activate(ctx) {
      ctx.signal.addEventListener("abort", () => b.calls.push("signal-aborted"));
      return release.promise;
    },
  });
  const c = makeSkin("gamma");
  h.service.registerSkin(a);
  h.service.registerSkin(b);
  h.service.registerSkin(c);
  await h.service.switchTo("alpha");

  const first = h.service.switchTo("beta");
  await h.clock.pump(); // 旧皮肤 deactivate 完成，beta 激活在途
  const second = h.service.switchTo("gamma");
  release.resolve();

  const firstResult = await first;
  const secondResult = await second;

  assert.equal(firstResult.ok, false);
  assert.match(firstResult.ok ? "" : firstResult.error, /superseded/);
  assert.equal(secondResult.ok, true);
  // 旧激活的 signal 被中止 + 新皮肤 deactivate 兜底（半激活不残留）
  assert.deepEqual(b.calls, ["activate", "signal-aborted", "deactivate"]);
  assert.equal(h.service.current(), "gamma");
  assert.equal(lastActiveSkinWrite(h.settings), "gamma");
});

test("superseding during the deactivate phase settles the stale run as superseded", async () => {
  const h = createHarness();
  const release = deferred();
  const a = makeSkin("alpha", {
    deactivate() {
      return release.promise;
    },
  });
  const b = makeSkin("beta");
  h.service.registerSkin(a);
  h.service.registerSkin(b);
  await h.service.switchTo("alpha");

  const first = h.service.switchTo("beta");
  await h.clock.pump(); // alpha 的 deactivate 在途
  // 二号请求指向未登记目标：旧 run 作废后它的校验自然失败，机器落回 default。
  const second = h.service.switchTo("ghost");
  release.resolve();

  const firstResult = await first;
  const secondResult = await second;
  assert.equal(firstResult.ok, false);
  assert.match(firstResult.ok ? "" : firstResult.error, /superseded/);
  assert.equal(secondResult.ok, false);
  assert.match(secondResult.ok ? "" : secondResult.error, /not registered/);
  assert.equal(h.service.current(), DEFAULT_SKIN_ID); // 旧皮肤已退出，无新皮肤接管
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
});

// -------------------------------------------------------------------- 隔离重试

test("explicit retry clears the fault mark once and re-activates (covenant §4.3.5)", async () => {
  const h = createHarness();
  let shouldFail = true;
  const b = makeSkin("beta", {
    activate() {
      if (shouldFail) {
        throw new Error("first attempt fails");
      }
    },
  });
  h.service.registerSkin(b);
  const first = await h.service.switchTo("beta");
  assert.equal(first.ok, false);
  assert.equal(h.service.list().find((info) => info.id === "beta")?.status, "fault");

  shouldFail = false;
  const retry = await h.service.switchTo("beta");
  assert.deepEqual(retry, { ok: true });
  assert.equal(h.service.current(), "beta");
  assert.equal(h.service.list().find((info) => info.id === "beta")?.status, "active");
  const retryFault = lastFaultLogWrite(h.settings).at(-1);
  assert.equal(retryFault?.kind, "explicit-retry");
});

test("explicit retry also clears suspect-residue", async () => {
  const h = createHarness();
  const release = deferred();
  const a = makeSkin("alpha", {
    deactivate() {
      return release.promise;
    },
  });
  const b = makeSkin("beta");
  h.service.registerSkin(a);
  h.service.registerSkin(b);
  await h.service.switchTo("alpha");
  const pending = h.service.switchTo("beta");
  await h.clock.pump();
  await h.clock.advance(25);
  await pending;
  assert.equal(h.service.list().find((info) => info.id === "alpha")?.status, "suspect-residue");

  release.resolve();
  await h.clock.pump();
  const retry = await h.service.switchTo("alpha");
  assert.deepEqual(retry, { ok: true });
  assert.equal(h.service.list().find((info) => info.id === "alpha")?.status, "active");
});

// ------------------------------------------------------------------- 启动恢复

test("recovery replays a persisted registered skin through the switch machinery", async () => {
  const h = createHarness({ initialSettings: { activeSkin: "alpha" } });
  const a = makeSkin("alpha");
  h.service.registerSkin(a);
  await h.clock.pump(); // 恢复流程（宽限期内登记即刻唤醒）

  assert.equal(h.service.current(), "alpha");
  assert.deepEqual(a.calls, ["activate"]);
  assert.equal(h.service.list().find((info) => info.id === "alpha")?.status, "active");
  // 重放走同一状态机：落盘一致
  assert.equal(lastActiveSkinWrite(h.settings), "alpha");
});

test("recovery waits in the grace window for a late registration, then activates", async () => {
  const h = createHarness({
    initialSettings: { activeSkin: "alpha" },
    recovery: { readyMs: 25, graceMs: 100 },
  });
  await h.clock.pump(); // 恢复进入等待登记
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);

  const a = makeSkin("alpha");
  h.service.registerSkin(a); // 宽限期内登记 → 立即唤醒
  await h.clock.pump();
  assert.equal(h.service.current(), "alpha");
});

test("recovery falls back to default and rewrites persistence for an unregistered skin", async () => {
  const h = createHarness({
    initialSettings: { activeSkin: "ghost" },
    recovery: { readyMs: 25, graceMs: 50 },
  });
  await h.clock.pump(); // 恢复先落定，宽限计时器才登记
  await h.clock.advance(50); // 宽限期耗尽

  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
  const faults = lastFaultLogWrite(h.settings);
  assert.equal(faults.at(-1)?.kind, "recovery-unregistered");
  assert.match(faults.at(-1)?.message ?? "", /ghost/);
});

test("recovery failure (activate throws) falls back to default with a recovery-fault entry", async () => {
  const h = createHarness({ initialSettings: { activeSkin: "alpha" } });
  const a = makeSkin("alpha", {
    activate() {
      throw new Error("broken on boot");
    },
  });
  h.service.registerSkin(a);
  await h.clock.pump();

  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
  const kinds = lastFaultLogWrite(h.settings).map((entry) => entry.kind);
  assert.ok(kinds.includes("activate-failed"));
  assert.ok(kinds.includes("recovery-failed"));
});

test("recovery is skipped when a user switch already took over during startup", async () => {
  const h = createHarness({ initialSettings: { activeSkin: "alpha" } });
  const a = makeSkin("alpha");
  const b = makeSkin("beta");
  h.service.registerSkin(a);
  h.service.registerSkin(b);
  await h.service.switchTo("beta"); // 恢复完成前用户已切换
  await h.clock.advance(100); // 恢复宽限耗尽

  assert.equal(h.service.current(), "beta");
  assert.deepEqual(a.calls, []); // 恢复未重放 alpha
});

test("recovery skips silently when the settings namespace is unavailable", async () => {
  const clock = createFakeClock();
  const settings = createFakeSettings({ activeSkin: "alpha" });
  settings.setUnavailable();
  const remote = createFakeAdapter(settings);
  const runtime = createSkinRuntime({
    adapter: remote.adapter,
    timers: clock.timers,
    recovery: { readyMs: 25, graceMs: 25 },
  });
  const offStart = runtime.start();
  await clock.advance(25);
  assert.equal(runtime.expose().current(), DEFAULT_SKIN_ID);
  await offStart();
});

test("recovery waits for the settings namespace to become ready (loading state)", async () => {
  const clock = createFakeClock();
  const settings = createFakeSettings({ activeSkin: DEFAULT_SKIN_ID });
  settings.setLoading();
  const remote = createFakeAdapter(settings);
  const runtime = createSkinRuntime({
    adapter: remote.adapter,
    timers: clock.timers,
    recovery: { readyMs: 200, graceMs: 25 },
  });
  const offStart = runtime.start();
  await clock.pump();
  settings.setReady();
  await clock.pump();
  await offStart();
  // 未超时、未误判 unavailable：faultLog 无恢复事件
  const faults = lastFaultLogWrite(settings);
  assert.equal(faults.length, 0);
});

// --------------------------------------------------------------- 跨标签页同步

test("cross-tab: remote activeSkin change triggers a local replay", async () => {
  const h = createHarness();
  const a = makeSkin("alpha");
  h.service.registerSkin(a);
  assert.equal(h.remote.remoteListenerCount("settings/document-updated"), 1);

  h.settings.setRemoteValue("activeSkin", "alpha"); // 其他标签页切到 alpha
  h.remote.emitRemote("settings/document-updated", SETTINGS_NAMESPACE, 2);
  await h.clock.pump();

  assert.equal(h.service.current(), "alpha");
  assert.deepEqual(a.calls, ["activate"]);
});

test("cross-tab: identical persisted value is an idempotent no-op (self echo)", async () => {
  const h = createHarness();
  const a = makeSkin("alpha");
  h.service.registerSkin(a);
  await h.service.switchTo("alpha");
  assert.deepEqual(a.calls, ["activate"]);

  h.remote.emitRemote("settings/document-updated", SETTINGS_NAMESPACE, 3);
  await h.clock.pump();
  assert.deepEqual(a.calls, ["activate"]); // 幂等跳过
  assert.equal(h.service.current(), "alpha");
});

test("cross-tab: foreign-namespace events alone do not replay", async () => {
  const h = createHarness();
  const a = makeSkin("alpha");
  h.service.registerSkin(a);

  // 只有他人命名空间的事件广播、本命名空间快照没有任何变化 → 无事可做
  h.remote.emitRemote("settings/document-updated", "some-other-namespace", 9);
  await h.clock.pump();
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  assert.deepEqual(a.calls, []);
});

test("cross-tab: our namespace snapshot refresh converges even when announced by a foreign-namespace event", async () => {
  // 实机语义（dsh-client-ui-settings L1512）：mirror.load() 在**任何** document-updated
  // 事件上都全量回源——他人命名空间的事件也可能让本命名空间的快照刷新（例如上一条
  // 事件丢失时）。快照变化本身（第二触发源）必须驱动收敛。
  const h = createHarness();
  const a = makeSkin("alpha");
  h.service.registerSkin(a);

  h.settings.setRemoteValueSilent("activeSkin", "alpha");
  h.remote.emitRemote("settings/document-updated", "some-other-namespace", 9);
  await h.clock.pump();
  assert.equal(h.service.current(), DEFAULT_SKIN_ID); // 事件当下快照未回源

  h.settings.flushMirrorReload();
  await h.clock.pump();
  assert.equal(h.service.current(), "alpha"); // 回源后收敛
  assert.deepEqual(a.calls, ["activate"]);
});

test("cross-tab: replay deferred while a local switch is in flight", async () => {
  const h = createHarness();
  const release = deferred();
  const a = makeSkin("alpha", {
    activate() {
      return release.promise;
    },
  });
  h.service.registerSkin(a);
  const pending = h.service.switchTo("alpha");
  await h.clock.pump();
  // 在途期间远端写入 alpha 并广播（本 tab 落盘前的旧事件）
  h.remote.emitRemote("settings/document-updated", SETTINGS_NAMESPACE, 2);
  release.resolve();
  const result = await pending;
  assert.deepEqual(result, { ok: true });
  await h.clock.pump();
  assert.equal(h.service.current(), "alpha");
  assert.deepEqual(a.calls, ["activate"]); // 落定后 syncCheck 发现一致 → 幂等
});

test("cross-tab: late mirror reload (no second event) still converges — real-machine race", async () => {
  // 实机缺陷复现：document-updated 到达时本端 mirror 还是旧值（上游 mirror.load()
  // 是事件后的异步回源），syncCheck 读旧快照幂等跳过 → 永不重放。
  // 回归锁定：快照回源（form change，无新事件）必须再次调度 syncCheck。
  const h = createHarness();
  const a = makeSkin("alpha");
  h.service.registerSkin(a);

  // 1) 远端写入已发生，但本端 mirror 未回源；2) 事件到达（读到旧值 → 跳过）；3) mirror 回源
  h.settings.setRemoteValueSilent("activeSkin", "alpha");
  h.remote.emitRemote("settings/document-updated", SETTINGS_NAMESPACE, 2);
  await h.clock.pump();
  assert.equal(h.service.current(), DEFAULT_SKIN_ID); // 事件当下读到旧值：尚未跟随

  h.settings.flushMirrorReload();
  await h.clock.pump();
  assert.equal(h.service.current(), "alpha"); // 回源后收敛
  assert.deepEqual(a.calls, ["activate"]);
});

// ------------------------------------------------------------------ 登记协议

test("registerSkin rejects covenant-illegal ids and unknown apiVersion majors with readable reasons", async () => {
  const h = createHarness();
  h.service.registerSkin(makeSkin("bad id!", { id: "bad id!" }));
  h.service.registerSkin(makeSkin("v2", { apiVersion: "dsh.ecosystem.ui-skin-loader/v2" }));
  h.service.registerSkin(makeSkin("garbage", { apiVersion: "not-a-version" }));

  const infos = h.service.list();
  const badId = infos.find((info) => info.id === "bad id!");
  assert.match(badId?.incompatible ?? "", /covenant id pattern/);
  const v2 = infos.find((info) => info.id === "v2");
  assert.match(v2?.incompatible ?? "", /declares major v2, but this loader implements v1/);
  const garbage = infos.find((info) => info.id === "garbage");
  assert.match(garbage?.incompatible ?? "", /not a dsh\.ecosystem\.ui-skin-loader\/v\{N\} version/);

  // 不兼容的皮肤拒绝激活
  for (const id of ["bad id!", "v2", "garbage"]) {
    const result = await h.service.switchTo(id);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /incompatible/);
  }
});

test("registerSkin throws TypeErrors for structurally invalid registrations", () => {
  const h = createHarness();
  assert.throws(() => h.service.registerSkin({} as SkinRegistration), TypeError);
  assert.throws(
    () =>
      h.service.registerSkin({
        apiVersion: "dsh.ecosystem.ui-skin-loader/v1",
        id: "alpha",
        name: "A",
        version: "1.0.0",
        activate: () => {},
        deactivate: "not a function" as unknown as () => void,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      h.service.registerSkin({
        apiVersion: "dsh.ecosystem.ui-skin-loader/v1",
        id: "",
        name: "A",
        version: "1.0.0",
        activate: () => {},
        deactivate: () => {},
      }),
    TypeError,
  );
});

test("unregister: off() removes the skin from the discovered table (fiber dispose semantics)", async () => {
  const h = createHarness();
  const a = makeSkin("alpha");
  const off = h.service.registerSkin(a);
  assert.equal(h.service.list().length, 1);
  off();
  assert.equal(h.service.list().length, 0);
  off(); // 幂等 no-op
  assert.equal(h.service.list().length, 0);
  const result = await h.service.switchTo("alpha");
  assert.equal(result.ok, false);
});

test("re-registering the same id replaces the entry and voids the stale off() (HMR)", async () => {
  const h = createHarness();
  const first = makeSkin("alpha", { version: "1.0.0" });
  const offFirst = h.service.registerSkin(first);
  const second = makeSkin("alpha", { version: "2.0.0" });
  const offSecond = h.service.registerSkin(second);
  offFirst(); // stale off 不得移除新登记
  assert.equal(h.service.list().length, 1);
  assert.equal(h.service.list()[0]?.version, "2.0.0");
  offSecond();
  assert.equal(h.service.list().length, 0);
});

test("unregistering an ACTIVE skin (host-side disable): ledger revoked immediately, falls back to default after grace expiry", async () => {
  const h = createHarness({ unregisterGraceMs: 50 });
  const a = makeSkin("alpha", {
    activate(ctx) {
      ctx.slots.register({ kind: "list", name: "settings.section", id: "alpha-section" }, () => null);
      ctx.slots.inject("settings.section", () => undefined);
    },
  });
  const off = h.service.registerSkin(a);
  await h.service.switchTo("alpha");
  assert.equal(h.remote.slotEntries[0]?.disposed, false);
  assert.equal(h.service.current(), "alpha");

  off(); // 宿主停用 → 皮肤 fiber dispose → off()
  // (a) 账本立即撤销，不依赖已死 fiber；deactivate 不被调用
  assert.equal(h.remote.slotEntries[0]?.disposed, true);
  assert.equal(h.remote.injectEntries[0]?.disposed, true);
  assert.deepEqual(a.calls, ["activate"]);
  // (b) 宽限去抖生效：期内 current/持久化不动（无真实等待——注入时钟未推进）
  assert.equal(h.service.current(), "alpha");
  assert.equal(lastActiveSkinWrite(h.settings), "alpha");

  await h.clock.advance(50); // 宽限期满未重登记
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
  const faults = lastFaultLogWrite(h.settings);
  assert.equal(faults.at(-1)?.kind, "active-unregistered");
  assert.match(faults.at(-1)?.message ?? "", /alpha/);
  assert.match(faults.at(-1)?.message ?? "", /host-side/);
  assert.equal(h.service.list().find((info) => info.id === "alpha"), undefined);
});

test("re-registering an active skin within the grace window re-activates the new registration (HMR)", async () => {
  const h = createHarness({ unregisterGraceMs: 50 });
  const old = makeSkin("alpha", {
    activate(ctx) {
      ctx.slots.register({ kind: "single", name: "settings.section" }, () => null);
    },
  });
  const off = h.service.registerSkin(old);
  await h.service.switchTo("alpha");
  const firstEntry = h.remote.slotEntries[0];

  off(); // 旧 fiber dispose → 账本立即撤销
  assert.equal(firstEntry?.disposed, true);

  const fresh = makeSkin("alpha", {
    version: "2.0.0",
    activate(ctx) {
      ctx.slots.register({ kind: "single", name: "settings.section" }, () => null);
    },
  });
  h.service.registerSkin(fresh); // 宽限内重登记 → 重新激活新登记对象
  await h.clock.pump();

  assert.deepEqual(fresh.calls, ["activate"]); // 新代码提供观感
  assert.deepEqual(old.calls, ["activate"]); // 已死 fiber 的 deactivate 不被调用
  assert.equal(h.service.current(), "alpha"); // current 不变（加载器唯一事实来源）
  assert.equal(lastActiveSkinWrite(h.settings), "alpha"); // 持久化始终是 alpha
  assert.equal(h.remote.slotEntries[1]?.disposed, false); // 新激活的席位存活
  assert.equal(h.service.list().find((info) => info.id === "alpha")?.status, "active");
  assert.equal(h.service.list().find((info) => info.id === "alpha")?.version, "2.0.0");

  await h.clock.advance(100); // 宽限去抖已取消：期满不再落 default
  assert.equal(h.service.current(), "alpha");
  const faults = lastFaultLogWrite(h.settings);
  assert.equal(faults.find((entry) => entry.kind === "active-unregistered"), undefined);
});

test("grace re-activation going through the standard path: new activation failure rolls back to default with fault", async () => {
  const h = createHarness({ unregisterGraceMs: 50 });
  const old = makeSkin("alpha");
  const off = h.service.registerSkin(old);
  await h.service.switchTo("alpha");
  off();
  const fresh = makeSkin("alpha", {
    activate() {
      throw new Error("new code is broken");
    },
  });
  h.service.registerSkin(fresh);
  await h.clock.pump();

  // 重新激活走标准路径：失败 → 回滚 default + fault 标记 + faultLog + 持久化改写
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
  assert.equal(h.service.list().find((info) => info.id === "alpha")?.status, "fault");
  assert.equal(lastFaultLogWrite(h.settings).at(-1)?.kind, "activate-failed");
  await h.clock.advance(100); // 宽限已消费，无二次处理
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
});

test("service face is frozen and exposes the five reserved methods", () => {
  const h = createHarness();
  assert.equal(Object.isFrozen(h.service), true);
  const face = h.service as unknown as Record<string, unknown>;
  for (const key of ["registerSkin", "list", "current", "switchTo", "subscribe"]) {
    assert.equal(typeof face[key], "function");
  }
});

// ----------------------------------------------------------------- faultLog 有界

test("faultLog is bounded at 50 entries (oldest dropped)", async () => {
  const h = createHarness();
  const skins = Array.from({ length: 55 }, (_, index) => {
    const skin = makeSkin(`skin-${index}`, {
      activate() {
        throw new Error(`fail ${index}`);
      },
    });
    h.service.registerSkin(skin);
    return skin;
  });
  for (const skin of skins) {
    await h.service.switchTo(skin.id);
  }
  const faults = lastFaultLogWrite(h.settings);
  assert.equal(faults.length, 50);
  assert.match(faults[0]?.message ?? "", /fail 5/); // 前 5 条被裁剪
  assert.match(faults.at(-1)?.message ?? "", /fail 54/);
});

// ---------------------------------------------------------------------- 停机

test("runtime stop (loader unload / host exit) deactivates the current skin and keeps persistence", async () => {
  const h = createHarness();
  const a = makeSkin("alpha", {
    activate(ctx) {
      ctx.signal.addEventListener("abort", () => a.calls.push("signal-aborted"));
    },
  });
  h.service.registerSkin(a);
  await h.service.switchTo("alpha");

  await h.offStart(); // ctx.effect 清理 disposer（async，cordis 会等待）
  // protocol SkinContext.signal 契约：加载器停用中止激活信号，随后 deactivate 兜底
  assert.deepEqual(a.calls, ["activate", "signal-aborted", "deactivate"]);
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  // 停机不改写持久化值：用户选择保留给下次启动恢复（公约 §4.4 恢复义务）
  assert.equal(lastActiveSkinWrite(h.settings), "alpha");

  const after = await h.service.switchTo("alpha");
  assert.equal(after.ok, false);
  assert.match(after.ok ? "" : after.error, /shut down/);
  assert.throws(() => h.service.registerSkin(makeSkin("late")), /shut down/);
});

test("stop during an in-flight activation shuts the half-activated skin down", async () => {
  const h = createHarness();
  const release = deferred();
  const b = makeSkin("beta", {
    activate() {
      return release.promise;
    },
  });
  h.service.registerSkin(b);
  const pending = h.service.switchTo("beta");
  await h.clock.pump();
  const stopping = h.offStart(); // 停机：abort + 等待在途落定 + deactivate 兜底
  release.resolve();
  const result = await pending;
  await stopping;

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /shut down/);
  assert.deepEqual(b.calls, ["activate", "deactivate"]);
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
});

test("slot registration after shutdown (hung activation resumes late) never reaches the adapter (closed ledger)", async () => {
  const h = createHarness();
  let skinCtx: Parameters<SkinRegistration["activate"]>[0] | undefined;
  const release = deferred();
  const b = makeSkin("beta", {
    activate(ctx) {
      skinCtx = ctx;
      return release.promise; // 挂死且无视 abort signal 的激活
    },
  });
  h.service.registerSkin(b);
  const pending = h.service.switchTo("beta");
  await h.clock.pump();
  await h.clock.advance(25); // 激活超时 → 回滚 default（deactivate 兜底 + 封账）
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);

  // 回滚完成后激活才恢复并补注册槽位 → 立即被撤除（公约 §4.4：不得残留半个新皮肤）
  release.resolve();
  await h.clock.pump();
  skinCtx?.slots.register({ kind: "single", name: "settings.section" }, () => null);
  assert.equal(h.remote.slotEntries.length, 0);
  // 返回的 no-op disposer 也可安全调用
  const off = skinCtx?.slots.inject("settings.section", () => undefined);
  off?.();
  assert.equal(h.remote.injectEntries.length, 0);
});

 test("aborted activation rejects registrations before its shutdown starts", async () => {
  const h = createHarness();
  const release = deferred();
  let oldContext: Parameters<SkinRegistration["activate"]>[0] | undefined;
  h.service.registerSkin(makeSkin("alpha", {
    activate(ctx) {
      oldContext = ctx;
      return release.promise;
    },
  }));
  h.service.registerSkin(makeSkin("beta"));
  const oldSwitch = h.service.switchTo("alpha");
  await h.clock.pump();
  const newSwitch = h.service.switchTo("beta");
  assert.equal(oldContext?.signal.aborted, true);
  oldContext?.slots.register({ kind: "single", name: "settings.section" }, () => null);
  oldContext?.slots.inject("settings.section", () => assert.fail("stale callback ran"));
  assert.equal(h.remote.slotEntries.length, 0);
  assert.equal(h.remote.injectEntries.length, 0);
  release.resolve();
  assert.equal((await oldSwitch).ok, false);
  assert.equal((await newSwitch).ok, true);
  assert.equal(h.service.current(), "beta");
});

 test("captured inject callback cannot run after its activation closes", async () => {
  const h = createHarness();
  let calls = 0;
  h.service.registerSkin(makeSkin("alpha", {
    activate(ctx) {
      ctx.slots.inject("settings.section", () => { calls++; });
    },
  }));
  await h.service.switchTo("alpha");
  const queued = h.remote.injectEntries[0]?.callback;
  await h.service.switchTo(DEFAULT_SKIN_ID);
  queued?.(); // A callback already captured by the upstream dispatch snapshot.
  assert.equal(calls, 0);
});

 test("old release is single-use and cannot release the new same-name registration", async () => {
  const h = createHarness();
  const live = new Map<string, number>();
  let token = 0;
  let oldOff: (() => void) | undefined;
  h.remote.adapter.slots.register = (options) => {
    const owner = ++token;
    live.set(options.name, owner);
    // Deliberately hostile on a second call: runtime must not invoke it twice.
    return () => { live.delete(options.name); };
  };
  h.service.registerSkin(makeSkin("alpha", {
    activate(ctx) {
      oldOff = ctx.slots.register({ kind: "single", name: "same" }, () => null);
    },
  }));
  h.service.registerSkin(makeSkin("beta", {
    activate(ctx) { ctx.slots.register({ kind: "single", name: "same" }, () => null); },
  }));
  await h.service.switchTo("alpha");
  const replacement = h.service.switchTo("beta");
  await replacement;
  oldOff?.();
  assert.equal(live.get("same"), 2);
});

 test("ledger cleanup continues in reverse order and reports residue separately from persistence failure", async () => {
  const h = createHarness();
  const order: string[] = [];
  h.remote.adapter.slots.register = (options) => () => {
    order.push(options.name);
    if (options.name === "broken") throw new Error("release failed");
  };
  h.service.registerSkin(makeSkin("alpha", {
    activate(ctx) {
      for (const name of ["first", "broken", "last"]) {
        ctx.slots.register({ kind: "single", name }, () => null);
      }
    },
  }));
  await h.service.switchTo("alpha");
  // Reject only the activeSkin write, not an earlier cleanup faultLog write.
  const set = h.settings.form.set;
  h.settings.form.set = (field, value) => field === "activeSkin" ? Promise.resolve(false) : set(field, value);
  const result = await h.service.switchTo(DEFAULT_SKIN_ID);
  assert.equal(result.ok, true);
  assert.deepEqual(order, ["last", "broken", "first"]);
  assert.equal(h.service.list()[0]?.status, "suspect-residue");
  assert.match(result.warning ?? "", /release failed.*suspect-residue/);
  assert.match(result.warning ?? "", /failed to persist/);
  const kinds = lastFaultLogWrite(h.settings).map((entry) => entry.kind);
  assert.ok(kinds.includes("deactivate-failed"));
  assert.ok(kinds.includes("persist-failed"));
});

 test("unregistered pending activation cannot commit when it resolves inside the grace window", async () => {
  const h = createHarness();
  const release = deferred();
  const off = h.service.registerSkin(makeSkin("alpha", { activate: () => release.promise }));
  const pending = h.service.switchTo("alpha");
  await h.clock.pump();
  off();
  release.resolve();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(h.service.current(), DEFAULT_SKIN_ID);
  assert.equal(lastActiveSkinWrite(h.settings), DEFAULT_SKIN_ID);
});

 test("stop continues through a failing remote listener release to clean form listeners and skin", async () => {
  const h = createHarness();
  await h.offStart();
  h.remote.adapter.remote.$on = () => () => { throw new Error("remote release failed"); };
  const runtime = createSkinRuntime({ adapter: h.remote.adapter, timers: h.clock.timers });
  const service = runtime.expose();
  const stop = runtime.start();
  const skin = makeSkin("alpha");
  service.registerSkin(skin);
  await service.switchTo("alpha");
  await stop();
  assert.equal(h.settings.listenerCount(), 0);
  assert.deepEqual(skin.calls, ["activate", "deactivate"]);
  assert.equal(service.current(), DEFAULT_SKIN_ID);
});
