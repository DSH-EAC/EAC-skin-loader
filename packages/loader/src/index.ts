/**
 * @dsh-eac/ui-skin-loader 的 host 半（T2.4）。
 *
 * 形态权威：docs/api-notes.md §1.2/§1.3/§8.1——
 * - cordis.patch.yml 行 id `dsh-ui-skin-loader` == settings 命名空间（公约保留面）；
 * - `apply(ctx)` 里 `ctx.inject(["settings"], …)` 调 `settings.configure({ auto: false })`
 *   （ui-theme 先例：自带控制台页面（T2.5），不自动生成设置页）；
 * - `Config` 导出带 volatile 字段的 schemastery schema——**这是 client 半经
 *   `configForms.get("dsh-ui-skin-loader").set(...)` 落盘 activeSkin/faultLog 的前提**
 *   （无 schema 的 entry 不生成 descriptor，host 侧表单写会拒绝，见
 *   adapter/dsh-0.1.7-host.ts 的依据说明）。
 *
 * host 半不参与切换逻辑：互斥裁决在 client 半单点进行（公约 §4.1），
 * host settings 只是激活事实的持久化事实来源（任何写入都来自加载器 client 半，
 * R6 的镜像义务——只有加载器写这个命名空间）。
 */

import {
  createLoaderConfigSchema,
  type Dsh017HostContext,
} from "./adapter/dsh-0.1.7-host.ts";
import { createSkinProvisioner, PROVISIONING_START_GUARD_MS } from "./host/provisioner.ts";
import { loadSkinsManifest } from "./host/skins-manifest.ts";
import { createConsoleLogger } from "./client/runtime/logger.ts";
import { CONVENTION_ID, LOADER_SLOT_PREFIX, SERVICE_NAME, SETTINGS_NAMESPACE } from "./protocol.ts";

export { CONVENTION_ID, LOADER_SLOT_PREFIX, SERVICE_NAME, SETTINGS_NAMESPACE };
export { createLoaderConfigSchema };
export type { Dsh017HostContext } from "./adapter/dsh-0.1.7-host.ts";

/**
 * host 半 Config schema（settings 命名空间 dsh-ui-skin-loader）：
 * { activeSkin, faultLog, diagnosticsEnabled, autoProvision, provisioning, provisionCommand }，
 * 全部 volatile（api-notes §8.2 表单写只放行 volatile 路径）。前三个是皮肤激活/诊断事实
 * （client 半写），后三个是皮肤自动补齐面（docs/git-distribution.md §3.5：
 * autoProvision/provisionCommand 由 client 半控制台写，provisioning 由 host 半补齐器写）。
 */
export const Config = createLoaderConfigSchema();

/** 补齐器清单锚点：lib/index.js 同级的 skin-manifest.json（发布管线写入位置）。 */
const SKINS_MANIFEST_URL = new URL("../skin-manifest.json", import.meta.url);

/**
 * host 半入口（api-notes §1.3 形态：`apply(ctx, config)`）。
 * - settings 页策略（auto: false）：控制台页面由 client 半经 settings.section 自带；
 * - 皮肤自动补齐：等 settings + pluginManager 就绪后启动（host 侧，异步、不阻塞 boot）。
 */
export function apply(ctx: Dsh017HostContext): void {
  let provisioningStarted = false;
  ctx.inject(["settings"], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      "ui-skin-loader: settings page policy",
    );
    // pluginManager 不可用（宿主未挂载）时第二个 inject 永不触发——补齐器静默缺席。
    // 这里用守卫计时器把它变成「如实上报的降级」，而不是无声缺席。
    child.effect(
      () => {
        const handle = setTimeout(() => {
          if (!provisioningStarted) {
            console.warn(
              `[ui-skin-loader] skin provisioning inactive: host pluginManager service did not become available within ${PROVISIONING_START_GUARD_MS}ms`,
            );
          }
        }, PROVISIONING_START_GUARD_MS);
        return () => clearTimeout(handle);
      },
      "ui-skin-loader: provisioning availability guard",
    );
  });
  ctx.inject(["settings", "pluginManager"], (child) => {
    const manager = child.pluginManager;
    // 注入面保证 manager 就绪；防御性检查仅为类型收窄。
    if (!manager) return;
    child.effect(
      () => {
        let disposer: (() => void) | null = null;
        void loadSkinsManifest(SKINS_MANIFEST_URL).then((parsed) => {
          if (!parsed.ok) {
            // 清单缺失/非法 = fail-closed：如实上报，不猜测、不装任何东西。
            console.error(`[ui-skin-loader] skin provisioning disabled: ${parsed.error}`);
            return;
          }
          provisioningStarted = true;
          disposer = createSkinProvisioner({
            manifest: parsed.manifest,
            pluginManager: manager,
            settings: child.settings,
            logger: createConsoleLogger("ui-skin-loader:provisioner"),
          }).start();
        });
        return () => {
          disposer?.();
        };
      },
      "ui-skin-loader: skin provisioning lifecycle",
    );
  });
}
