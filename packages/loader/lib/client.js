window.__ModuleLoader__.load({
  id: "@dsh-eac/ui-skin-loader",
  factory: (require) => {
    var module = { exports: {} };

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/adapter/dsh-0.1.7.ts
function composeDisposers(disposers) {
  const list = [...disposers];
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    for (let i = list.length - 1; i >= 0; i--) {
      list[i]?.();
    }
  };
}
function composeDisposerResult(result) {
  if (typeof result === "function") {
    return result;
  }
  return composeDisposers(result ?? []);
}
function getHostInfo() {
  const boot = globalThis.__DSH_BOOT__;
  return {
    dshVersion: null,
    bootRev: typeof boot?.rev === "string" ? boot.rev : null
  };
}
function toUpstreamSlotOptions(options) {
  switch (options.kind) {
    case "list":
      if (!options.id) {
        throw new Error(
          `list slot "${options.name}" registration requires \`id\` (api-notes \xA75)`
        );
      }
      break;
    case "keyed":
      if (!options.key) {
        throw new Error(
          `keyed slot "${options.name}" registration requires \`key\` (api-notes \xA75)`
        );
      }
      break;
    case "chain":
      if (typeof options.select !== "function") {
        throw new Error(
          `chain slot "${options.name}" registration requires \`select\` (api-notes \xA75)`
        );
      }
      break;
    case "single":
      break;
  }
  const upstream = { ...options };
  delete upstream.kind;
  return upstream;
}
function createSlotsAdapter(upstream) {
  return {
    register(options, component) {
      return upstream.register(toUpstreamSlotOptions(options), component);
    },
    inject(key, callback) {
      return upstream.inject(key, () => composeDisposerResult(callback()));
    }
  };
}
function createThemeAdapter(upstream) {
  return {
    register(definition) {
      return upstream.register(definition);
    },
    overrideTokens(source, tokens) {
      for (const [token, modes] of Object.entries(tokens)) {
        if (modes === null || typeof modes !== "object" || typeof modes.light !== "string" || typeof modes.dark !== "string") {
          throw new Error(
            `overrideTokens("${source}") token "${token}" requires { light, dark } string values (api-notes \xA77)`
          );
        }
      }
      return upstream.overrideTokens(source, tokens);
    },
    getTheme() {
      const snapshot = upstream.getTheme();
      const preference = typeof snapshot?.preference === "string" ? snapshot.preference : "system";
      const colorScheme = snapshot?.active?.colorScheme === "dark" ? "dark" : "light";
      return { preference, colorScheme };
    }
  };
}
function createSettingsAdapter(upstream) {
  return {
    get(entryId) {
      const form = upstream.get(entryId);
      const projectionCache = /* @__PURE__ */ new WeakMap();
      return {
        get() {
          const snapshot = form.getSnapshot();
          const cached = projectionCache.get(snapshot);
          if (cached) {
            return cached;
          }
          const projected = {
            status: snapshot.status,
            value: snapshot.value,
            revision: snapshot.revision,
            writable: snapshot.writable
          };
          if (typeof snapshot === "object" && snapshot !== null) {
            projectionCache.set(snapshot, projected);
          }
          return projected;
        },
        set(field, value) {
          return form.set(field, value);
        },
        subscribe(listener) {
          return form.subscribe(listener);
        }
      };
    }
  };
}
function createLocaleAdapter(upstream) {
  return {
    register(ns, dicts) {
      return upstream.register(ns, dicts);
    },
    bind(ns) {
      return upstream.bind(ns);
    }
  };
}
function createDsh017Adapter(upstream) {
  return {
    slots: createSlotsAdapter(upstream.slots),
    theme: createThemeAdapter(upstream.theme),
    settings: createSettingsAdapter(upstream.configForms),
    locale: createLocaleAdapter(upstream.locale),
    remote: createRemoteAdapter(upstream.remote),
    events: createEventsAdapter({ on: upstream.on }),
    hostInfo: getHostInfo()
  };
}
function createRemoteAdapter(upstream) {
  return {
    $on(event, listener) {
      return upstream.$on(event, listener);
    }
  };
}
function createEventsAdapter(upstream) {
  return {
    on(event, listener) {
      const result = upstream.on(event, listener);
      return typeof result === "function" ? result : () => void 0;
    }
  };
}

// src/client/console/components.tsx
var import_react = require("react");

// src/protocol.ts
var CONVENTION_ID = "dsh.ecosystem.ui-skin-loader/v1";
var SERVICE_NAME = "uiSkinLoader";
var SETTINGS_NAMESPACE = "dsh-ui-skin-loader";
var DEFAULT_SKIN_ID = "default";

// src/client/runtime/clock.ts
var defaultTimers = {
  setTimeout(fn, ms) {
    return globalThis.setTimeout(fn, ms);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle);
  },
  setInterval(fn, ms) {
    return globalThis.setInterval(fn, ms);
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle);
  }
};
function raceTimeout(promise, ms, timers, onTimeout) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      timers.clearTimeout(handle);
      resolve(outcome);
    };
    const handle = timers.setTimeout(() => {
      settle({ kind: "timeout" });
      onTimeout?.();
    }, ms);
    promise.then(
      (value) => settle({ kind: "resolved", value }),
      (error) => settle({ kind: "rejected", error })
    );
  });
}

// src/client/runtime/persistence.ts
var MAX_FAULT_LOG = 50;
var DEFAULT_WRITE_TIMEOUT_MS = 1e4;
var SettingsStore = class {
  form;
  timers;
  writeTimeoutMs;
  log;
  constructor(adapter, timers, log, writeTimeoutMs = DEFAULT_WRITE_TIMEOUT_MS) {
    this.form = adapter.settings.get(SETTINGS_NAMESPACE);
    this.timers = timers;
    this.writeTimeoutMs = writeTimeoutMs;
    this.log = log;
  }
  /** 等待命名空间就绪（有界）；unavailable/超时 → null。 */
  async waitForReady(timeoutMs) {
    for (; ; ) {
      const snapshot = this.form.get();
      if (snapshot.status === "ready") {
        return this.readCurrent();
      }
      if (snapshot.status === "unavailable") {
        this.log("settings namespace is unavailable", {
          namespace: SETTINGS_NAMESPACE
        });
        return { status: "unavailable" };
      }
      const outcome = await new Promise((resolve) => {
        let done = false;
        let off = () => void 0;
        const settle = (value) => {
          if (done) {
            return;
          }
          done = true;
          off();
          this.timers.clearTimeout(handle);
          resolve(value);
        };
        const handle = this.timers.setTimeout(() => settle("timeout"), timeoutMs);
        off = this.form.subscribe(() => settle("changed"));
      });
      if (outcome === "timeout") {
        this.log("settings namespace did not become ready in time", {
          namespace: SETTINGS_NAMESPACE,
          timeoutMs
        });
        return { status: "unavailable" };
      }
    }
  }
  /** 读当前持久化值（ready 前提下）；非字符串/缺失的 activeSkin 防御性归一为 "default"。 */
  readCurrent() {
    const value = this.form.get().value;
    const raw = value.activeSkin;
    const activeSkin = typeof raw === "string" && raw.length > 0 ? raw : "default";
    const faultLog = Array.isArray(value.faultLog) ? value.faultLog.slice(-MAX_FAULT_LOG) : [];
    return { status: "ready", activeSkin, faultLog };
  }
  /** 读当前持久化值（不等 ready——同步检查用）。 */
  readSync() {
    const snapshot = this.form.get();
    if (snapshot.status !== "ready") {
      return { status: "unavailable" };
    }
    return this.readCurrent();
  }
  /**
   * 订阅本命名空间快照变更（跨标签页收敛的第二通道）。
   *
   * 实机验证（T2.7 V7）发现：上游对 `settings/document-updated` 的消费是
   * `mirror.load()`（dsh-client-ui-settings/lib/client.js L1512）——**异步回源**。
   * 事件到达时本端快照还是旧值，只靠事件驱动的 syncCheck 会读旧值幂等跳过、永不重放。
   * 快照回源时上游会通知 form 订阅者（快照标识更换），把它作为 syncCheck 的第二触发源
   * 即可在「无第二个事件」的情况下收敛；自身写入的回声与在途切换由 syncCheck 既有语义幂等消化。
   */
  onChange(listener) {
    return this.form.subscribe(listener);
  }
  /** 写 activeSkin；被拒/超时/抛错返回 false（调用方负责如实上报，不重试——上游已带恢复读）。 */
  async writeActiveSkin(id) {
    try {
      const outcome = await raceTimeout(this.form.set("activeSkin", id), this.writeTimeoutMs, this.timers);
      return outcome.kind === "resolved" && outcome.value === true;
    } catch (error) {
      this.log("activeSkin write threw", {
        namespace: SETTINGS_NAMESPACE,
        error: describeError(error)
      });
      return false;
    }
  }
  /**
   * 写整个 faultLog 列表（调用方维护有界内存镜像，见 MAX_FAULT_LOG）。
   * 被拒/超时/抛错返回 false（调用方负责降级记日志，不重试）。
   */
  async writeFaultLog(entries) {
    try {
      const outcome = await raceTimeout(this.form.set("faultLog", entries), this.writeTimeoutMs, this.timers);
      const accepted = outcome.kind === "resolved" && outcome.value === true;
      if (!accepted) {
        this.log("faultLog write rejected by host", {
          namespace: SETTINGS_NAMESPACE,
          entries: entries.length
        });
      }
      return accepted;
    } catch (error) {
      this.log("faultLog write threw", {
        namespace: SETTINGS_NAMESPACE,
        entries: entries.length,
        error: describeError(error)
      });
      return false;
    }
  }
};
function faultTimestamp(now) {
  return new Date(now?.() ?? Date.now()).toISOString();
}
function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// src/client/console/messages.ts
var CONSOLE_LOCALE_NS = "dsh-ui-skin-loader/console";
var CONSOLE_ENTRY_ID = "dsh-ui-skin-loader";
var MESSAGES = {
  en: {
    "nav.label": "Skins",
    "console.title": "Skin console",
    "console.subtitle": "Switch the workspace look. Skin settings stay owned by each skin.",
    "hero.currentLabel": "Current look",
    "hero.defaultName": "Default look",
    "hero.defaultDesc": "The host's built-in appearance \u2014 no skin is active.",
    "action.reset": "Restore default",
    "action.resetting": "Restoring\u2026",
    "wall.title": "Installed skins",
    "wall.count": "{count} skin(s)",
    "badge.discovered": "Available",
    "badge.active": "Active",
    "badge.fault": "Fault",
    "badge.suspectResidue": "Suspect residue",
    "badge.incompatible": "Incompatible",
    "card.by": "by {author}",
    "card.switchAria": "Switch to skin {name}",
    "card.switching": "Switching\u2026",
    "error.switch": "Switch failed: {error}",
    "warning.raw": "{warning}",
    "hint.settings": "Skin settings: {hint}",
    "empty.title": "No skins installed yet",
    "empty.hint": "Install a skin plugin that follows the skin covenant and it will appear here.",
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
    "provision.versionDiff": "manifest {target} \xB7 host {installed}",
    "provision.action.retry": "Retry failed",
    "provision.action.retrying": "Retrying\u2026",
    "provision.toggle": "Auto-provision missing skins",
    "provision.idle": "Provisioning state is not available yet."
  },
  zh: {
    "nav.label": "\u76AE\u80A4",
    "console.title": "\u6362\u80A4\u63A7\u5236\u53F0",
    "console.subtitle": "\u5207\u6362\u5DE5\u4F5C\u533A\u89C2\u611F\uFF1B\u76AE\u80A4\u81EA\u5B9A\u4E49\u8BBE\u7F6E\u4ECD\u7531\u76AE\u80A4\u81EA\u8EAB\u7BA1\u7406\u3002",
    "hero.currentLabel": "\u5F53\u524D\u89C2\u611F",
    "hero.defaultName": "\u9ED8\u8BA4\u89C2\u611F",
    "hero.defaultDesc": "\u5BBF\u4E3B\u5185\u7F6E\u89C2\u611F\u2014\u2014\u5F53\u524D\u6CA1\u6709\u76AE\u80A4\u751F\u6548\u3002",
    "action.reset": "\u6062\u590D\u9ED8\u8BA4",
    "action.resetting": "\u6062\u590D\u4E2D\u2026",
    "wall.title": "\u76AE\u80A4\u5E93",
    "wall.count": "{count} \u4E2A\u76AE\u80A4",
    "badge.discovered": "\u672A\u542F\u7528",
    "badge.active": "\u5F53\u524D",
    "badge.fault": "\u6545\u969C",
    "badge.suspectResidue": "\u7591\u4F3C\u6B8B\u7559",
    "badge.incompatible": "\u4E0D\u517C\u5BB9",
    "card.by": "\u4F5C\u8005 {author}",
    "card.switchAria": "\u5207\u6362\u5230\u76AE\u80A4 {name}",
    "card.switching": "\u5207\u6362\u4E2D\u2026",
    "error.switch": "\u5207\u6362\u5931\u8D25\uFF1A{error}",
    "warning.raw": "{warning}",
    "hint.settings": "\u76AE\u80A4\u8BBE\u7F6E\uFF1A{hint}",
    "empty.title": "\u8FD8\u6CA1\u6709\u5B89\u88C5\u4EFB\u4F55\u76AE\u80A4",
    "empty.hint": "\u5B89\u88C5\u9075\u5FAA\u6362\u80A4\u516C\u7EA6\u7684\u76AE\u80A4\u63D2\u4EF6\u540E\uFF0C\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
    "overlay.close": "\u5173\u95ED",
    "footer.open": "\u76AE\u80A4",
    "provision.title": "\u76AE\u80A4\u81EA\u52A8\u8865\u9F50",
    "provision.subtitle": "\u7F3A\u5931\u7684\u516C\u7EA6\u76AE\u80A4\u4F1A\u5728\u540E\u53F0\u8865\u88C5\uFF1B\u4E0D\u4F1A\u5207\u6362\u4F60\u5F53\u524D\u4F7F\u7528\u7684\u89C2\u611F\u3002",
    "provision.count": "\u5DF2\u5C31\u7EEA {installed}/{total}",
    "provision.status.installed": "\u5DF2\u5C31\u7EEA",
    "provision.status.failed": "\u5931\u8D25",
    "provision.status.pending": "\u5F85\u5B89\u88C5",
    "provision.status.installing": "\u5B89\u88C5\u4E2D",
    "provision.status.present": "\u5DF2\u6709\u5176\u4ED6\u7248\u672C\uFF08\u4FDD\u7559\uFF09",
    "provision.status.excluded": "\u4E0D\u518D\u81EA\u52A8\u8865\u56DE",
    "provision.versionDiff": "\u6E05\u5355 {target} \xB7 \u5BBF\u4E3B {installed}",
    "provision.action.retry": "\u91CD\u8BD5\u5931\u8D25\u9879",
    "provision.action.retrying": "\u91CD\u8BD5\u4E2D\u2026",
    "provision.toggle": "\u81EA\u52A8\u8865\u9F50\u7F3A\u5931\u76AE\u80A4",
    "provision.idle": "\u8865\u9F50\u72B6\u6001\u5C1A\u672A\u5C31\u7EEA\u3002"
  }
};
function statusBadgeKey(status, incompatible) {
  if (incompatible !== void 0) {
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
function switchResultMessage(result, context = "switch") {
  if (result.ok) {
    if (result.warning === void 0) {
      return null;
    }
    return { severity: "warning", key: "warning.raw", params: { warning: result.warning } };
  }
  void context;
  return { severity: "error", key: "error.switch", params: { error: result.error } };
}
function sortSkins(skins) {
  return skins.map((skin, index) => ({ skin, index })).sort((a, b) => {
    const nameA = a.skin.name.toLowerCase();
    const nameB = b.skin.name.toLowerCase();
    if (nameA !== nameB) {
      return nameA < nameB ? -1 : 1;
    }
    if (a.skin.id !== b.skin.id) {
      return a.skin.id < b.skin.id ? -1 : 1;
    }
    return a.index - b.index;
  }).map((entry) => entry.skin);
}
function findSkin(skins, id) {
  return skins.find((skin) => skin.id === id) ?? null;
}
function formatTemplate(template, params) {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value === void 0 ? match : String(value);
  });
}

// src/client/console/accent.ts
var ACCENT_FG_LIGHT = "#ffffff";
var ACCENT_FG_DARK = "#0e1116";
function parseCssColor(value) {
  const text = value.trim().toLowerCase();
  if (text.length === 0) {
    return null;
  }
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (![3, 4, 6, 8].includes(hex.length) || /[^0-9a-f]/.test(hex)) {
      return null;
    }
    const step = hex.length <= 4 ? 1 : 2;
    const channel2 = (i) => {
      const part = hex.slice(i * step, i * step + step);
      return Number.parseInt(step === 1 ? part + part : part, 16);
    };
    const alphaPart = hex.slice(3 * step);
    const alpha2 = alphaPart.length > 0 ? Number.parseInt(step === 1 ? alphaPart + alphaPart : alphaPart, 16) / 255 : 1;
    return [channel2(0), channel2(1), channel2(2), alpha2];
  }
  const functional = /^rgba?\(([^)]+)\)$/.exec(text);
  if (functional === null || functional[1] === void 0) {
    return null;
  }
  const parts = functional[1].replace(/\//g, " ").split(/[\s,]+/).filter((p) => p.length > 0);
  if (parts.length < 3 || parts.length > 4) {
    return null;
  }
  const channel = (i) => Number.parseFloat(parts[i] ?? "");
  const alpha = parts.length === 4 ? Number.parseFloat(parts[3] ?? "") : 1;
  if (![channel(0), channel(1), channel(2), alpha].every(Number.isFinite)) {
    return null;
  }
  return [channel(0), channel(1), channel(2), alpha];
}
function relativeLuminance([r, g, b]) {
  const linearize = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
var WHITE = [255, 255, 255, 1];
var INK = [14, 17, 22, 1];
function deriveAccentFg(resolvedAccent) {
  const accent = parseCssColor(resolvedAccent);
  if (accent === null) {
    return null;
  }
  return contrastRatio(accent, WHITE) >= contrastRatio(accent, INK) ? ACCENT_FG_LIGHT : ACCENT_FG_DARK;
}

// src/client/console/preview.ts
function hash32(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function gradientHues(id) {
  const hash = hash32(id);
  const from = hash % 360;
  const span = 40 + (hash >>> 9) % 41;
  const to = (from + span) % 360;
  return { from, to };
}
function generatedPreviewSvg(id, name) {
  const { from, to } = gradientHues(id);
  const initial = (name.trim()[0] ?? id.trim()[0] ?? "?").toUpperCase();
  const gid = `usl-g-${hash32(id).toString(36)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="${escapeAttr(name)}"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${from} 62% 58%)"/><stop offset="1" stop-color="hsl(${to} 58% 38%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#${gid})"/><circle cx="160" cy="90" r="34" fill="rgba(255,255,255,.22)"/><text x="160" y="90" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="30" font-weight="600" fill="rgba(255,255,255,.95)">${escapeText(initial)}</text></svg>`;
}
function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeText(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function isInlineSvg(preview) {
  return typeof preview === "string" && /^<svg[\s>]/i.test(preview.trimStart());
}
function resolvePreviewSvg(skin) {
  if (isInlineSvg(skin.preview)) {
    return skin.preview;
  }
  return generatedPreviewSvg(skin.id, skin.name);
}

// src/host/provisioning-state.ts
var PROVISIONING_STATE_VERSION = 1;
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var STATUSES = [
  "pending",
  "installing",
  "installed",
  "failed",
  "present",
  "excluded"
];
function normalizeProvisioningState(raw) {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== PROVISIONING_STATE_VERSION) return null;
  if (typeof raw.releaseSet !== "string" || raw.releaseSet.length === 0) return null;
  if (!isPlainObject(raw.items)) return null;
  const items = {};
  for (const [name, entry] of Object.entries(raw.items)) {
    if (!isPlainObject(entry)) continue;
    const status = STATUSES.find((s) => s === entry.status);
    if (status === void 0) continue;
    if (typeof entry.targetVersion !== "string" || entry.targetVersion.length === 0) continue;
    if (typeof entry.attempts !== "number" || !Number.isSafeInteger(entry.attempts) || entry.attempts < 0) {
      continue;
    }
    if (typeof entry.updatedAt !== "string" || entry.updatedAt.length === 0) continue;
    items[name] = {
      status,
      targetVersion: entry.targetVersion,
      attempts: entry.attempts,
      updatedAt: entry.updatedAt,
      ...typeof entry.installedVersion === "string" && entry.installedVersion.length > 0 ? { installedVersion: entry.installedVersion } : {},
      ...typeof entry.error === "string" && entry.error.length > 0 ? { error: entry.error } : {}
    };
  }
  const state = { version: PROVISIONING_STATE_VERSION, releaseSet: raw.releaseSet, items };
  if (typeof raw.startedAt === "string" && raw.startedAt.length > 0) state.startedAt = raw.startedAt;
  if (typeof raw.completedAt === "string" && raw.completedAt.length > 0) state.completedAt = raw.completedAt;
  return state;
}

// src/client/console/provisioning.ts
var EMPTY_PROVISIONING_VIEW = {
  available: false,
  enabled: true,
  releaseSet: null,
  items: [],
  counts: { installed: 0, failed: 0, pending: 0, present: 0, excluded: 0, installing: 0 }
};
function projectProvisioningView(settingsValue) {
  const value = settingsValue ?? {};
  const state = normalizeProvisioningState(value.provisioning);
  const enabled = value.autoProvision !== false;
  if (!state) {
    return { ...EMPTY_PROVISIONING_VIEW, enabled };
  }
  const items = Object.entries(state.items).map(([name, item]) => ({
    name,
    status: item.status,
    targetVersion: item.targetVersion,
    ...item.installedVersion !== void 0 ? { installedVersion: item.installedVersion } : {},
    ...item.error !== void 0 ? { error: item.error } : {},
    attempts: item.attempts,
    updatedAt: item.updatedAt
  }));
  items.sort((a, b) => a.name.localeCompare(b.name));
  const counts = { installed: 0, failed: 0, pending: 0, present: 0, excluded: 0, installing: 0 };
  for (const item of items) counts[item.status] += 1;
  return {
    available: true,
    enabled,
    releaseSet: state.releaseSet,
    items,
    counts
  };
}
function createProvisioningFacade(adapter) {
  const form = adapter.settings.get(SETTINGS_NAMESPACE);
  const listeners = /* @__PURE__ */ new Set();
  const projectionCache = /* @__PURE__ */ new WeakMap();
  let unsubscribe = null;
  const ensureSubscribed = () => {
    if (unsubscribe !== null) return;
    unsubscribe = form.subscribe(() => {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
        }
      }
    });
  };
  return {
    snapshot() {
      const snapshot = form.get();
      if (snapshot.status !== "ready") {
        return { ...EMPTY_PROVISIONING_VIEW };
      }
      const cached = projectionCache.get(snapshot);
      if (cached) return cached;
      const view = projectProvisioningView(snapshot.value);
      projectionCache.set(snapshot, view);
      return view;
    },
    subscribe(listener) {
      ensureSubscribed();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribe !== null) {
          unsubscribe();
          unsubscribe = null;
        }
      };
    },
    async setEnabled(next) {
      try {
        return await form.set("autoProvision", next) === true;
      } catch {
        return false;
      }
    },
    async requestRetry() {
      try {
        const command = { kind: "retry", at: (/* @__PURE__ */ new Date()).toISOString() };
        return await form.set("provisionCommand", command) === true;
      } catch {
        return false;
      }
    }
  };
}
function provisioningStatusMessageKey(status) {
  switch (status) {
    case "installed":
      return "provision.status.installed";
    case "failed":
      return "provision.status.failed";
    case "pending":
      return "provision.status.pending";
    case "installing":
      return "provision.status.installing";
    case "present":
      return "provision.status.present";
    case "excluded":
      return "provision.status.excluded";
  }
}

// src/client/console/components.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var ConsoleContext = (0, import_react.createContext)(null);
function useConsole() {
  const value = (0, import_react.useContext)(ConsoleContext);
  if (!value) {
    throw new Error("console components must render inside ConsoleEnvProvider");
  }
  return value;
}
function ConsoleEnvProvider({
  env,
  children
}) {
  const scheme = (0, import_react.useSyncExternalStore)(env.scheme.subscribe, env.scheme.get);
  const localeRev = (0, import_react.useSyncExternalStore)(
    env.localeRevision.subscribe,
    env.localeRevision.get
  );
  const value = (0, import_react.useMemo)(
    () => ({ env, scheme, t: env.t, localeRev }),
    [env, scheme, localeRev]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConsoleContext.Provider, { value, children });
}
function useRuntimeState(runtime) {
  const read = (0, import_react.useCallback)(
    () => ({ list: runtime.list(), current: runtime.current() }),
    [runtime]
  );
  const [state, setState] = (0, import_react.useState)(read);
  (0, import_react.useEffect)(() => {
    setState(read());
    return runtime.subscribe(() => setState(read()));
  }, [runtime, read]);
  return state;
}
function useMounted() {
  const mounted = (0, import_react.useRef)(true);
  (0, import_react.useEffect)(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
var DEFAULT_PREVIEW_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img"><defs><linearGradient id="usl-default-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9aa2b1"/><stop offset="1" stop-color="#5b6472"/></linearGradient></defs><rect width="320" height="180" fill="url(#usl-default-g)"/><circle cx="160" cy="90" r="34" fill="rgba(255,255,255,.2)"/><path d="M146 104V76l14-8 14 8v28l-14 8z" fill="rgba(255,255,255,.92)"/></svg>';
function SkinConsole({ hideHeader = false }) {
  const { env, t } = useConsole();
  const { runtime } = env;
  const { list, current } = useRuntimeState(runtime);
  const mounted = useMounted();
  const [switchingId, setSwitchingId] = (0, import_react.useState)(null);
  const [failure, setFailure] = (0, import_react.useState)(null);
  const [warning, setWarning] = (0, import_react.useState)(null);
  const busy = switchingId !== null;
  const sorted = (0, import_react.useMemo)(() => sortSkins(list), [list]);
  const currentSkin = current === DEFAULT_SKIN_ID ? null : findSkin(list, current);
  const handleSwitch = (0, import_react.useCallback)(
    async (target) => {
      if (switchingId !== null) {
        return;
      }
      setSwitchingId(target);
      setFailure(null);
      setWarning(null);
      let result;
      try {
        result = await runtime.switchTo(target);
      } catch (error) {
        result = { ok: false, error: describeError(error), rolledBackTo: DEFAULT_SKIN_ID };
      }
      if (!mounted.current) {
        return;
      }
      setSwitchingId(null);
      const message = switchResultMessage(result);
      if (message === null) {
        return;
      }
      if (message.severity === "error") {
        setFailure({ target, message: formatTemplate(t(message.key), message.params) });
      } else {
        setWarning(formatTemplate(t(message.key), message.params));
      }
    },
    [runtime, switchingId, t, mounted]
  );
  const heroPreview = currentSkin ? resolvePreviewSvg(currentSkin) : DEFAULT_PREVIEW_SVG;
  const heroName = current === DEFAULT_SKIN_ID ? t("hero.defaultName") : currentSkin?.name ?? current;
  const heroDesc = current === DEFAULT_SKIN_ID ? t("hero.defaultDesc") : currentSkin?.description ?? null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-console-body", children: [
    warning !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-banner usl-banner-warning", "data-usl-role": "warning", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: warning }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "usl-banner-close",
          "aria-label": t("overlay.close"),
          onClick: () => setWarning(null),
          children: "\xD7"
        }
      )
    ] }),
    !hideHeader && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "usl-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "usl-title", children: t("console.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "usl-subtitle", children: t("console.subtitle") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-hero", "data-usl-role": "hero", "data-usl-current": current, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "usl-hero-preview", dangerouslySetInnerHTML: { __html: heroPreview } }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-hero-body", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-hero-label", children: t("hero.currentLabel") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-hero-name", "data-usl-role": "hero-name", children: heroName }),
        heroDesc !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-hero-desc", children: heroDesc }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "usl-hero-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "usl-btn usl-btn-primary",
            disabled: busy || current === DEFAULT_SKIN_ID,
            onClick: () => void handleSwitch(DEFAULT_SKIN_ID),
            "data-usl-role": "reset-button",
            children: switchingId === DEFAULT_SKIN_ID ? t("action.resetting") : t("action.reset")
          }
        ) })
      ] })
    ] }),
    failure !== null && failure.target === DEFAULT_SKIN_ID && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-banner usl-banner-error", "data-usl-role": "reset-error", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: failure.message }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "usl-banner-close",
          "aria-label": t("overlay.close"),
          onClick: () => setFailure(null),
          children: "\xD7"
        }
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { className: "usl-section-title", children: [
      t("wall.title"),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-count", children: formatTemplate(t("wall.count"), { count: sorted.length }) })
    ] }),
    sorted.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-empty", "data-usl-role": "empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "usl-empty-title", children: t("empty.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("empty.hint") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "usl-wall", "data-usl-role": "wall", children: sorted.map((skin) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      SkinCard,
      {
        skin,
        isCurrent: skin.id === current,
        isSwitching: switchingId === skin.id,
        busy,
        failure: failure !== null && failure.target === skin.id ? failure.message : null,
        onSwitch: () => void handleSwitch(skin.id)
      },
      skin.id
    )) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProvisioningPanel, {})
  ] });
}
function ProvisioningPanel() {
  const { env, t } = useConsole();
  const facade = env.provisioning;
  const mounted = useMounted();
  const view = (0, import_react.useSyncExternalStore)(facade.subscribe, facade.snapshot);
  const [busy, setBusy] = (0, import_react.useState)(null);
  const handleToggle = (0, import_react.useCallback)(async () => {
    if (busy !== null) return;
    setBusy("toggle");
    try {
      await facade.setEnabled(!view.enabled);
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [facade, view.enabled, busy, mounted]);
  const handleRetry = (0, import_react.useCallback)(async () => {
    if (busy !== null || view.counts.failed === 0) return;
    setBusy("retry");
    try {
      await facade.requestRetry();
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [facade, view.counts.failed, busy, mounted]);
  if (!view.available) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "usl-provision", "data-usl-role": "provision", "data-usl-available": "false", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { className: "usl-section-title", children: t("provision.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "usl-provision-idle", "data-usl-role": "provision-idle", children: t("provision.idle") })
    ] });
  }
  const total = view.items.length;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "usl-provision", "data-usl-role": "provision", "data-usl-available": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { className: "usl-section-title", children: [
      t("provision.title"),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-count", children: formatTemplate(t("provision.count"), { installed: view.counts.installed, total }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "usl-provision-subtitle", children: t("provision.subtitle") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "usl-provision-list", "data-usl-role": "provision-list", children: view.items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProvisioningItem, { item, t }, item.name)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-provision-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "usl-provision-toggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "checkbox",
            checked: view.enabled,
            disabled: busy !== null,
            onChange: () => void handleToggle(),
            "data-usl-role": "provision-toggle"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("provision.toggle") })
      ] }),
      view.counts.failed > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "usl-btn",
          disabled: busy !== null,
          onClick: () => void handleRetry(),
          "data-usl-role": "provision-retry",
          children: busy === "retry" ? t("provision.action.retrying") : t("provision.action.retry")
        }
      )
    ] })
  ] });
}
function ProvisioningItem({ item, t }) {
  const shortName = item.name.replace(/^@/, "");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: "usl-provision-item", "data-usl-provision-status": item.status, "data-usl-provision-name": item.name, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-provision-name", children: shortName }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-provision-badge", "data-usl-role": "provision-badge", children: t(provisioningStatusMessageKey(item.status)) }),
    item.status === "present" && item.installedVersion !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-provision-meta", "data-usl-role": "provision-version-diff", children: formatTemplate(t("provision.versionDiff"), {
      target: item.targetVersion,
      installed: item.installedVersion
    }) }),
    item.error !== void 0 && item.status === "failed" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-provision-error", "data-usl-role": "provision-error", children: item.error })
  ] });
}
function SkinCard({
  skin,
  isCurrent,
  isSwitching,
  busy,
  failure,
  onSwitch
}) {
  const { t } = useConsole();
  const badgeKey = statusBadgeKey(skin.status, skin.incompatible);
  const badgeClass = `usl-badge is-${badgeKey.replace("badge.", "")}`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: `usl-card${isCurrent ? " is-active" : ""}${busy ? " is-busy" : ""}`,
      disabled: busy,
      onClick: onSwitch,
      "aria-label": formatTemplate(t("card.switchAria"), { name: skin.name }),
      "data-usl-role": "skin-card",
      "data-usl-skin-id": skin.id,
      "data-usl-skin-status": skin.status,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-card-preview", dangerouslySetInnerHTML: { __html: resolvePreviewSvg(skin) } }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "usl-card-top", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-card-name", children: skin.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: badgeClass, "data-usl-role": "badge", children: t(badgeKey) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "usl-card-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            "v",
            skin.version
          ] }),
          skin.author !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatTemplate(t("card.by"), { author: skin.author }) })
        ] }),
        isSwitching && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "usl-card-meta", "data-usl-role": "switching", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-spinner" }),
          " ",
          t("card.switching")
        ] }),
        failure !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-card-error", "data-usl-role": "card-error", children: failure }),
        skin.settingsHint !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-hint", "data-usl-role": "settings-hint", children: formatTemplate(t("hint.settings"), { hint: skin.settingsHint }) })
      ]
    }
  );
}
function useAccentFgRef() {
  return (0, import_react.useCallback)((el) => {
    if (el === null) {
      return;
    }
    const apply2 = () => {
      const accent = getComputedStyle(el).getPropertyValue("--usl-accent").trim();
      const fg = deriveAccentFg(accent);
      if (fg === null) {
        el.style.removeProperty("--usl-accent-fg");
      } else {
        el.style.setProperty("--usl-accent-fg", fg);
      }
    };
    apply2();
    const observer = new MutationObserver(apply2);
    observer.observe(el.ownerDocument.body, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);
}
function SettingsSection() {
  const { scheme } = useConsole();
  const accentFgRef = useAccentFgRef();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "div",
    {
      ref: accentFgRef,
      className: "usl-console",
      "data-usl-scheme": scheme,
      "data-usl-section": "dsh-ui-skin-loader",
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkinConsole, {})
    }
  );
}
function FooterAction({ wide }) {
  const { env, t } = useConsole();
  const open = (0, import_react.useSyncExternalStore)(env.overlayOpen.subscribe, env.overlayOpen.get);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: "usl-footer-action",
      onClick: () => {
        env.overlayOpen.set(!open);
      },
      "aria-label": t("footer.open"),
      title: t("footer.open"),
      "data-usl-role": "footer-action",
      "data-usl-open": open ? "true" : "false",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", "aria-hidden": "true", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "3", y: "4", width: "18", height: "16", rx: "3" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3 9h18" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7 14h6" })
        ] }),
        wide ? t("footer.open") : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "usl-visually-hidden", children: t("footer.open") })
      ]
    }
  );
}
function OverlayHost() {
  const { env, scheme, t } = useConsole();
  const open = (0, import_react.useSyncExternalStore)(env.overlayOpen.subscribe, env.overlayOpen.get);
  const accentFgRef = useAccentFgRef();
  if (!open) {
    return null;
  }
  const close = () => env.overlayOpen.set(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-overlay-root", "data-usl-role": "overlay-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "usl-overlay-backdrop",
        onClick: close,
        tabIndex: -1,
        "aria-hidden": "true"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        ref: accentFgRef,
        className: "usl-overlay-panel usl-console",
        "data-usl-scheme": scheme,
        role: "dialog",
        "aria-label": t("console.title"),
        "data-usl-role": "overlay-panel",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "usl-overlay-header", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "usl-title", children: t("console.title") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "usl-btn", onClick: close, "data-usl-role": "overlay-close", children: t("overlay.close") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkinConsole, { hideHeader: true })
        ]
      }
    )
  ] });
}

// src/client/console/env.ts
function createStore(initial, equals) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    get: () => value,
    set(next) {
      if (equals(value, next)) {
        return;
      }
      value = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
function createSchemeStore(initial) {
  return createStore(initial, (a, b) => a === b);
}
function createLocaleRevisionStore() {
  const store = createStore(0, (a, b) => a === b);
  return {
    get: store.get,
    subscribe: store.subscribe,
    bump() {
      store.set(store.get() + 1);
    }
  };
}
function createFlagStore(initial) {
  return createStore(initial, (a, b) => a === b);
}

// src/client/console/styles.ts
var CONSOLE_CSS = String.raw`
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
var STYLE_NODE_ID = "usl-console-styles";
function ensureConsoleStyles(doc) {
  const existing = doc.getElementById(STYLE_NODE_ID);
  if (existing) {
    return () => void 0;
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

// src/client/console/mount.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function createConsoleController(options) {
  const { adapter, runtime } = options;
  const doc = options.document ?? globalThis.document;
  function start() {
    const disposers = [];
    disposers.push(ensureConsoleStyles(doc));
    disposers.push(
      adapter.locale.register(CONSOLE_LOCALE_NS, { en: { ...MESSAGES.en }, zh: { ...MESSAGES.zh } })
    );
    const t = adapter.locale.bind(CONSOLE_LOCALE_NS);
    const scheme = createSchemeStore(adapter.theme.getTheme().colorScheme);
    disposers.push(
      adapter.events.on("theme/change", (...args) => {
        const snapshot = args[0];
        scheme.set(snapshot?.active?.colorScheme === "dark" ? "dark" : "light");
      })
    );
    const localeRevision = createLocaleRevisionStore();
    const overlayOpen = createFlagStore(false);
    const provisioning = createProvisioningFacade(adapter);
    const env = { runtime, t, scheme, localeRevision, overlayOpen, provisioning };
    const withEnv = (Component) => {
      const Element = Component;
      return (props) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ConsoleEnvProvider, { env, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Element, { ...props }) });
    };
    let sectionOff = null;
    const registerSection = () => {
      sectionOff?.();
      sectionOff = adapter.slots.register(
        {
          name: "settings.section",
          kind: "list",
          id: CONSOLE_ENTRY_ID,
          order: 90,
          label: t("nav.label")
        },
        withEnv(SettingsSection)
      );
    };
    disposers.push(
      adapter.events.on("locale/change", () => {
        localeRevision.bump();
        registerSection();
      })
    );
    disposers.push(
      adapter.slots.inject("settings.section", () => {
        registerSection();
        return () => {
          sectionOff?.();
          sectionOff = null;
        };
      })
    );
    disposers.push(
      adapter.slots.inject(
        "sidebar.footer.action",
        () => adapter.slots.register(
          { name: "sidebar.footer.action", kind: "list", id: CONSOLE_ENTRY_ID, order: 90 },
          withEnv(FooterAction)
        )
      )
    );
    disposers.push(
      adapter.slots.inject(
        "shell.overlay",
        () => adapter.slots.register(
          { name: "shell.overlay", kind: "list", id: CONSOLE_ENTRY_ID, order: 90 },
          withEnv(OverlayHost)
        )
      )
    );
    return composeDisposers(disposers);
  }
  return { start };
}

// src/client/runtime/logger.ts
function createPrefixed(prefix, sink) {
  return {
    debug(message, details) {
      sink.debug(`[${prefix}] ${message}`, details ?? {});
    },
    info(message, details) {
      sink.info(`[${prefix}] ${message}`, details ?? {});
    },
    warn(message, details) {
      sink.warn(`[${prefix}] ${message}`, details ?? {});
    },
    error(message, details) {
      sink.error(`[${prefix}] ${message}`, details ?? {});
    }
  };
}
function createConsoleLogger(prefix) {
  return createPrefixed(prefix, console);
}
function createSkinLogger(skinId) {
  return createConsoleLogger(`ui-skin-loader:${skinId}`);
}

// src/client/runtime/runtime.ts
var DEFAULT_DEACTIVATE_MS = 1e4;
var DEFAULT_ACTIVATE_MS = 1e4;
var DEFAULT_RECOVERY_READY_MS = 1e4;
var DEFAULT_RECOVERY_GRACE_MS = 5e3;
var DEFAULT_UNREGISTER_GRACE_MS = 300;
var SUPPORTED_MAJOR = Number(/\/v(\d+)$/.exec(CONVENTION_ID)?.[1] ?? Number.NaN);
var SKIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
var API_VERSION_PATTERN = /^dsh\.ecosystem\.ui-skin-loader\/v(\d+)$/;
var DOCUMENT_UPDATED_EVENT = "settings/document-updated";
function computeIncompatible(id, apiVersion) {
  if (!SKIN_ID_PATTERN.test(id)) {
    return `skin id "${id}" does not match the covenant id pattern [a-z0-9]+(?:[.-][a-z0-9]+)* (covenant \xA73)`;
  }
  const match = API_VERSION_PATTERN.exec(apiVersion);
  if (!match) {
    return `apiVersion "${apiVersion}" is not a dsh.ecosystem.ui-skin-loader/v{N} version (covenant \xA73)`;
  }
  const major = Number(match[1]);
  if (major !== SUPPORTED_MAJOR) {
    return `apiVersion "${apiVersion}" declares major v${major}, but this loader implements v${SUPPORTED_MAJOR} (covenant \xA78)`;
  }
  return void 0;
}
function createSkinRuntime(options) {
  const { adapter } = options;
  const timers = options.timers ?? defaultTimers;
  const logger = options.logger ?? createConsoleLogger("ui-skin-loader");
  const deactivateMs = options.timeouts?.deactivateMs ?? DEFAULT_DEACTIVATE_MS;
  const activateMs = options.timeouts?.activateMs ?? DEFAULT_ACTIVATE_MS;
  const recoveryReadyMs = options.recovery?.readyMs ?? DEFAULT_RECOVERY_READY_MS;
  const recoveryGraceMs = options.recovery?.graceMs ?? DEFAULT_RECOVERY_GRACE_MS;
  const unregisterGraceMs = options.unregisterGraceMs ?? DEFAULT_UNREGISTER_GRACE_MS;
  const timestamp = () => faultTimestamp(options.now);
  const store = new SettingsStore(
    adapter,
    timers,
    (message, details) => logger.warn(message, details)
  );
  const discovered = /* @__PURE__ */ new Map();
  const subscribers = /* @__PURE__ */ new Set();
  const recoveryWaits = /* @__PURE__ */ new Map();
  let faultLogMirror = [];
  let registrationToken = 0;
  let switchEpoch = 0;
  let currentId = DEFAULT_SKIN_ID;
  let active = null;
  let aborter = null;
  let inFlight = null;
  let disposed = false;
  let stopPromise = null;
  let lifecycleStarted = false;
  let recoveryStarted = false;
  let userInteracted = false;
  let syncOff = null;
  let syncFormOff = null;
  let pendingSyncCheck = false;
  let syncCheckScheduled = false;
  let grace = null;
  function notify() {
    for (const cb of [...subscribers]) {
      try {
        cb();
      } catch (error) {
        logger.warn("state subscriber threw", { error: describeError(error) });
      }
    }
  }
  async function appendFault(entry) {
    faultLogMirror = [...faultLogMirror, entry].slice(-MAX_FAULT_LOG);
    await store.writeFaultLog(faultLogMirror);
  }
  function revokeActiveLedger(record) {
    record.closed = true;
    record.deactivateStarted = true;
    record.controller.abort(`skin "${record.entry.reg.id}" was unregistered while active (host-side disable/uninstall)`);
    for (const off of [...record.disposers].reverse()) {
      try {
        off();
      } catch (error) {
        logger.warn("slot disposer threw during ledger revocation", {
          skinId: record.entry.reg.id,
          error: describeError(error)
        });
      }
    }
    record.disposers.length = 0;
  }
  async function graceExpiry() {
    const window = grace;
    if (!window || window.settled) {
      return;
    }
    window.settled = true;
    grace = null;
    if (disposed || active !== window.record) {
      return;
    }
    switchEpoch++;
    await shutdownActive();
    const message = `active skin "${window.id}" was unregistered while active (host-side disable/uninstall); its loader-ledger registrations were revoked immediately and no compatible re-registration arrived within ${unregisterGraceMs}ms \u2014 fell back to default`;
    logger.warn(message);
    await appendFault({ at: timestamp(), skinId: window.id, kind: "active-unregistered", message });
    await persist(DEFAULT_SKIN_ID, []);
    notify();
  }
  function registerSkin(reg) {
    if (disposed) {
      throw new Error("ui-skin-loader runtime is shut down; cannot register skins");
    }
    if (typeof reg !== "object" || reg === null) {
      throw new TypeError("registerSkin expects a SkinRegistration object");
    }
    for (const field of ["apiVersion", "id", "name", "version"]) {
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
    const previous = discovered.get(reg.id);
    discovered.set(reg.id, {
      reg,
      token,
      incompatible,
      marks: previous?.marks ?? /* @__PURE__ */ new Set(),
      slots: Array.isArray(reg.slots) ? [...reg.slots] : void 0
    });
    if (!incompatible) {
      const wake = recoveryWaits.get(reg.id);
      if (wake) {
        recoveryWaits.delete(reg.id);
        wake(true);
      }
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
            skinId: reg.id
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
      incompatible: incompatible ?? null
    });
    notify();
    return () => {
      const current = discovered.get(reg.id);
      if (!current || current.token !== token) {
        return;
      }
      discovered.delete(reg.id);
      const activeRecord = active;
      if (activeRecord && activeRecord.entry.reg.id === reg.id) {
        revokeActiveLedger(activeRecord);
        grace = {
          id: reg.id,
          record: activeRecord,
          timer: timers.setTimeout(() => {
            void graceExpiry();
          }, unregisterGraceMs),
          settled: false
        };
        logger.info("active skin unregistered; ledger revoked, re-registration grace window started", {
          skinId: reg.id,
          graceMs: unregisterGraceMs
        });
      }
      logger.info("skin unregistered", { skinId: reg.id });
      notify();
    };
  }
  function createSkinContext(reg, signal, record) {
    function track(off) {
      if (record.closed) {
        try {
          off();
        } catch (error) {
          logger.warn("late slot registration after shutdown was disposed with an error", {
            skinId: reg.id,
            error: describeError(error)
          });
        }
        return () => void 0;
      }
      record.disposers.push(off);
      return off;
    }
    return {
      logger: createSkinLogger(reg.id),
      signal,
      slots: {
        register(componentOptions, component) {
          return track(adapter.slots.register(componentOptions, component));
        },
        inject(key, callback) {
          return track(adapter.slots.inject(key, callback));
        }
      }
    };
  }
  async function shutdownActive() {
    const record = active;
    active = null;
    aborter = null;
    if (!record) {
      return {};
    }
    const skinId = record.entry.reg.id;
    record.closed = true;
    const warnings = [];
    if (!record.deactivateStarted) {
      record.deactivateStarted = true;
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
    for (const off of [...record.disposers].reverse()) {
      try {
        off();
      } catch (error) {
        logger.warn("slot disposer threw during shutdown", {
          skinId,
          error: describeError(error)
        });
      }
    }
    record.disposers.length = 0;
    currentId = DEFAULT_SKIN_ID;
    notify();
    return { warning: warnings.length > 0 ? warnings.join("; ") : void 0 };
  }
  function joinWarnings(warnings) {
    return warnings.length > 0 ? warnings.join("; ") : void 0;
  }
  async function persist(id, warnings) {
    const accepted = await store.writeActiveSkin(id);
    if (!accepted) {
      const message = `failed to persist activeSkin="${id}" to host settings (namespace ${SETTINGS_NAMESPACE})`;
      warnings.push(message);
      logger.warn(message);
      await appendFault({ at: timestamp(), skinId: id, kind: "persist-failed", message });
    }
  }
  async function switchToInternal(target) {
    const epoch = ++switchEpoch;
    aborter?.abort(`switch superseded by a newer switch request (epoch ${epoch})`);
    aborter = null;
    const prior = inFlight?.settled ?? Promise.resolve();
    const promise = runSwitch(target, epoch, prior);
    const settled = promise.then(
      () => void 0,
      () => void 0
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
  async function runSwitch(target, epoch, prior) {
    await prior;
    const supersededResult = () => ({
      ok: false,
      error: `switch to "${target}" was superseded by a newer switch request`,
      rolledBackTo: currentId
    });
    const disposedResult = () => ({
      ok: false,
      error: "ui-skin-loader runtime is shut down",
      rolledBackTo: currentId
    });
    if (disposed) {
      return disposedResult();
    }
    if (epoch !== switchEpoch) {
      return supersededResult();
    }
    let entry;
    if (target !== DEFAULT_SKIN_ID) {
      entry = discovered.get(target);
      if (!entry) {
        return {
          ok: false,
          error: `skin "${target}" is not registered`,
          rolledBackTo: currentId
        };
      }
      if (entry.incompatible) {
        return {
          ok: false,
          error: `skin "${target}" is incompatible: ${entry.incompatible}`,
          rolledBackTo: currentId
        };
      }
    }
    if (target === currentId) {
      return {
        ok: false,
        error: target === DEFAULT_SKIN_ID ? "default (no skin) is already active" : `skin "${target}" is already active`,
        rolledBackTo: currentId
      };
    }
    const warnings = [];
    if (entry && (entry.marks.has("fault") || entry.marks.has("suspect-residue"))) {
      const marks = [...entry.marks].join("+");
      entry.marks.clear();
      notify();
      const message = `explicit switchTo cleared the "${marks}" isolation mark of skin "${target}" and retries activation`;
      logger.info(message);
      await appendFault({ at: timestamp(), skinId: target, kind: "explicit-retry", message });
    }
    if (active) {
      const outcome = await shutdownActive();
      if (outcome.warning) {
        warnings.push(outcome.warning);
      }
      if (disposed) {
        return disposedResult();
      }
      if (epoch !== switchEpoch) {
        await persist(DEFAULT_SKIN_ID, warnings);
        return { ...supersededResult(), warning: joinWarnings(warnings) };
      }
    }
    if (entry) {
      const targetEntry = entry;
      const controller2 = new AbortController();
      const record = {
        entry: targetEntry,
        controller: controller2,
        disposers: [],
        deactivateStarted: false,
        closed: false
      };
      active = record;
      aborter = controller2;
      const skinContext = createSkinContext(targetEntry.reg, controller2.signal, record);
      let activationPromise = null;
      const activation = () => activationPromise ??= Promise.resolve().then(
        () => targetEntry.reg.activate(skinContext)
      );
      const outcome = await raceTimeout(
        activation(),
        activateMs,
        timers,
        () => controller2.abort(`activation of skin "${target}" timed out after ${activateMs}ms`)
      );
      if (disposed) {
        controller2.abort("ui-skin-loader runtime is shutting down");
        await raceTimeout(activation(), 0, timers);
        return disposedResult();
      }
      if (epoch !== switchEpoch) {
        controller2.abort(`switch to "${target}" was superseded by a newer switch request`);
        await raceTimeout(activation(), 0, timers);
        const rolled = await shutdownActive();
        if (rolled.warning) {
          warnings.push(rolled.warning);
        }
        await persist(DEFAULT_SKIN_ID, warnings);
        return { ...supersededResult(), warning: joinWarnings(warnings) };
      }
      if (outcome.kind === "timeout") {
        controller2.abort(`activation of skin "${target}" timed out after ${activateMs}ms`);
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
          message: `${reason}; rolled back to default${rolled.warning ? `; ${rolled.warning}` : ""}`
        });
        await persist(DEFAULT_SKIN_ID, warnings);
        notify();
        return {
          ok: false,
          error: reason,
          warning: joinWarnings(warnings),
          rolledBackTo: DEFAULT_SKIN_ID
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
          message: `${reason}; rolled back to default${rolled.warning ? `; ${rolled.warning}` : ""}`
        });
        await persist(DEFAULT_SKIN_ID, warnings);
        notify();
        return {
          ok: false,
          error: reason,
          warning: joinWarnings(warnings),
          rolledBackTo: DEFAULT_SKIN_ID
        };
      }
      currentId = target;
      aborter = null;
      await persist(target, warnings);
      notify();
      const warning2 = joinWarnings(warnings);
      return warning2 === void 0 ? { ok: true } : { ok: true, warning: warning2 };
    }
    await persist(DEFAULT_SKIN_ID, warnings);
    notify();
    const warning = joinWarnings(warnings);
    return warning === void 0 ? { ok: true } : { ok: true, warning };
  }
  function waitForRegistration(id) {
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
  async function recover() {
    if (disposed || recoveryStarted) {
      return;
    }
    recoveryStarted = true;
    const read = await store.waitForReady(recoveryReadyMs);
    if (disposed) {
      return;
    }
    if (read.status === "unavailable") {
      logger.warn("startup recovery skipped: settings namespace unavailable", {
        namespace: SETTINGS_NAMESPACE
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
        persisted
      });
      return;
    }
    const registered = await waitForRegistration(persisted);
    if (disposed || userInteracted) {
      return;
    }
    const registeredEntry = discovered.get(persisted);
    if (!registered || !registeredEntry || registeredEntry.incompatible) {
      const message = `persisted activeSkin "${persisted}" was not re-registered at startup (or re-registered as incompatible); falling back to default`;
      logger.warn(message);
      await appendFault({
        at: timestamp(),
        skinId: persisted,
        kind: "recovery-unregistered",
        message
      });
      const accepted = await store.writeActiveSkin(DEFAULT_SKIN_ID);
      if (!accepted) {
        const persistMessage = `failed to rewrite persisted activeSkin to default after unregistered recovery`;
        await appendFault({
          at: timestamp(),
          skinId: persisted,
          kind: "persist-failed",
          message: persistMessage
        });
      }
      notify();
      return;
    }
    logger.info("startup recovery: replaying persisted skin", { skinId: persisted });
    const result = await switchToInternal(persisted);
    if (!result.ok) {
      await appendFault({
        at: timestamp(),
        skinId: persisted,
        kind: "recovery-failed",
        message: `recovery activation of "${persisted}" failed: ${result.error}`
      });
    } else if (result.warning) {
      logger.warn("startup recovery completed with warnings", {
        skinId: persisted,
        warning: result.warning
      });
    }
  }
  function onRemoteDocumentUpdated(args) {
    const namespace = args[0];
    if (typeof namespace === "string" && namespace !== SETTINGS_NAMESPACE) {
      return;
    }
    scheduleSyncCheck();
  }
  function scheduleSyncCheck() {
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
  async function syncCheck() {
    if (disposed) {
      pendingSyncCheck = false;
      return;
    }
    if (inFlight) {
      return;
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
      to: persisted
    });
    const result = await switchToInternal(persisted);
    if (!result.ok) {
      logger.debug("cross-tab replay finished with error", { error: result.error });
    }
  }
  function stop() {
    if (stopPromise) {
      return stopPromise;
    }
    disposed = true;
    stopPromise = (async () => {
      switchEpoch++;
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
      syncOff?.();
      syncOff = null;
      syncFormOff?.();
      syncFormOff = null;
      pendingSyncCheck = false;
      if (inFlight) {
        await inFlight.settled;
      }
      active?.controller.abort("ui-skin-loader runtime is shutting down");
      const outcome = await shutdownActive();
      if (outcome.warning) {
        logger.warn("skin shutdown finished with warnings", { warning: outcome.warning });
      }
      subscribers.clear();
    })();
    return stopPromise;
  }
  function list() {
    return [...discovered.values()].map((entry) => ({
      id: entry.reg.id,
      name: entry.reg.name,
      version: entry.reg.version,
      ...entry.reg.author === void 0 ? {} : { author: entry.reg.author },
      ...entry.reg.description === void 0 ? {} : { description: entry.reg.description },
      ...entry.reg.tags === void 0 ? {} : { tags: [...entry.reg.tags] },
      ...entry.reg.preview === void 0 ? {} : { preview: entry.reg.preview },
      ...entry.reg.settingsHint === void 0 ? {} : { settingsHint: entry.reg.settingsHint },
      ...entry.slots === void 0 ? {} : { slots: entry.slots.map((slot) => ({ ...slot })) },
      status: entry.marks.has("suspect-residue") ? "suspect-residue" : entry.marks.has("fault") ? "fault" : entry.reg.id === currentId ? "active" : "discovered",
      ...entry.incompatible === void 0 ? {} : { incompatible: entry.incompatible }
    }));
  }
  const runtime = {
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
    }
  };
  const controller = {
    expose() {
      const service = {
        ...runtime,
        registerSkin
      };
      return Object.freeze(service);
    },
    start() {
      if (lifecycleStarted) {
        throw new Error("ui-skin-loader runtime lifecycle already started");
      }
      lifecycleStarted = true;
      syncOff = adapter.remote.$on(
        DOCUMENT_UPDATED_EVENT,
        (...args) => onRemoteDocumentUpdated(args)
      );
      syncFormOff = store.onChange(() => scheduleSyncCheck());
      void recover();
      return () => stop();
    }
  };
  return controller;
}

// src/client/wiring.ts
var CLIENT_INJECT = ["slots", "configForms", "remote", "theme", "locale"];
function applyClient(ctx, deps) {
  const adapter = createDsh017Adapter(ctx);
  const runtime = createSkinRuntime({
    adapter,
    logger: createConsoleLogger("ui-skin-loader")
  });
  const service = runtime.expose();
  ctx.provide(SERVICE_NAME, service);
  ctx.effect(() => runtime.start(), "ui-skin-loader: skin runtime lifecycle");
  const consoleController = deps.createConsoleController({ adapter, runtime: service });
  ctx.effect(() => consoleController.start(), "ui-skin-loader: console mounting");
}

// src/client/index.ts
var inject = CLIENT_INJECT;
function apply(ctx) {
  applyClient(ctx, { createConsoleController });
}

    return module.exports;
  },
});

