/**
 * adapter 逻辑单测（T2.3）：用轻量 fake 模拟 `__ModuleLoader__` facade、slots registry、
 * theme、configForms、locale，验证 adapter 的包装/透传/dispose 语义（无真浏览器）。
 * 语义权威：docs/api-notes.md（§3.1/§3.2/§5/§7/§8.2/§10）。
 *
 * 本文件在 adapter 目录内，是唯一允许引用上游私有全局 `__ModuleLoader__`/`__DSH_BOOT__`
 * 的测试位置（根 eslint.config.js 的隔离豁免按路径生效）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  composeDisposers,
  createDsh017Adapter,
  getHostInfo,
  getModuleLoader,
  type Dsh017ClientContext,
} from "./dsh-0.1.7.ts";
import type {
  Disposer,
  SettingsSnapshot,
  SlotOptions,
  ThemeDefinition,
} from "./types.ts";

// ---------------------------------------------------------------------------
// window 私有全局 fake
// ---------------------------------------------------------------------------

interface RecordedRegistration {
  id: string;
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>;
}

/** 测试用的 window 形态（仅 adapter 测试可见的两个上游私有全局）。 */
interface FakeWindow {
  __ModuleLoader__?: {
    mode: string;
    load: (registration: RecordedRegistration) => void;
  };
  __DSH_BOOT__?: { rev?: unknown };
}

const fakeWindow = () => globalThis as unknown as FakeWindow;

// ---------------------------------------------------------------------------
// slots fake：声明账本 + 注册表 + pending inject 队列
// ---------------------------------------------------------------------------

interface RegisteredEntry {
  options: Record<string, unknown>;
  component: unknown;
}

function createFakeSlots() {
  const declared = new Set<string>();
  const registered: RegisteredEntry[] = [];
  const pending = new Map<string, Set<{ run: () => unknown; active: Disposer[] }>>();
  let registerDisposeCalls = 0;

  function register(
    options: Record<string, unknown>,
    component: unknown,
  ): Disposer {
    const entry: RegisteredEntry = { options, component };
    registered.push(entry);
    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      registerDisposeCalls++;
      const index = registered.indexOf(entry);
      if (index >= 0) {
        registered.splice(index, 1);
      }
    };
  }

  function inject(key: string, callback: () => unknown): Disposer {
    // api-notes §5：callback 返回的 effect 挂到等待者自己的作用域，
    // inject 的 disposer 负责取消等待 + 撤除已生效 effect。
    const activeDisposers: Disposer[] = [];
    const wait = { run: callback, active: activeDisposers };
    let cancelled = false;
    const pushResult = (result: unknown): void => {
      if (typeof result === "function") {
        activeDisposers.push(result as Disposer);
      }
    };
    if (declared.has(key)) {
      // api-notes §5：声明已存在 → 同步执行 callback。
      pushResult(callback());
    } else {
      const queue =
        pending.get(key) ??
        new Set<{ run: () => unknown; active: Disposer[] }>();
      queue.add(wait);
      pending.set(key, queue);
    }
    return () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      const queue = pending.get(key);
      if (queue) {
        queue.delete(wait);
        if (queue.size === 0) {
          pending.delete(key);
        }
      }
      for (const dispose of [...activeDisposers]) {
        dispose();
      }
    };
  }

  function declare(key: string): void {
    declared.add(key);
    const queue = pending.get(key);
    pending.delete(key);
    // 模拟上游：声明提交时逐个执行等待者的 callback，并把返回的 effect 挂到该等待名下。
    for (const wait of queue ?? []) {
      const result = wait.run();
      if (typeof result === "function") {
        wait.active.push(result as Disposer);
      }
    }
  }

  return {
    register,
    inject,
    declare,
    registered,
    pending,
    get registerDisposeCalls() {
      return registerDisposeCalls;
    },
  };
}

// ---------------------------------------------------------------------------
// theme fake
// ---------------------------------------------------------------------------

function createFakeTheme() {
  const registrations: ThemeDefinition[] = [];
  const overrides: Array<{
    source: string;
    tokens: Record<string, { light: string; dark: string }>;
  }> = [];
  return {
    register(definition: {
      id: string;
      colorScheme: "light" | "dark";
      tokens: Record<string, string>;
    }): Disposer {
      registrations.push(definition);
      return () => {};
    },
    overrideTokens(
      source: string,
      tokens: Record<string, { light: string; dark: string }>,
    ): Disposer {
      overrides.push({ source, tokens });
      return () => {};
    },
    getTheme(): { preference: string; active: { colorScheme: "light" | "dark" } } {
      return { preference: "system", active: { colorScheme: "light" } };
    },
    registrations,
    overrides,
  };
}

// ---------------------------------------------------------------------------
// configForms fake：快照带上游的 base/user/mode 附加字段，验证投影裁剪
// ---------------------------------------------------------------------------

function createFakeForm() {
  let revision = 7;
  let value: Record<string, unknown> = { enabled: false };
  const listeners = new Set<() => void>();
  const sets: Array<{ field: string; value: unknown }> = [];
  let listenerDisposeCalls = 0;
  // api-notes §8.2：上游快照是「稳定引用」——同一份快照对象保持到下次变更才更换。
  const buildSnapshot = () => ({
    status: "ready" as const,
    value,
    base: {} as Record<string, unknown>,
    user: {} as Record<string, unknown>,
    revision,
    writable: true,
    mode: "host",
  });
  let snapshot: SettingsSnapshot & {
    base: Record<string, unknown>;
    user: Record<string, unknown>;
    mode: string;
  } = buildSnapshot();
  const form = {
    getSnapshot(): SettingsSnapshot & {
      base: Record<string, unknown>;
      user: Record<string, unknown>;
      mode: string;
    } {
      return snapshot;
    },
    subscribe(listener: () => void): Disposer {
      listeners.add(listener);
      let disposed = false;
      return () => {
        if (disposed) {
          return;
        }
        disposed = true;
        listenerDisposeCalls++;
        listeners.delete(listener);
      };
    },
    set(field: string, next: unknown): Promise<boolean> {
      sets.push({ field, value: next });
      value = { ...value, [field]: next };
      revision++;
      snapshot = buildSnapshot();
      for (const listener of [...listeners]) {
        listener();
      }
      return Promise.resolve(true);
    },
    emit(): void {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    sets,
    listeners,
    get listenerDisposeCalls() {
      return listenerDisposeCalls;
    },
  };
  return form;
}

function createFakeConfigForms() {
  const requested: string[] = [];
  const cache = new Map<string, ReturnType<typeof createFakeForm>>();
  return {
    get(entryId: string): ReturnType<typeof createFakeForm> {
      requested.push(entryId);
      let form = cache.get(entryId);
      if (!form) {
        form = createFakeForm();
        cache.set(entryId, form);
      }
      return form;
    },
    requested,
  };
}

// ---------------------------------------------------------------------------
// locale fake（bind 按 ns memoize；查键 zh → en → key 本身）
// ---------------------------------------------------------------------------

function createFakeLocale() {
  const registered: Array<{
    ns: string;
    dicts: Record<string, Record<string, string>>;
  }> = [];
  const bound = new Map<
    string,
    (key: string, params?: Record<string, string | number>) => string
  >();
  return {
    register(
      ns: string,
      dicts: Record<string, Record<string, string>>,
    ): Disposer {
      registered.push({ ns, dicts });
      return () => {};
    },
    bind(ns: string): (
      key: string,
      params?: Record<string, string | number>,
    ) => string {
      const existing = bound.get(ns);
      if (existing) {
        return existing;
      }
      const translate = (
        key: string,
        params?: Record<string, string | number>,
      ): string => {
        const entry = registered.find((r) => r.ns === ns);
        const raw = entry?.dicts.zh?.[key] ?? entry?.dicts.en?.[key] ?? key;
        return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
          const replacement = params?.[name];
          return replacement === undefined ? match : String(replacement);
        });
      };
      bound.set(ns, translate);
      return translate;
    },
    registered,
  };
}

// ---------------------------------------------------------------------------
// ctx fake 组装（结构上满足 Dsh017ClientContext）
// ---------------------------------------------------------------------------

function createFakeContext() {
  const slots = createFakeSlots();
  const theme = createFakeTheme();
  const configForms = createFakeConfigForms();
  const locale = createFakeLocale();
  const provided = new Map<string, unknown>();
  const effectBodies: Array<() => (() => unknown) | void> = [];
  const remoteListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const eventListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const ctx: Dsh017ClientContext = {
    provide(name: string, value: unknown): Disposer {
      provided.set(name, value);
      let disposed = false;
      return () => {
        if (disposed) {
          return;
        }
        disposed = true;
        provided.delete(name);
      };
    },
    effect(execute) {
      effectBodies.push(execute);
      return undefined;
    },
    slots,
    theme,
    configForms,
    locale,
    remote: {
      $on(event, listener) {
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
    on(event, listener) {
      // cordis ctx.on 形态（发布树 events.d.ts L197）：注册监听并返回 disposer。
      let set = eventListeners.get(event);
      if (!set) {
        set = new Set();
        eventListeners.set(event, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
      };
    },
  };
  return { ctx, slots, theme, configForms, locale, provided, effectBodies, remoteListeners, eventListeners };
}

// ---------------------------------------------------------------------------
// composeDisposers：逆序 + 幂等
// ---------------------------------------------------------------------------

test("composeDisposers releases in reverse registration order and is idempotent", () => {
  const order: string[] = [];
  const d1 = () => void order.push("d1");
  const d2 = () => void order.push("d2");
  const d3 = () => void order.push("d3");
  const composed = composeDisposers([d1, d2, d3]);
  composed();
  composed();
  assert.deepEqual(order, ["d3", "d2", "d1"]);
});

test("composeDisposers tolerates an empty iterable", () => {
  assert.doesNotThrow(() => composeDisposers([])());
});

// ---------------------------------------------------------------------------
// DshModuleLoader（window.__ModuleLoader__ 投影）
// ---------------------------------------------------------------------------

test("getModuleLoader delegates load({id, factory}) to the boot facade", () => {
  const loaded: RecordedRegistration[] = [];
  fakeWindow().__ModuleLoader__ = {
    mode: "live",
    load: (registration) => void loaded.push(registration),
  };
  try {
    const moduleLoader = getModuleLoader();
    const factory = () => ({ inject: [] as string[], apply: () => {} });
    moduleLoader.load({ id: "@dsh-eac/ui-skin-loader", factory });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.id, "@dsh-eac/ui-skin-loader");
    assert.equal(loaded[0]?.factory, factory);
  } finally {
    delete fakeWindow().__ModuleLoader__;
  }
});

test("getModuleLoader throws with guidance when the boot facade is absent", () => {
  delete fakeWindow().__ModuleLoader__;
  assert.throws(() => getModuleLoader(), /__ModuleLoader__/);
});

// ---------------------------------------------------------------------------
// DshSlots.register：参数映射 + kind 校验 + disposer 透传
// ---------------------------------------------------------------------------

test("slots.register forwards list-slot fields and strips the adapter-only kind", () => {
  const { ctx, slots } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const component = () => null;
  const label = () => "动态文案";
  adapter.slots.register(
    {
      name: "settings.section",
      kind: "list",
      id: "eac-test",
      order: 90,
      label,
      registrant: "unit-test",
    },
    component,
  );
  assert.equal(slots.registered.length, 1);
  assert.deepEqual(slots.registered[0]?.options, {
    name: "settings.section",
    id: "eac-test",
    order: 90,
    label,
    registrant: "unit-test",
  });
  assert.equal(slots.registered[0]?.component, component);
});

test("slots.register rejects list options without id before reaching upstream", () => {
  const { ctx, slots } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  // TS 判别联合已在编译期拦下这种选项；运行期校验兜底的是手写 JS bundle 的调用方。
  const invalid = { name: "settings.section", kind: "list" } as unknown as SlotOptions;
  assert.throws(() => adapter.slots.register(invalid, () => null), /id/);
  assert.equal(slots.registered.length, 0);
});

test("slots.register rejects keyed without key and chain without select", () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const invalidKeyed = { name: "main", kind: "keyed" } as unknown as SlotOptions;
  const invalidChain = { name: "x", kind: "chain" } as unknown as SlotOptions;
  assert.throws(() => adapter.slots.register(invalidKeyed, () => null), /key/);
  assert.throws(() => adapter.slots.register(invalidChain, () => null), /select/);
});

test("slots.register returns the upstream disposer; double dispose is a no-op", () => {
  const { ctx, slots } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const disposer = adapter.slots.register(
    { name: "sidebar.footer.action", kind: "list", id: "eac-test" },
    () => null,
  );
  assert.equal(slots.registered.length, 1);
  disposer();
  disposer();
  assert.equal(slots.registered.length, 0);
  assert.equal(slots.registerDisposeCalls, 1);
});

// ---------------------------------------------------------------------------
// DshSlots.inject：同步/等待/取消/聚合逆序
// ---------------------------------------------------------------------------

test("slots.inject runs the callback synchronously when the slot is declared; the returned disposer fires on dispose", () => {
  const { ctx, slots } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  slots.declare("settings.section");
  let ran = 0;
  const inner = () => void ran++;
  const injectDisposer = adapter.slots.inject("settings.section", () => inner);
  // callback 本身同步执行；它返回的 disposer 是「待安装的 effect」，dispose 时才运行。
  assert.equal(ran, 0);
  injectDisposer();
  injectDisposer();
  assert.equal(ran, 1);
});

test("slots.inject fires a pending wait when the slot gets declared (register 后 inject 能收到)", () => {
  const { ctx, slots } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  let ran = false;
  const injectDisposer = adapter.slots.inject("settings.section", () => {
    ran = true;
    // 探针同款模式（api-notes §1.4/§6.2）：声明到位后在 callback 里注册。
    return adapter.slots.register(
      { name: "settings.section", kind: "list", id: "eac-test" },
      () => null,
    );
  });
  assert.equal(ran, false);
  slots.declare("settings.section");
  assert.equal(ran, true);
  assert.equal(slots.registered.length, 1);
  injectDisposer();
  assert.equal(slots.registered.length, 0);
});

test("slots.inject disposer cancels a pending wait before the declaration lands", () => {
  const { ctx, slots } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  let ran = false;
  const injectDisposer = adapter.slots.inject("settings.section", () => {
    ran = true;
  });
  assert.equal(slots.pending.get("settings.section")?.size, 1);
  injectDisposer();
  slots.declare("settings.section");
  assert.equal(ran, false);
  assert.equal(slots.pending.size, 0);
});

test("slots.inject aggregates an iterable callback result and disposes it in reverse order", () => {
  const { ctx, slots } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  slots.declare("settings.section");
  const order: string[] = [];
  const injectDisposer = adapter.slots.inject("settings.section", () => [
    () => void order.push("d1"),
    () => void order.push("d2"),
    () => void order.push("d3"),
  ]);
  injectDisposer();
  assert.deepEqual(order, ["d3", "d2", "d1"]);
});

test("slots.inject tolerates a callback returning void", () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const injectDisposer = adapter.slots.inject("settings.section", () => {});
  assert.doesNotThrow(() => injectDisposer());
});

 test("slots.inject iterable cleanup continues after exceptions and aggregates failures", () => {
  const { ctx, slots } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  slots.declare("settings.section");
  const order: string[] = [];
  const off = adapter.slots.inject("settings.section", () => [
    () => { order.push("first"); throw new Error("first failed"); },
    () => { order.push("middle"); },
    () => { order.push("last"); throw new Error("last failed"); },
  ]);
  assert.throws(off, (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    return true;
  });
  assert.deepEqual(order, ["last", "middle", "first"]);
  assert.doesNotThrow(off);
});

// ---------------------------------------------------------------------------
// DshTheme：register/overrideTokens 参数映射与 api-notes §7 一致
// ---------------------------------------------------------------------------

test("theme.register forwards the definition verbatim (single-value tokens)", () => {
  const { ctx, theme } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const definition: ThemeDefinition = {
    id: "aurora",
    colorScheme: "dark",
    tokens: { "--dsw-alias-bg": "#001122" },
  };
  const disposer = adapter.theme.register(definition);
  assert.equal(theme.registrations[0], definition);
  assert.doesNotThrow(() => disposer());
});

test("theme.overrideTokens forwards light+dark pairs keyed by source", () => {
  const { ctx, theme } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const tokens = {
    "--dsw-alias-bg": { light: "#ffffff", dark: "#001122" },
  };
  adapter.theme.overrideTokens("@dsh-eac/skin-aurora", tokens);
  assert.equal(theme.overrides.length, 1);
  assert.equal(theme.overrides[0]?.source, "@dsh-eac/skin-aurora");
  assert.equal(theme.overrides[0]?.tokens, tokens);
});

test("theme.overrideTokens rejects a bare string value before reaching upstream", () => {
  const { ctx, theme } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const bad = { "--dsw-alias-bg": "#001122" } as unknown as Record<
    string,
    { light: string; dark: string }
  >;
  assert.throws(() => adapter.theme.overrideTokens("src", bad), /light, dark/);
  assert.equal(theme.overrides.length, 0);
});

test("theme.overrideTokens rejects a pair missing the dark value", () => {
  const { ctx, theme } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const bad = {
    "--dsw-alias-bg": { light: "#ffffff" },
  } as unknown as Record<string, { light: string; dark: string }>;
  assert.throws(() => adapter.theme.overrideTokens("src", bad), /light, dark/);
  assert.equal(theme.overrides.length, 0);
});

test("theme.getTheme projects preference and the resolved active color scheme", () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const snapshot = adapter.theme.getTheme();
  assert.deepEqual(snapshot, { preference: "system", colorScheme: "light" });
});

// ---------------------------------------------------------------------------
// DshSettings：configForms 投影（§8.1/§8.2）
// ---------------------------------------------------------------------------

test("settings.get projects the snapshot down to status/value/revision/writable", () => {
  const { ctx, configForms } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const form = adapter.settings.get("dsh-ui-skin-loader");
  assert.deepEqual(configForms.requested, ["dsh-ui-skin-loader"]);
  assert.deepEqual(form.get(), {
    status: "ready",
    value: { enabled: false },
    revision: 7,
    writable: true,
  } satisfies SettingsSnapshot);
});

test("settings projection memoizes by upstream snapshot identity (uSES-safe)", async () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const form = adapter.settings.get("dsh-ui-skin-loader");
  const first = form.get();
  // 同一上游快照标识 → 同一投影引用（api-notes §8.2：getSnapshot 稳定引用，uSES 友好）。
  assert.equal(form.get(), first);
  // 新快照标识（上游变更）→ 新投影对象，字段随之更新。
  await form.set("enabled", true);
  const second = form.get();
  assert.notEqual(second, first);
  assert.equal(second.revision, 8);
  assert.deepEqual(second.value, { enabled: true });
  // 旧投影保持不可变（上游快照不可变语义）。
  assert.equal(first.revision, 7);
  assert.deepEqual(first.value, { enabled: false });
  // 再次读取仍是 second（新标识同样 memoize）。
  assert.equal(form.get(), second);
});

test("settings forms memoize independently per entryId", () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const a = adapter.settings.get("ns-a");
  const b = adapter.settings.get("ns-b");
  assert.equal(a.get(), a.get());
  assert.equal(b.get(), b.get());
  assert.notEqual(a.get(), b.get());
});

test("settings form subscribe receives updates until disposed", async () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const form = adapter.settings.get("dsh-ui-skin-loader");
  let events = 0;
  const disposer = form.subscribe(() => void events++);
  await form.set("enabled", true);
  assert.equal(events, 1);
  disposer();
  await form.set("enabled", false);
  assert.equal(events, 1);
  assert.equal(form.get().revision, 9);
});

test("settings form set passes field/value through and resolves the acceptance flag", async () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const form = adapter.settings.get("skin-ns");
  const accepted = await form.set("activeSkin", "aurora");
  assert.equal(accepted, true);
  assert.deepEqual(form.get().value, { enabled: false, activeSkin: "aurora" });
});

// ---------------------------------------------------------------------------
// DshLocale：双语 register + bind memoization（§10）
// ---------------------------------------------------------------------------

test("locale.register forwards the zh/en bilingual dictionaries", () => {
  const { ctx, locale } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const zh = { greeting: "你好 {name}" };
  const en = { greeting: "Hello {name}" };
  adapter.locale.register("dsh-ui-skin-loader", { zh, en });
  assert.equal(locale.registered.length, 1);
  assert.equal(locale.registered[0]?.ns, "dsh-ui-skin-loader");
  assert.equal(locale.registered[0]?.dicts.zh, zh);
  assert.equal(locale.registered[0]?.dicts.en, en);
});

test("locale.bind memoizes per namespace and translates through the dictionaries", () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  adapter.locale.register("ns", {
    zh: { greeting: "你好 {name}" },
    en: { greeting: "Hello {name}" },
  });
  const t1 = adapter.locale.bind("ns");
  const t2 = adapter.locale.bind("ns");
  assert.equal(t1, t2);
  assert.equal(t1("greeting", { name: "世界" }), "你好 世界");
  assert.equal(t1("missing.key"), "missing.key");
});

// ---------------------------------------------------------------------------
// DshEvents：ctx.on 订阅投影（§7 theme/change / §10 locale/change 的通道）
// ---------------------------------------------------------------------------

test("events.on forwards to ctx.on and the disposer removes the listener", () => {
  const { ctx, eventListeners } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  const received: unknown[][] = [];
  const disposer = adapter.events.on("theme/change", (...args: unknown[]) => {
    received.push(args);
  });
  const set = eventListeners.get("theme/change");
  assert.equal(set?.size, 1);
  for (const listener of set ?? []) {
    listener({ active: { colorScheme: "dark" } });
  }
  assert.deepEqual(received, [[{ active: { colorScheme: "dark" } }]]);
  disposer();
  assert.equal(eventListeners.get("theme/change")?.size ?? 0, 0);
});

test("events.on tolerates a non-function upstream return value", () => {
  const { ctx } = createFakeContext();
  // cordis on 的返回值按 any 形态声明（卸载等待等边缘可返回 true/undefined）——
  // adapter 防御性包装为 no-op disposer。
  const probeCtx = {
    ...ctx,
    on: () => true,
  } as unknown as Dsh017ClientContext;
  const adapter = createDsh017Adapter(probeCtx);
  assert.doesNotThrow(() => adapter.events.on("locale/change", () => undefined)());
});

// ---------------------------------------------------------------------------
// HostInfo 与聚合面
// ---------------------------------------------------------------------------

test("hostInfo reads the boot wire rev and keeps dshVersion null (no verified client surface)", () => {
  fakeWindow().__DSH_BOOT__ = { rev: "rev-abc123" };
  try {
    const info = getHostInfo();
    assert.equal(info.dshVersion, null);
    assert.equal(info.bootRev, "rev-abc123");
  } finally {
    delete fakeWindow().__DSH_BOOT__;
  }
});

test("hostInfo returns nulls when the boot wire is absent", () => {
  delete fakeWindow().__DSH_BOOT__;
  const info = getHostInfo();
  assert.equal(info.dshVersion, null);
  assert.equal(info.bootRev, null);
});

test("createDsh017Adapter exposes the semantic faces", () => {
  const { ctx } = createFakeContext();
  const adapter = createDsh017Adapter(ctx);
  assert.equal(typeof adapter.slots.register, "function");
  assert.equal(typeof adapter.slots.inject, "function");
  assert.equal(typeof adapter.theme.register, "function");
  assert.equal(typeof adapter.theme.overrideTokens, "function");
  assert.equal(typeof adapter.theme.getTheme, "function");
  assert.equal(typeof adapter.settings.get, "function");
  assert.equal(typeof adapter.locale.register, "function");
  assert.equal(typeof adapter.locale.bind, "function");
  assert.equal(typeof adapter.events.on, "function");
  assert.equal(adapter.hostInfo.dshVersion, null);
  assert.equal(adapter.hostInfo.bootRev, null);
});
