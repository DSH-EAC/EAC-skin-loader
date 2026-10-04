/**
 * DSH 0.1.7-rc.2 的 host 侧 adapter（T2.4）。
 *
 * host 半运行在 Node（`lib/index.js`，api-notes §1.3），可以正常依赖 npm 包——
 * 与 client 半的 bundle 纯度限制（§3.3）无关。本文件是仓库内唯一 import
 * `@deepseek-ai/schemastery` 的位置（eslint 隔离规则只放行 `src/adapter/**`）。
 *
 * 为什么必须有 Config schema（api-notes §8 实读结论，dsh-settings/lib/index.js）：
 * - `describe()` 只为「runtime.Config 存在且有 toJSON」的 entry 生成 descriptor；
 * - host 侧 `write()` 对无 schema 的 entry 抛 `No configurable plugin entry "ns"`，
 *   且表单写只放行 **volatile** 字段（`volatileForm` / `isVolatilePath`）；
 * - 因此 client 半经 `configForms.get("dsh-ui-skin-loader").set(...)` 落盘
 *   activeSkin / faultLog 的唯一正道 = host 半声明含 volatile 字段的 Config schema。
 *   上游先例：ui-theme 的 `Config = z.object({ preference: …volatile(), … })`。
 */

import z from "@deepseek-ai/schemastery";

import { DEFAULT_SKIN_ID } from "../protocol.ts";

/**
 * api-notes §1.3/§4：host cordis ctx 的 adapter 侧最小结构形态
 * （`ctx.inject(deps, cb)` 组子 fiber 等服务就绪后执行 cb——cb 是 Plugin.Function，
 * 首参即子 fiber 的 ctx；`ctx.fiber` 是 Context 上的 Fiber 引用）。
 */
export interface Dsh017HostContext {
  /** 当前 fiber（settings.configure 的 owner 实参，ui-theme 先例）。 */
  readonly fiber?: unknown;
  /** api-notes §4：创建子 fiber 等服务就绪后执行 callback。 */
  inject(
    services: readonly string[],
    callback: (child: Dsh017HostChildContext) => void,
  ): unknown;
}

/** host 子 fiber ctx 的最小形态（加载器只在其中登记 settings 页策略与补齐器生命周期）。 */
export interface Dsh017HostChildContext {
  /** api-notes §2：effect 登记，unload 逆序释放。 */
  effect(execute: () => (() => unknown) | void, label?: string): unknown;
  /** api-notes §8.1：settings 服务（`SettingsForms`）的语义投影。 */
  readonly settings: Dsh017SettingsService;
  /**
   * 宿主插件管理服务（`@deepseek-ai/dsh-plugin-manager` 的 cordis 服务，dsh-base 默认挂载）。
   * 皮肤自动补齐复用它安装缺失皮肤（docs/git-distribution.md §3.4）——不自行执行 pnpm、
   * 不直写 profile 清单。服务缺失（老宿主/未挂载）时补齐器降级为不可用并如实上报。
   */
  readonly pluginManager?: Dsh017PluginManagerService;
}

/**
 * api-notes §8.1：host 侧 settings 服务的最小结构形态。
 * `describe()` 读本命名空间的当前 value + revision（补齐器状态读取与变更检测）；
 * `update(ns, patch, expectedRevision?)` 合并写入 volatile 字段（补齐器状态落盘），
 * 冲突抛 SettingsConflictError——调用方负责有限重试。
 */
export interface Dsh017SettingsService {
  /** api-notes §8.1：注册本插件实例的设置页策略；`auto: false` = 不自动生成设置页。 */
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void;
  /** 当前全部可配置 entry 的描述（含 ns / value / revision）。 */
  describe(): Array<{ ns: string; value?: unknown; revision: number }>;
  /** 合并 editable（volatile）字段；冲突抛错。 */
  update(
    ns: string,
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<void>;
}

/**
 * api-notes §12 / dsh-plugin-manager：宿主插件管理服务的最小结构形态。
 * `listBundles()` 给出已安装/启用状态与版本（缺失判定、版本差异展示）；
 * `installBundle(spec)` 支持 tarball 绝对路径（本地缓存制品），安装成功自动 select。
 */
export interface Dsh017PluginManagerService {
  listBundles(): Promise<
    Array<{
      name: string;
      version?: string;
      enabled: boolean;
      installed: boolean;
      removable?: boolean;
      error?: { code: string };
    }>
  >;
  installBundle(
    spec: string,
    options?: { requestId?: string; approvedBuilds?: string[] },
  ): Promise<unknown>;
}

/**
 * 加载器 host 半的 Config schema（settings 命名空间 `dsh-ui-skin-loader`）。
 * 持久化 schema 见 protocol.ts 的 LoaderSettingsValue；三个字段全部 volatile
 * （client 侧 configForms 表单写只放行 volatile 路径，api-notes §8.2）。
 *
 * 默认值与 client 半的运行时假设一致：activeSkin 缺省 "default"（无皮肤），
 * faultLog 缺省空数组（有界 50，裁剪由运行时负责），diagnosticsEnabled 缺省 false。
 *
 * 返回类型由 schemastery 推断（带 toJSON 的 Schema 实例——dsh-settings 的
 * `schema(entry)` 门只认「存在且有 toJSON」的 runtime.Config）。
 */
export function createLoaderConfigSchema() {
  return z.object({
    activeSkin: z.string().default(DEFAULT_SKIN_ID).volatile(),
    faultLog: z
      .array(
        z.object({
          at: z.string(),
          skinId: z.string(),
          kind: z.string(),
          message: z.string(),
        }),
      )
      .default([])
      .volatile(),
    diagnosticsEnabled: z.boolean().default(false).volatile(),
    // ---- 皮肤自动补齐（docs/git-distribution.md §3.5）----
    // autoProvision：用户开关（client 半控制台写）；false = 补齐器不发起新任务。
    autoProvision: z.boolean().default(true).volatile(),
    // provisioning：补齐任务状态（host 半补齐器独占写）；自由结构（host/provisioning-state.ts
    // 的 normalizeProvisioningState 负责防御性归一化），schema 只声明「任意对象」。
    provisioning: z.dict(z.any()).default({}).volatile(),
    // provisionCommand：client 半 → host 半的一次性指令（retry 等）；补齐器消费后清除。
    provisionCommand: z.dict(z.any()).default({}).volatile(),
  });
}
