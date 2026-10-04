/**
 * host 侧 adapter 单测（T2.4）：Config schema 的 volatile/默认值语义（api-notes §8 实读
 * 结论：无 schema 的 entry 不可表单写）+ host apply 的 settings.configure 接线形态
 * （api-notes §1.3，ui-theme 先例）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createLoaderConfigSchema,
  type Dsh017HostContext,
} from "./dsh-0.1.7-host.ts";
import { apply as hostApply } from "../index.ts";
import { DEFAULT_SKIN_ID, SETTINGS_NAMESPACE } from "../protocol.ts";

test("reserved settings namespace matches the patch row id (api-notes §8.1)", () => {
  assert.equal(SETTINGS_NAMESPACE, "dsh-ui-skin-loader");
});

test("Config schema has volatile fields with covenant defaults", () => {
  const schema = createLoaderConfigSchema();
  // dsh-settings 的 schema(entry) 门：runtime.Config 必须存在且有 toJSON
  assert.equal(typeof schema.toJSON, "function");
  const dict = schema.dict ?? {};
  for (const field of [
    "activeSkin",
    "faultLog",
    "diagnosticsEnabled",
    // 皮肤自动补齐面（docs/git-distribution.md §3.5）——同为 volatile，client 半才可表单写。
    "autoProvision",
    "provisioning",
    "provisionCommand",
  ]) {
    const node = dict[field];
    assert.ok(node, `field ${field} must be declared`);
    assert.equal(node.meta.volatile, true, `field ${field} must be volatile (api-notes §8.2 表单写只放行 volatile 路径)`);
  }
  // 默认值经真实校验器解析（volatile 字段产出 .get() 包装）
  const value = schema({}) as unknown as {
    activeSkin: { get(): string };
    faultLog: { get(): unknown[] };
    diagnosticsEnabled: { get(): boolean };
    autoProvision: { get(): boolean };
    provisioning: { get(): unknown };
    provisionCommand: { get(): unknown };
  };
  assert.equal(value.activeSkin.get(), DEFAULT_SKIN_ID);
  assert.deepEqual(value.faultLog.get(), []);
  assert.equal(value.diagnosticsEnabled.get(), false);
  assert.equal(value.autoProvision.get(), true);
  assert.deepEqual(value.provisioning.get(), {});
  assert.deepEqual(value.provisionCommand.get(), {});
});

test("Config schema validates and normalizes persisted values", () => {
  const schema = createLoaderConfigSchema();
  const value = schema({
    activeSkin: "aurora",
    diagnosticsEnabled: true,
    faultLog: [{ at: "t0", skinId: "aurora", kind: "activate-failed", message: "boom" }],
    autoProvision: false,
    provisioning: { version: 1, releaseSet: "v1.2.0", items: {} },
    provisionCommand: { kind: "retry", at: "t1" },
  }) as unknown as {
    activeSkin: { get(): string };
    faultLog: { get(): Array<{ at: string; skinId: string; kind: string; message: string }> };
    diagnosticsEnabled: { get(): boolean };
    autoProvision: { get(): boolean };
    provisioning: { get(): unknown };
    provisionCommand: { get(): unknown };
  };
  assert.equal(value.activeSkin.get(), "aurora");
  assert.equal(value.diagnosticsEnabled.get(), true);
  const faults = value.faultLog.get();
  assert.equal(faults.length, 1);
  assert.deepEqual(faults[0], { at: "t0", skinId: "aurora", kind: "activate-failed", message: "boom" });
  assert.equal(value.autoProvision.get(), false);
  assert.deepEqual(value.provisioning.get(), { version: 1, releaseSet: "v1.2.0", items: {} });
  assert.deepEqual(value.provisionCommand.get(), { kind: "retry", at: "t1" });
});

test("wire schema serialization exposes volatile metadata (describe/describe 前提)", () => {
  const schema = createLoaderConfigSchema();
  const json = schema.toJSON() as { refs?: Record<string, { meta?: { volatile?: boolean } }> };
  const serialized = JSON.stringify(json);
  assert.match(serialized, /"volatile":true/);
  assert.ok(json.refs);
});

test("host apply wires settings page policy and the provisioning inject (auto:false)", () => {
  const configureCalls: Array<{ presentation: unknown; owner: unknown }> = [];
  const configureDisposers: Array<() => void> = [];
  const effectBodies: Array<() => (() => unknown) | void> = [];
  const injectCalls: Array<{ services: readonly string[]; callback: (child: never) => void }> = [];
  const fiber = { tag: "loader-host-fiber" };

  const ctx = {
    fiber,
    inject(services: readonly string[], callback: (child: never) => void) {
      injectCalls.push({ services, callback });
      return undefined;
    },
  } as unknown as Dsh017HostContext;

  // api-notes §1.3：apply 收 (ctx, config)；本任务不消费 config
  hostApply(ctx);

  // 两个注入面：① settings 页策略；② settings+pluginManager → 皮肤补齐器生命周期。
  assert.equal(injectCalls.length, 2);
  assert.deepEqual(injectCalls[0]?.services, ["settings"]);
  assert.deepEqual(injectCalls[1]?.services, ["settings", "pluginManager"]);
  const child = {
    effect(execute: () => (() => unknown) | void) {
      effectBodies.push(execute);
      return undefined;
    },
    settings: {
      configure(presentation: { auto?: boolean }, owner?: unknown) {
        configureCalls.push({ presentation, owner });
        const off = () => configureDisposers.push(() => undefined);
        return off;
      },
    },
  };
  injectCalls[0]?.callback(child as never);

  // 第一个注入面登记两个 effect：settings 页策略 + 补齐器可用性守卫。
  assert.equal(effectBodies.length, 2);
  const off = effectBodies[0]?.();
  assert.equal(configureCalls.length, 1);
  assert.deepEqual(configureCalls[0]?.presentation, { auto: false });
  assert.equal(configureCalls[0]?.owner, fiber);
  assert.equal(typeof off, "function");
  off?.();
  assert.equal(configureDisposers.length, 1);
});
