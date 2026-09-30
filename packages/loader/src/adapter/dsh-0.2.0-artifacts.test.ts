/**
 * 对照真实 0.2.0-rc.2 发布产物；不复制上游实现，也不启动 Desktop。
 * DSH_OFFICIAL_NODE_MODULES 指向隔离的官方 node_modules。
 * 未提供材料时显式 skip，不把普通 fake 单测当作新版实机证据。
 * settings 的 Cordis 注入和远端传输为边界桩；store/schema/表单实现来自官方产物。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { createDsh017Adapter, getModuleLoader, type Dsh017ClientContext } from "./dsh-0.1.7.ts";
import { createLoaderConfigSchema } from "./dsh-0.1.7-host.ts";
import type { ClientBundleRegistration, DshLocale, DshTheme } from "./types.ts";
import { SETTINGS_NAMESPACE } from "../protocol.ts";

const root = process.env.DSH_OFFICIAL_NODE_MODULES;
const options = { skip: root ? false : "requires isolated official 0.2.0-rc.2 artifacts" };

function officialFile(name: string, file: string): string {
  assert.ok(root, "DSH_OFFICIAL_NODE_MODULES must be set");
  const dir = path.join(root, "@deepseek-ai", name);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name: string; version: string };
  assert.equal(pkg.name, `@deepseek-ai/${name}`);
  assert.equal(pkg.version, "0.2.0-rc.2", `${name}: refuses another release`);
  return path.join(dir, "lib", file);
}

function officialRequire() {
  assert.ok(root);
  return createRequire(path.join(root, "__contract_probe.cjs"));
}

function loadClient(name: string, dependencies: Record<string, unknown> = {}): Record<string, unknown> {
  const file = officialFile(name, "client.js");
  let registered: ClientBundleRegistration | undefined;
  const window = { __ModuleLoader__: { load(value: ClientBundleRegistration) { registered = value; } } };
  runInNewContext(readFileSync(file, "utf8"), {
    window, queueMicrotask, structuredClone, AbortController, console,
  }, { filename: file, timeout: 5000 });
  assert.ok(registered);
  assert.equal(registered.id, `@deepseek-ai/${name}`);
  return registered.factory((id) => {
    assert.ok(Object.hasOwn(dependencies, id), `undeclared test dependency: ${id}`);
    return dependencies[id];
  });
}

test("0.2.0 official module system accepts the existing lazy factory registration", options, async () => {
  const exported = loadClient("dsh-client-modules");
  const ModuleSystem = exported.ClientModuleSystem as new (options: unknown) => {
    import(id: string): Promise<Record<string, unknown>>;
  };
  const pending: ClientBundleRegistration[] = [];
  const target = { mode: "queue", pendingQueue: pending, load: (value: ClientBundleRegistration) => { pending.push(value); } };
  const modules = new ModuleSystem({
    manifest: { modules: [] },
    staticModules: {},
    bootstrapModule: { id: "@deepseek-ai/bootstrap", exports: {} },
    registrationTarget: target,
  });
  const scope = globalThis as { __ModuleLoader__?: unknown };
  const previous = scope.__ModuleLoader__;
  scope.__ModuleLoader__ = target;
  try {
    let calls = 0;
    getModuleLoader().load({
      id: "@dsh-eac/ui-skin-loader",
      factory: () => { calls++; return { inject: ["slots"], apply() {} }; },
    });
    assert.equal(target.mode, "live");
    assert.equal(calls, 0, "registration must not activate a skin");
    const result = await modules.import("@dsh-eac/ui-skin-loader");
    assert.equal(typeof result.apply, "function");
    assert.deepEqual(result.inject, ["slots"]);
    assert.equal(calls, 1);
    assert.equal(await modules.import("@dsh-eac/ui-skin-loader"), result);
  } finally {
    scope.__ModuleLoader__ = previous;
  }
});

test("0.2.0 official SlotCore accepts list seats and cascades disposal", options, () => {
  const file = officialFile("dsh-client-ui-slots", "index.js");
  const { SlotCore } = officialRequire()(file) as {
    SlotCore: new () => {
      register(options: Record<string, unknown>, component: unknown): () => void;
      entriesOfSlot(key: string): unknown[];
    };
  };
  const core = new SlotCore();
  const keys = ["settings.section", "sidebar.footer.action", "shell.overlay"];
  const children = Object.fromEntries(keys.map((key) => [key, { kind: "list", scope: "root" }]));
  const offOwner = core.register({ name: "root", children }, () => null);
  const adapter = createDsh017Adapter({
    slots: { register: core.register.bind(core), inject: () => () => {} },
  } as unknown as Dsh017ClientContext);
  const offSeats = keys.map((name) => adapter.slots.register({
    name, kind: "list", id: "dsh-ui-skin-loader", order: 90, label: () => "皮肤",
  }, () => null));
  for (const key of keys) assert.equal(core.entriesOfSlot(key).length, 1);
  offSeats[0]!();
  offSeats[0]!();
  assert.equal(core.entriesOfSlot(keys[0]!).length, 0);
  offOwner();
  for (const key of keys) assert.equal(core.entriesOfSlot(key).length, 0);
  for (const off of offSeats) off();
});

test("0.2.0 official theme preserves preference and removes token overrides", options, () => {
  const exported = loadClient("dsh-client-ui-theme", {
    "react/jsx-runtime": {},
    "@deepseek-ai/dsh-client-ui-primitives": {},
    "@deepseek-ai/dsh-client-store": officialRequire()("@deepseek-ai/dsh-client-store"),
  });
  const Theme = exported.ThemeRuntime as new (ctx: unknown, form: unknown) => Pick<DshTheme, "register" | "overrideTokens"> & {
    getTheme(): { preference: string; active: { tokens: Record<string, string> } };
  };
  const disposers: Array<() => void> = [];
  const theme = new Theme({
    emit() {},
    effect(run: () => () => void) { disposers.push(run()); },
  }, {
    getSnapshot: () => ({ value: { preference: "dark", fontSize: 14 } }),
    subscribe: () => () => {},
    set() { throw new Error("skin contract must not write theme preference"); },
  });
  const adapter = createDsh017Adapter({ theme } as unknown as Dsh017ClientContext);
  const before = theme.getTheme();
  const offTheme = adapter.theme.register({ id: "contract-probe", colorScheme: "dark", tokens: {} });
  const offOverride = adapter.theme.overrideTokens("contract-probe", {
    "--dsw-alias-contract-probe": { light: "red", dark: "blue" },
  });
  assert.equal(adapter.theme.getTheme().colorScheme, "dark");
  assert.equal(theme.getTheme().active.tokens["--dsw-alias-contract-probe"], "blue");
  offOverride();
  offTheme();
  assert.equal(theme.getTheme().preference, before.preference);
  assert.equal(theme.getTheme().active.tokens["--dsw-alias-contract-probe"], undefined);
  for (const off of disposers.reverse()) off();
});

test("0.2.0 official locale accepts bilingual dictionaries and cleans up registration", options, () => {
  const exported = loadClient("dsh-client-locale", {
    "react/jsx-runtime": {},
    "react": {},
    "@deepseek-ai/dsh-client-ui-primitives": {},
    "@deepseek-ai/dsh-client-store": officialRequire()("@deepseek-ai/dsh-client-store"),
  });
  const Locale = exported.LocaleRuntime as new (ctx: unknown, host: unknown, bootstrap: unknown) => DshLocale;
  const locale = new Locale({ emit() {} }, undefined, { preference: "zh", languages: ["zh"] });
  const adapter = createDsh017Adapter({ locale } as unknown as Dsh017ClientContext);
  const off = adapter.locale.register("contract-probe", {
    en: { title: "Skin {name}" },
    zh: { title: "皮肤 {name}" },
  });
  const translate = adapter.locale.bind("contract-probe");
  assert.equal(translate("title", { name: "aurora" }), "皮肤 aurora");
  assert.equal(adapter.locale.bind("contract-probe"), translate);
  off();
  off();
  assert.equal(translate("title"), "title");
});

test("0.2.0 official ConfigForms preserves activeSkin on rejection and persists an accepted write", options, async () => {
  const services: Record<string, unknown> = {};
  class Service {
    constructor(_ctx: unknown, name: string) { services[name] = this; }
  }
  const exported = loadClient("dsh-client-ui-settings", {
    "@deepseek-ai/cordis": { Service },
    "@deepseek-ai/dsh-client-store": officialRequire()("@deepseek-ai/dsh-client-store"),
  });
  const disposers: Array<() => void | Promise<void>> = [];
  const subscriptions = new Map<string, (...args: unknown[]) => void>();
  let value = { activeSkin: "dsh-eac.skin.blue-fantasy", faultLog: [], diagnosticsEnabled: false };
  let revision = 7;
  let accepted = false;
  const row = () => ({
    ns: SETTINGS_NAMESPACE, schema: createLoaderConfigSchema().toJSON(),
    value, base: {}, user: value, revision,
  });
  const writes: unknown[][] = [];
  const exportedApply = exported.apply as (ctx: unknown) => void;
  exportedApply({
    effect(run: () => () => void | Promise<void>) { disposers.push(run()); },
    on: () => () => {},
    remote: {
      $host: { isLoopback: true },
      $on(event: string, cb: (...args: unknown[]) => void) {
        subscriptions.set(event, cb);
        return () => { subscriptions.delete(event); };
      },
      settings: {
        describe: async () => ({ ok: true, value: { writable: true, namespaces: [row()] } }),
        mutate: async (ns: string, ops: Array<{ path: string[]; value: unknown }>, fence: number) => {
          writes.push([ns, ops, fence]);
          if (!accepted) return { ok: false };
          assert.equal(fence, revision);
          value = { ...value, activeSkin: String(ops[0]?.value) };
          revision++;
          return { ok: true, value: row() };
        },
      },
    },
  });
  const configForms = services.configForms as Dsh017ClientContext["configForms"] & {
    describe(): { ensure(): Promise<void> };
  };
  await configForms.describe().ensure();
  const adapter = createDsh017Adapter({ configForms } as unknown as Dsh017ClientContext);
  const form = adapter.settings.get<{ activeSkin: string }>(SETTINGS_NAMESPACE);
  assert.equal(form.get().status, "ready");
  assert.equal(form.get().value.activeSkin, "dsh-eac.skin.blue-fantasy");
  assert.equal(form.get(), form.get(), "React snapshot projection stays stable");
  let changed = 0;
  const off = form.subscribe(() => { changed++; });
  assert.equal(await form.set("activeSkin", "default"), false);
  assert.equal(form.get().value.activeSkin, "dsh-eac.skin.blue-fantasy");
  accepted = true;
  assert.equal(await form.set("activeSkin", "default"), true);
  assert.equal(form.get().value.activeSkin, "default");
  assert.equal(form.get().revision, 8);
  assert.ok(changed > 0);
  assert.equal(writes.length, 2);
  assert.equal(subscriptions.has("settings/document-updated"), true);
  off();
  for (const dispose of disposers.reverse()) await dispose();
  assert.equal(subscriptions.size, 0);
});
