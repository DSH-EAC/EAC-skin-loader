/**
 * 控制台样式（T2.5；T2.6-fix 核心观感变量升级为「宿主 token 优先 + 原值 fallback」）。
 *
 * 亮暗自适应形态（brief §1 的两选一，报告已说明）：**自带 CSS 变量双套**，不依赖宿主
 * 私有 DOM/类名（R5 红线）。控制台根元素持 `data-usl-scheme` 属性，值来自主题快照
 * （adapter getTheme/theme/change）——宿主切亮暗时根元素属性随之切换，语义色
 * （accent-soft/ok/warn/error/shadow）整体换套。
 *
 * T2.6-fix：核心观感变量（bg/surface/fg/muted/border/accent）改为
 * `var(--dsw-alias-*, 原值)`——宿主主题 API 的别名层是公开 ABI，皮肤（公约参考实现
 * aurora/inkwash）覆盖这些 token 时控制台自动跟随其色板，避免"面板已暗、控制台
 * 文字仍是自带浅色值"的对比度反转；无皮肤覆盖时 fallback 生效，原生观感不变。
 * 类名前缀 `usl-`（ui-skin-loader）为自留命名空间，不与上游冲突。
 *
 * 注入：材料化时往 document.head 插一条 <style>（幂等，data 标记守卫），
 * disposer 移除。这是标准 Web API（controller R11：不算上游耦合）。
 */

/** 控制台样式表（全部规则挂在 .usl-console 作用域下；前缀 usl- 自留）。 */
export const CONSOLE_CSS = String.raw`
.usl-console {
  --usl-bg: #ffffff;
  --usl-surface: #f6f7f9;
  --usl-surface-hover: #eceef2;
  /* 核心观感变量优先消费宿主主题 ABI 的别名 token（T2.6-fix）：皮肤经 theme API 覆盖
     这些 token 时控制台自动跟随其色板（否则深色玻璃皮肤下会出现"面板已暗、控制台
     文字仍用自带浅色值"的对比度反转）；fallback 保持本套原始值 = 无皮肤覆盖时的
     原生观感逐字节不变。token 名为宿主公开面（theme.register/别名层，api-notes §7，
     实机 BUILTIN_INSPECT_TOKENS 核对）。语义色（accent-soft/ok/warn/error/shadow）
     是自带双套值，不随皮肤 token 走。 */
  --usl-bg: var(--dsw-alias-bg-base, #ffffff);
  --usl-surface: var(--dsw-alias-bg-layer-1, #f6f7f9);
  --usl-surface-hover: var(--dsw-alias-bg-layer-2, #eceef2);
  --usl-fg: var(--dsw-alias-label-primary, #1c1f26);
  --usl-fg-muted: var(--dsw-alias-label-secondary, #5c6270);
  --usl-border: var(--dsw-alias-border-l2, #dfe2e8);
  --usl-accent: var(--dsw-alias-brand-primary, #3f6ae0);
  --usl-accent-soft: rgba(63, 106, 224, 0.12);
  /* 主按钮前景色 = 运行时按 accent 解析值的 WCAG 亮度推导（accent.ts +
     components.tsx useAccentFgRef，内联覆盖本变量）；此处两值仅为推导失败
     时的 fallback（亮案默认 accent #3f6ae0 上白字 4.8:1，与推导结果一致）。
     皮肤覆盖 brand-primary 为浅色时（如 aurora #6f9bff）自动改用墨色前景。 */
  --usl-accent-fg: #ffffff;
  --usl-ok: #1f8a4c;
  --usl-warn-fg: #8a5b16;
  --usl-warn-bg: #fdf3df;
  --usl-warn-border: #ecd9ae;
  --usl-error-fg: #a3352f;
  --usl-error-bg: #fdeceb;
  --usl-error-border: #f2c7c4;
  --usl-shadow: 0 12px 40px rgba(16, 20, 30, 0.16);
  color: var(--usl-fg);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.usl-console[data-usl-scheme="dark"] {
  /* 同上：核心观感变量跟随宿主 token（皮肤覆盖时 dark/light 两套解析到同一份
     皮肤色板——宿主 token 本身已按当前配色解析）；fallback 为本套 dark 原值。 */
  --usl-bg: var(--dsw-alias-bg-base, #191b20);
  --usl-surface: var(--dsw-alias-bg-layer-1, #22252c);
  --usl-surface-hover: var(--dsw-alias-bg-layer-2, #2b2f38);
  --usl-fg: var(--dsw-alias-label-primary, #e8eaef);
  --usl-fg-muted: var(--dsw-alias-label-secondary, #9aa0ad);
  --usl-border: var(--dsw-alias-border-l2, #363b45);
  --usl-accent: var(--dsw-alias-brand-primary, #6d92ec);
  --usl-accent-soft: rgba(109, 146, 236, 0.18);
  /* 同上：运行时按亮度推导的前景色 fallback（暗案默认 accent #6d92ec 上墨字，
     与推导结果一致）；推导失败时保留本值。 */
  --usl-accent-fg: #0e1116;
  --usl-ok: #58c586;
  --usl-warn-fg: #e2b96b;
  --usl-warn-bg: #332c18;
  --usl-warn-border: #55482a;
  --usl-error-fg: #ec8b86;
  --usl-error-bg: #37201e;
  --usl-error-border: #5a312e;
  --usl-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.usl-console *,
.usl-console *::before,
.usl-console *::after {
  box-sizing: border-box;
}
.usl-console button {
  font-family: inherit;
  cursor: pointer;
}
.usl-console button:disabled {
  cursor: default;
  opacity: 0.55;
}
.usl-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 14px;
}
.usl-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0;
}
.usl-subtitle {
  color: var(--usl-fg-muted);
  font-size: 12.5px;
  margin: 0;
}
.usl-hero {
  display: flex;
  align-items: stretch;
  gap: 14px;
  background: var(--usl-surface);
  border: 1px solid var(--usl-border);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 16px;
}
.usl-hero-preview {
  width: 168px;
  height: 94px;
  flex: none;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--usl-border);
  background: var(--usl-surface-hover);
}
.usl-hero-preview svg {
  width: 100%;
  height: 100%;
  display: block;
}
.usl-hero-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.usl-hero-label {
  color: var(--usl-fg-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.usl-hero-name {
  font-size: 16px;
  font-weight: 600;
}
.usl-hero-desc {
  color: var(--usl-fg-muted);
  font-size: 12.5px;
}
.usl-hero-actions {
  margin-top: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
.usl-btn {
  border: 1px solid var(--usl-border);
  border-radius: 8px;
  background: var(--usl-bg);
  color: var(--usl-fg);
  padding: 6px 12px;
  font-size: 13px;
}
.usl-btn:hover:not(:disabled) {
  background: var(--usl-surface-hover);
}
.usl-btn-primary {
  background: var(--usl-accent);
  border-color: var(--usl-accent);
  color: var(--usl-accent-fg);
}
.usl-btn-primary:hover:not(:disabled) {
  background: var(--usl-accent);
  filter: brightness(1.08);
}
.usl-section-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 8px;
}
.usl-count {
  color: var(--usl-fg-muted);
  font-weight: 400;
  font-size: 12px;
}
.usl-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
  gap: 10px;
}
.usl-card {
  text-align: left;
  background: var(--usl-surface);
  border: 1px solid var(--usl-border);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--usl-fg);
  font-size: 13px;
  transition: border-color 120ms ease, background 120ms ease;
  position: relative;
}
.usl-card:hover:not(:disabled) {
  background: var(--usl-surface-hover);
  border-color: var(--usl-accent);
}
.usl-card:focus-visible {
  outline: 2px solid var(--usl-accent);
  outline-offset: 1px;
}
.usl-card.is-active {
  border-color: var(--usl-accent);
  box-shadow: 0 0 0 1px var(--usl-accent) inset;
}
.usl-card.is-busy {
  pointer-events: none;
}
.usl-card-preview {
  height: 84px;
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid var(--usl-border);
  background: var(--usl-surface-hover);
}
.usl-card-preview svg {
  width: 100%;
  height: 100%;
  display: block;
}
.usl-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}
.usl-card-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usl-card-meta {
  color: var(--usl-fg-muted);
  font-size: 12px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.usl-card-error {
  background: var(--usl-error-bg);
  border: 1px solid var(--usl-error-border);
  color: var(--usl-error-fg);
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.usl-badge {
  flex: none;
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 999px;
  border: 1px solid var(--usl-border);
  color: var(--usl-fg-muted);
  background: var(--usl-bg);
}
.usl-badge.is-active {
  color: var(--usl-ok);
  border-color: color-mix(in srgb, var(--usl-ok) 45%, transparent);
}
.usl-badge.is-fault,
.usl-badge.is-suspectResidue {
  color: var(--usl-warn-fg);
  border-color: var(--usl-warn-border);
  background: var(--usl-warn-bg);
}
.usl-badge.is-incompatible {
  color: var(--usl-error-fg);
  border-color: var(--usl-error-border);
  background: var(--usl-error-bg);
}
.usl-hint {
  color: var(--usl-fg-muted);
  font-size: 12px;
  border-top: 1px dashed var(--usl-border);
  padding-top: 6px;
  overflow-wrap: anywhere;
}
.usl-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12.5px;
  margin-bottom: 12px;
  overflow-wrap: anywhere;
}
.usl-banner-warning {
  background: var(--usl-warn-bg);
  border: 1px solid var(--usl-warn-border);
  color: var(--usl-warn-fg);
}
.usl-banner-error {
  background: var(--usl-error-bg);
  border: 1px solid var(--usl-error-border);
  color: var(--usl-error-fg);
}
.usl-banner-close {
  margin-left: auto;
  flex: none;
  border: none;
  background: none;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
/* ---- 皮肤自动补齐（docs/git-distribution.md §3.5 最小状态界面）---- */
.usl-provision {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent);
}
.usl-provision-subtitle {
  margin: 4px 0 10px;
  font-size: 12px;
  opacity: 0.75;
  line-height: 1.5;
}
.usl-provision-idle {
  margin: 6px 0 0;
  font-size: 12px;
  opacity: 0.7;
}
.usl-provision-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.usl-provision-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.usl-provision-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  opacity: 0.85;
}
.usl-provision-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
}
.usl-provision-item[data-usl-provision-status="installed"] .usl-provision-badge {
  color: #0f7b55;
  border-color: color-mix(in srgb, #0f7b55 45%, transparent);
}
.usl-provision-item[data-usl-provision-status="failed"] .usl-provision-badge {
  color: #b3261e;
  border-color: color-mix(in srgb, #b3261e 45%, transparent);
}
.usl-provision-item[data-usl-provision-status="installing"] .usl-provision-badge,
.usl-provision-item[data-usl-provision-status="pending"] .usl-provision-badge {
  opacity: 0.85;
}
.usl-provision-meta {
  font-size: 11px;
  opacity: 0.75;
}
.usl-provision-error {
  flex-basis: 100%;
  font-size: 11px;
  color: #b3261e;
  word-break: break-word;
}
.usl-provision-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.usl-provision-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}
.usl-provision-toggle input {
  accent-color: currentColor;
}

.usl-empty {
  border: 1px dashed var(--usl-border);
  border-radius: 10px;
  padding: 26px 16px;
  text-align: center;
  color: var(--usl-fg-muted);
}
.usl-empty-title {
  font-weight: 600;
  color: var(--usl-fg);
  margin: 0 0 4px;
}
.usl-empty p {
  margin: 0;
  font-size: 12.5px;
}
.usl-spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--usl-accent-soft);
  border-top-color: var(--usl-accent);
  animation: usl-spin 700ms linear infinite;
  display: inline-block;
  vertical-align: -2px;
}
@keyframes usl-spin {
  to {
    transform: rotate(360deg);
  }
}
.usl-overlay-root {
  position: fixed;
  inset: 0;
  z-index: 1001;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.usl-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(10, 12, 18, 0.42);
  border: none;
  padding: 0;
  cursor: default;
}
.usl-overlay-panel {
  position: relative;
  width: min(720px, calc(100vw - 48px));
  max-height: min(640px, calc(100vh - 96px));
  overflow-y: auto;
  background: var(--usl-bg);
  border: 1px solid var(--usl-border);
  border-radius: 14px;
  box-shadow: var(--usl-shadow);
  padding: 18px;
}
.usl-overlay-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.usl-footer-action {
  border: none;
  background: none;
  color: inherit;
  border-radius: 8px;
  padding: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  min-width: 28px;
  min-height: 28px;
  justify-content: center;
}
.usl-footer-action:hover {
  background: var(--usl-surface-hover, rgba(127, 127, 127, 0.18));
}
.usl-footer-action:focus-visible {
  outline: 2px solid var(--usl-accent, #3f6ae0);
}
.usl-footer-action svg {
  width: 18px;
  height: 18px;
  display: block;
}
.usl-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
`;

/** 样式注入的守卫标记（style 节点与 owner 标记）。 */
const STYLE_NODE_ID = "usl-console-styles";

/**
 * 把控制台样式注入 document.head（幂等；重复调用复用同一节点）。
 * 返回移除注入的 disposer——重复注入共享同一节点，首个 disposer 释放即移除
 * （同一 bundle 只有一个控制台实例，语义上等价于卸载时清理）。
 */
export function ensureConsoleStyles(doc: Document): () => void {
  const existing = doc.getElementById(STYLE_NODE_ID);
  if (existing) {
    return () => undefined;
  }
  const node = doc.createElement("style");
  node.id = STYLE_NODE_ID;
  node.textContent = CONSOLE_CSS;
  doc.head.appendChild(node);
  let removed = false;
  return () => {
    if (removed) {
      return;
    }
    removed = true;
    node.remove();
  };
}
