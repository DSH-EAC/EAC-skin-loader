/**
 * 控制台文案与纯映射逻辑（T2.5）。
 *
 * 本模块零 React、零 DOM、零上游依赖——node --test 可直接驱动（brief §3 的纯逻辑单测
 * 落点：状态徽标映射、SwitchResult → 用户消息映射、卡片排序稳定性）。
 * 字典经 DshLocale.register 注册（api-notes §10：双语齐备强制、缺键回退 en），
 * namespace 为公约保留面下的自定 ns `dsh-ui-skin-loader/console`。
 */

import type { SkinInfo, SkinStatus, SwitchResult } from "../../protocol.ts";

/** 控制台文案命名空间（公约保留面 settings 命名空间的自定子 ns）。 */
export const CONSOLE_LOCALE_NS = "dsh-ui-skin-loader/console";

/** 控制台分区 / 槽位条目 id（list 槽位的席位键；三处挂载共用同一 id 前缀语义）。 */
export const CONSOLE_ENTRY_ID = "dsh-ui-skin-loader";

/** 控制台全部文案键（zh/en 两套同键集；api-notes §10 缺键回退 en）。 */
export interface ConsoleMessages {
  "nav.label": string;
  "console.title": string;
  "console.subtitle": string;
  "hero.currentLabel": string;
  "hero.defaultName": string;
  "hero.defaultDesc": string;
  "action.reset": string;
  "action.resetting": string;
  "wall.title": string;
  "wall.count": string;
  "badge.discovered": string;
  "badge.active": string;
  "badge.fault": string;
  "badge.suspectResidue": string;
  "badge.incompatible": string;
  "card.by": string;
  "card.switchAria": string;
  "card.switching": string;
  "error.switch": string;
  "warning.raw": string;
  "hint.settings": string;
  "empty.title": string;
  "empty.hint": string;
  "overlay.close": string;
  "footer.open": string;
  "provision.title": string;
  "provision.subtitle": string;
  "provision.count": string;
  "provision.status.installed": string;
  "provision.status.failed": string;
  "provision.status.pending": string;
  "provision.status.installing": string;
  "provision.status.present": string;
  "provision.status.excluded": string;
  "provision.versionDiff": string;
  "provision.action.retry": string;
  "provision.action.retrying": string;
  "provision.toggle": string;
  "provision.idle": string;
}

export const MESSAGES: Record<"en" | "zh", ConsoleMessages> = {
  en: {
    "nav.label": "Skins",
    "console.title": "Skin console",
    "console.subtitle": "Switch the workspace look. Skin settings stay owned by each skin.",
    "hero.currentLabel": "Current look",
    "hero.defaultName": "Default look",
    "hero.defaultDesc": "The host's built-in appearance — no skin is active.",
    "action.reset": "Restore default",
    "action.resetting": "Restoring…",
    "wall.title": "Installed skins",
    "wall.count": "{count} skin(s)",
    "badge.discovered": "Available",
    "badge.active": "Active",
    "badge.fault": "Fault",
    "badge.suspectResidue": "Suspect residue",
    "badge.incompatible": "Incompatible",
    "card.by": "by {author}",
    "card.switchAria": "Switch to skin {name}",
    "card.switching": "Switching…",
    "error.switch": "Switch failed: {error}",
    "warning.raw": "{warning}",
    "hint.settings": "Skin settings: {hint}",
    "empty.title": "No skins installed yet",
    "empty.hint":
      "Install a skin plugin that follows the skin covenant and it will appear here.",
    "overlay.close": "Close",
    "footer.open": "Skins",
    "provision.title": "Skin provisioning",
    "provision.subtitle": "Missing covenant skins are fetched in the background; your current look is never switched.",
    "provision.count": "{installed}/{total} ready",
    "provision.status.installed": "Ready",
    "provision.status.failed": "Failed",
    "provision.status.pending": "Pending",
    "provision.status.installing": "Installing",
    "provision.status.present": "Different version kept",
    "provision.status.excluded": "Not auto-restored",
    "provision.versionDiff": "manifest {target} · host {installed}",
    "provision.action.retry": "Retry failed",
    "provision.action.retrying": "Retrying…",
    "provision.toggle": "Auto-provision missing skins",
    "provision.idle": "Provisioning state is not available yet.",
  },
  zh: {
    "nav.label": "皮肤",
    "console.title": "换肤控制台",
    "console.subtitle": "切换工作区观感；皮肤自定义设置仍由皮肤自身管理。",
    "hero.currentLabel": "当前观感",
    "hero.defaultName": "默认观感",
    "hero.defaultDesc": "宿主内置观感——当前没有皮肤生效。",
    "action.reset": "恢复默认",
    "action.resetting": "恢复中…",
    "wall.title": "皮肤库",
    "wall.count": "{count} 个皮肤",
    "badge.discovered": "未启用",
    "badge.active": "当前",
    "badge.fault": "故障",
    "badge.suspectResidue": "疑似残留",
    "badge.incompatible": "不兼容",
    "card.by": "作者 {author}",
    "card.switchAria": "切换到皮肤 {name}",
    "card.switching": "切换中…",
    "error.switch": "切换失败：{error}",
    "warning.raw": "{warning}",
    "hint.settings": "皮肤设置：{hint}",
    "empty.title": "还没有安装任何皮肤",
    "empty.hint": "安装遵循换肤公约的皮肤插件后，会出现在这里。",
    "overlay.close": "关闭",
    "footer.open": "皮肤",
    "provision.title": "皮肤自动补齐",
    "provision.subtitle": "缺失的公约皮肤会在后台补装；不会切换你当前使用的观感。",
    "provision.count": "已就绪 {installed}/{total}",
    "provision.status.installed": "已就绪",
    "provision.status.failed": "失败",
    "provision.status.pending": "待安装",
    "provision.status.installing": "安装中",
    "provision.status.present": "已有其他版本（保留）",
    "provision.status.excluded": "不再自动补回",
    "provision.versionDiff": "清单 {target} · 宿主 {installed}",
    "provision.action.retry": "重试失败项",
    "provision.action.retrying": "重试中…",
    "provision.toggle": "自动补齐缺失皮肤",
    "provision.idle": "补齐状态尚未就绪。",
  },
};

/**
 * 状态 → 徽标文案键映射（brief §3 纯逻辑单测点 1）。
 * 不兼容展示优先于运行时状态（公约 §3：按不兼容展示，激活被拒绝）。
 */
export function statusBadgeKey(status: SkinStatus, incompatible?: string): keyof ConsoleMessages {
  if (incompatible !== undefined) {
    return "badge.incompatible";
  }
  switch (status) {
    case "active":
      return "badge.active";
    case "fault":
      return "badge.fault";
    case "suspect-residue":
      return "badge.suspectResidue";
    case "discovered":
      return "badge.discovered";
  }
}

/** switchTo 结果 → 用户消息（brief §3 纯逻辑单测点 2）。null = 成功且无警告（不谎报也不喧哗）。 */
export interface SwitchUserMessage {
  severity: "error" | "warning";
  /** 文案键；error 走 error.switch，warning 原文透出（warning.raw）。 */
  key: keyof ConsoleMessages;
  /** 文案模板参数（error / warning 原文）。 */
  params: Record<string, string>;
}

export function switchResultMessage(
  result: SwitchResult,
  context: "switch" | "reset" = "switch",
): SwitchUserMessage | null {
  if (result.ok) {
    if (result.warning === undefined) {
      return null;
    }
    return { severity: "warning", key: "warning.raw", params: { warning: result.warning } };
  }
  // context 仅影响日志语义；用户消息同形（恢复默认失败也是一次 switchTo("default") 失败）。
  void context;
  return { severity: "error", key: "error.switch", params: { error: result.error } };
}

/**
 * 卡片墙排序（brief §3 纯逻辑单测点 3）：按展示名（casefold）升序、平手按 id、
 * 再平手保持登记顺序（ES2019+ Array.prototype.sort 稳定）。返回新数组，不改入参。
 * default 不在 list() 里（由顶栏 hero 呈现），本函数不特判它。
 */
export function sortSkins(skins: readonly SkinInfo[]): SkinInfo[] {
  return skins
    .map((skin, index) => ({ skin, index }))
    .sort((a, b) => {
      const nameA = a.skin.name.toLowerCase();
      const nameB = b.skin.name.toLowerCase();
      if (nameA !== nameB) {
        return nameA < nameB ? -1 : 1;
      }
      if (a.skin.id !== b.skin.id) {
        return a.skin.id < b.skin.id ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.skin);
}

/** 按 id 找皮肤；current === "default"（或未登记）返回 null，由调用方呈现「默认观感」。 */
export function findSkin(skins: readonly SkinInfo[], id: string): SkinInfo | null {
  return skins.find((skin) => skin.id === id) ?? null;
}

/** 简单模板替换（`{name}` 占位；DshLocale.bind 的参数语义同形，供测试与兜底用）。 */
export function formatTemplate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
