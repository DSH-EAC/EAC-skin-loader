// src/adapter/dsh-0.1.7-host.ts
import z from "@deepseek-ai/schemastery";

// src/protocol.ts
var CONVENTION_ID = "dsh.ecosystem.ui-skin-loader/v1";
var SERVICE_NAME = "uiSkinLoader";
var SETTINGS_NAMESPACE = "dsh-ui-skin-loader";
var LOADER_SLOT_PREFIX = "io.github.dsh-eac.skin.loader.";
var DEFAULT_SKIN_ID = "default";

// src/adapter/dsh-0.1.7-host.ts
function createLoaderConfigSchema() {
  return z.object({
    activeSkin: z.string().default(DEFAULT_SKIN_ID).volatile(),
    faultLog: z.array(
      z.object({
        at: z.string(),
        skinId: z.string(),
        kind: z.string(),
        message: z.string()
      })
    ).default([]).volatile(),
    diagnosticsEnabled: z.boolean().default(false).volatile(),
    // ---- 皮肤自动补齐（docs/git-distribution.md §3.5）----
    // autoProvision：用户开关（client 半控制台写）；false = 补齐器不发起新任务。
    autoProvision: z.boolean().default(true).volatile(),
    // provisioning：补齐任务状态（host 半补齐器独占写）；自由结构（host/provisioning-state.ts
    // 的 normalizeProvisioningState 负责防御性归一化），schema 只声明「任意对象」。
    provisioning: z.dict(z.any()).default({}).volatile(),
    // provisionCommand：client 半 → host 半的一次性指令（retry 等）；补齐器消费后清除。
    provisionCommand: z.dict(z.any()).default({}).volatile()
  });
}

// src/host/provisioner.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

// src/host/provisioning-state.ts
var PROVISIONING_STATE_VERSION = 1;
function emptyProvisioningState(releaseSet) {
  return { version: PROVISIONING_STATE_VERSION, releaseSet, items: {} };
}
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
function readProvisioningState(settingsValue) {
  if (!isPlainObject(settingsValue)) return null;
  return normalizeProvisioningState(settingsValue.provisioning);
}
function toSettingsPatch(state) {
  return { provisioning: state };
}

// src/host/provisioner.ts
var DEFAULT_POLL_INTERVAL_MS = 3e4;
var DEFAULT_DOWNLOAD_TIMEOUT_MS = 6e4;
var DEFAULT_MAX_TOTAL_ATTEMPTS = 5;
var PROVISIONING_START_GUARD_MS = 3e4;
var CACHE_DIR_NAME = "dsh-ui-skin-loader-cache";
var STATE_WRITE_TIMEOUT_MS = 1e4;
var activeProvisioner = null;
function cacheKeyFor(name, version) {
  const raw = `${name}-${version}`;
  const sanitized = raw.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "-");
  if (sanitized.length === 0 || !/^[A-Za-z0-9._-]+$/.test(sanitized)) {
    throw new Error(`skin package "${name}" cannot be mapped to a safe cache filename`);
  }
  return sanitized;
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readNamespaceSnapshot(settings, namespace) {
  for (const descriptor of settings.describe()) {
    if (descriptor.ns === namespace) {
      return { value: descriptor.value, revision: descriptor.revision };
    }
  }
  return null;
}
function createSkinProvisioner(options) {
  const { manifest, pluginManager, settings, logger } = options;
  const namespace = options.namespace ?? SETTINGS_NAMESPACE;
  const timers = options.timers ?? defaultTimers;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? (() => Date.now());
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const maxTotalAttempts = options.maxTotalAttempts ?? DEFAULT_MAX_TOTAL_ATTEMPTS;
  const timestamp = () => new Date(now()).toISOString();
  const cacheDirPath = options.cacheDir ? fileURLToPath(options.cacheDir) : join(tmpdir(), CACHE_DIR_NAME);
  let disposed = false;
  let running = false;
  let pollHandle = null;
  let lastSeenRevision = -1;
  async function persist(state) {
    try {
      const outcome = await raceTimeout(
        settings.update(namespace, toSettingsPatch(state)),
        STATE_WRITE_TIMEOUT_MS,
        timers
      );
      if (outcome.kind === "timeout") {
        logger.warn("provisioning state write timed out", { namespace });
      } else if (outcome.kind === "rejected") {
        logger.warn("provisioning state write failed", {
          namespace,
          error: describeFailure(outcome.error)
        });
      }
    } catch (error) {
      logger.warn("provisioning state write threw", { namespace, error: describeFailure(error) });
    }
  }
  async function downloadVerified(artifact) {
    const key = cacheKeyFor(artifact.name, artifact.version);
    const finalPath = join(cacheDirPath, `${key}.tgz`);
    const partPath = `${finalPath}.part`;
    try {
      const existing = await stat(finalPath);
      if (existing.isFile() && existing.size === artifact.bytes) {
        const bytes = await readFile(finalPath);
        if (sha256Hex(bytes) === artifact.sha256) {
          logger.debug("skin artifact cache hit", { name: artifact.name, version: artifact.version });
          return finalPath;
        }
      }
    } catch {
    }
    await mkdir(cacheDirPath, { recursive: true });
    const controller = new AbortController();
    const timeout = timers.setTimeout(
      () => controller.abort(`download timed out after ${downloadTimeoutMs}ms`),
      downloadTimeoutMs
    );
    try {
      const response = await fetchImpl(artifact.url, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) {
        throw new Error(`download failed with HTTP ${response.status} for ${artifact.name}@${artifact.version}`);
      }
      const declared = response.headers.get("content-length");
      if (declared !== null && Number(declared) !== artifact.bytes) {
        throw new Error(
          `download content-length ${declared} does not match manifest bytes ${artifact.bytes} for ${artifact.name}@${artifact.version}`
        );
      }
      if (response.body === null) {
        throw new Error(`download returned an empty body for ${artifact.name}@${artifact.version}`);
      }
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > artifact.bytes) {
            throw new Error(
              `download exceeded manifest bytes for ${artifact.name}@${artifact.version} (got >${artifact.bytes})`
            );
          }
          chunks.push(value);
        }
      }
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (total !== artifact.bytes) {
        throw new Error(
          `download byte count ${total} does not match manifest bytes ${artifact.bytes} for ${artifact.name}@${artifact.version}`
        );
      }
      const digest = sha256Hex(body);
      if (digest !== artifact.sha256) {
        throw new Error(
          `download sha256 mismatch for ${artifact.name}@${artifact.version} (got ${digest}, expected ${artifact.sha256})`
        );
      }
      await writeFile(partPath, body);
      await rename(partPath, finalPath);
      logger.info("skin artifact downloaded and verified", {
        name: artifact.name,
        version: artifact.version,
        bytes: artifact.bytes
      });
      return finalPath;
    } finally {
      timers.clearTimeout(timeout);
    }
  }
  async function listInstalledBundles() {
    const bundles = await pluginManager.listBundles();
    const map = /* @__PURE__ */ new Map();
    for (const bundle of bundles) {
      map.set(bundle.name, {
        installed: bundle.installed === true,
        version: typeof bundle.version === "string" ? bundle.version : void 0,
        enabled: bundle.enabled === true
      });
    }
    return map;
  }
  async function runCycle() {
    if (disposed || running) return;
    running = true;
    try {
      const snapshot = readNamespaceSnapshot(settings, namespace);
      if (!snapshot || !isPlainObject2(snapshot.value)) return;
      const autoProvision = snapshot.value.autoProvision !== false;
      const command = isPlainObject2(snapshot.value.provisionCommand) ? snapshot.value.provisionCommand : null;
      let state = readProvisioningState(snapshot.value) ?? emptyProvisioningState(manifest.releaseSet);
      if (state.releaseSet !== manifest.releaseSet) {
        const carried = Object.entries(state.items).filter(([, item]) => item.status === "excluded");
        state = emptyProvisioningState(manifest.releaseSet);
        for (const [name, item] of carried) state.items[name] = item;
      }
      let stateDirty = false;
      let explicitRetry = false;
      if (command && command.kind === "retry") {
        explicitRetry = true;
        for (const item of Object.values(state.items)) {
          if (item.status === "failed") {
            item.status = "pending";
            item.attempts = 0;
            delete item.error;
            item.updatedAt = timestamp();
            stateDirty = true;
          }
        }
      }
      if (command !== null) {
        await raceTimeout(
          settings.update(namespace, { provisionCommand: {} }),
          STATE_WRITE_TIMEOUT_MS,
          timers
        );
      }
      if (!autoProvision && !explicitRetry) {
        if (stateDirty) await persist(state);
        return;
      }
      let bundles;
      try {
        bundles = await listInstalledBundles();
      } catch (error) {
        logger.warn("provisioner could not list host bundles", { error: describeFailure(error) });
        return;
      }
      const pending = [];
      for (const artifact of manifest.skins) {
        const bundle = bundles.get(artifact.name);
        const existing = state.items[artifact.name];
        const item = existing ?? {
          status: "pending",
          targetVersion: artifact.version,
          attempts: 0,
          updatedAt: timestamp()
        };
        if (item.status === "excluded") {
          state.items[artifact.name] = item;
          continue;
        }
        if (!bundle || !bundle.installed) {
          if (item.status === "installed" || item.status === "present") {
            item.status = "excluded";
            item.updatedAt = timestamp();
            delete item.installedVersion;
            state.items[artifact.name] = item;
            stateDirty = true;
            logger.info("skin was removed by the user after provisioning; excluded from auto-provision", {
              name: artifact.name
            });
            continue;
          }
          const canAttempt = item.attempts < maxTotalAttempts;
          if (canAttempt && item.status !== "pending") {
            item.status = "pending";
            item.updatedAt = timestamp();
            stateDirty = true;
          }
          item.targetVersion = artifact.version;
          state.items[artifact.name] = item;
          if (canAttempt) pending.push(artifact);
          continue;
        }
        if (bundle.version === artifact.version) {
          if (item.status !== "installed" || item.installedVersion !== bundle.version) {
            item.status = "installed";
            item.installedVersion = bundle.version;
            delete item.error;
            item.updatedAt = timestamp();
            state.items[artifact.name] = item;
            stateDirty = true;
          }
          continue;
        }
        if (item.status !== "present" || item.installedVersion !== bundle.version) {
          item.status = "present";
          item.installedVersion = bundle.version;
          item.updatedAt = timestamp();
          state.items[artifact.name] = item;
          stateDirty = true;
          logger.info("host already has a different version of a skin; leaving it untouched", {
            name: artifact.name,
            manifestVersion: artifact.version,
            hostVersion: bundle.version ?? null
          });
        }
      }
      if (Object.keys(state.items).length > 0 && state.startedAt === void 0) {
        state.startedAt = timestamp();
        stateDirty = true;
      }
      if (stateDirty) await persist(state);
      let progressed = false;
      for (const artifact of pending) {
        if (disposed) break;
        const current = readNamespaceSnapshot(settings, namespace);
        if (current && isPlainObject2(current.value) && current.value.autoProvision === false) {
          logger.info("auto-provision disabled mid-run; stopping", {});
          break;
        }
        const item = state.items[artifact.name];
        if (!item || item.status !== "pending") continue;
        item.status = "installing";
        item.attempts += 1;
        item.updatedAt = timestamp();
        await persist(state);
        try {
          const cachedPath = await downloadVerified(artifact);
          await pluginManager.installBundle(cachedPath, {
            requestId: `ui-skin-loader-provision-${artifact.name}-${now()}`
          });
          const after = await listInstalledBundles();
          const installed = after.get(artifact.name);
          if (!installed || !installed.installed) {
            throw new Error(`install reported success but "${artifact.name}" is not installed per the host`);
          }
          item.status = "installed";
          item.installedVersion = installed.version ?? artifact.version;
          delete item.error;
          logger.info("skin provisioned", { name: artifact.name, version: item.installedVersion });
        } catch (error) {
          const message = describeFailure(error);
          item.status = "failed";
          item.error = message;
          logger.error("skin provisioning failed", { name: artifact.name, error: message });
        }
        item.updatedAt = timestamp();
        state.items[artifact.name] = item;
        await persist(state);
        progressed = true;
      }
      const items = Object.values(state.items);
      const unfinished = items.some((item) => item.status === "pending" || item.status === "installing");
      if (!unfinished && items.length > 0 && progressed) {
        state.completedAt = timestamp();
        await persist(state);
      }
    } catch (error) {
      logger.error("provisioning cycle threw", { error: describeFailure(error) });
    } finally {
      running = false;
    }
  }
  function poll() {
    if (disposed) return;
    const snapshot = readNamespaceSnapshot(settings, namespace);
    if (!snapshot) return;
    if (snapshot.revision === lastSeenRevision) return;
    lastSeenRevision = snapshot.revision;
    void runCycle();
  }
  return {
    start() {
      if (activeProvisioner) {
        return () => void 0;
      }
      const self = { started: true };
      activeProvisioner = self;
      const firstRun = timers.setTimeout(() => {
        void runCycle();
      }, 0);
      if (timers.setInterval && timers.clearInterval) {
        pollHandle = timers.setInterval(poll, pollIntervalMs);
      }
      return () => {
        timers.clearTimeout(firstRun);
        if (pollHandle !== null) {
          timers.clearInterval?.(pollHandle);
          pollHandle = null;
        }
        disposed = true;
        if (activeProvisioner === self) activeProvisioner = null;
      };
    },
    runOnce: runCycle
  };
}
function describeFailure(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// src/host/skins-manifest.ts
var SKIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
var PACKAGE_NAME_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$|^@[a-z0-9][a-z0-9._-]*$/;
var SHA256_PATTERN = /^[0-9a-f]{64}$/;
var SKINS_MANIFEST_VERSION = 1;
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseSkinsManifest(raw) {
  if (!isPlainObject3(raw)) {
    return { ok: false, error: "skin manifest must be a JSON object" };
  }
  const manifestVersion = raw.manifestVersion;
  if (manifestVersion !== SKINS_MANIFEST_VERSION) {
    return {
      ok: false,
      error: `skin manifest version ${String(manifestVersion)} is not supported (expected ${SKINS_MANIFEST_VERSION})`
    };
  }
  if (typeof raw.generatedAt !== "string" || raw.generatedAt.length === 0) {
    return { ok: false, error: "skin manifest generatedAt must be a non-empty string" };
  }
  if (typeof raw.releaseSet !== "string" || raw.releaseSet.length === 0) {
    return { ok: false, error: "skin manifest releaseSet must be a non-empty string" };
  }
  if (!Array.isArray(raw.skins) || raw.skins.length === 0) {
    return { ok: false, error: "skin manifest skins must be a non-empty array" };
  }
  const allowInsecureUrl = raw.allowInsecureUrl === true;
  const skins = [];
  const seenNames = /* @__PURE__ */ new Set();
  const seenSkinIds = /* @__PURE__ */ new Set();
  for (const [index, entry] of raw.skins.entries()) {
    const label = `skins[${index}]`;
    if (!isPlainObject3(entry)) {
      return { ok: false, error: `${label} must be an object` };
    }
    const name = entry.name;
    if (typeof name !== "string" || !PACKAGE_NAME_PATTERN.test(name)) {
      return { ok: false, error: `${label}.name is not a valid package name` };
    }
    if (seenNames.has(name)) {
      return { ok: false, error: `${label}.name "${name}" is duplicated` };
    }
    seenNames.add(name);
    const version = entry.version;
    if (typeof version !== "string" || version.length === 0) {
      return { ok: false, error: `${label}.version must be a non-empty string` };
    }
    const skinId = entry.skinId;
    if (typeof skinId !== "string" || !SKIN_ID_PATTERN.test(skinId)) {
      return { ok: false, error: `${label}.skinId is not a valid covenant skin id` };
    }
    if (seenSkinIds.has(skinId)) {
      return { ok: false, error: `${label}.skinId "${skinId}" is duplicated` };
    }
    seenSkinIds.add(skinId);
    const url = entry.url;
    if (typeof url !== "string" || url.length === 0) {
      return { ok: false, error: `${label}.url must be a non-empty string` };
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `${label}.url is not an absolute URL` };
    }
    if (parsed.protocol !== "https:" && !(allowInsecureUrl && parsed.protocol === "http:")) {
      return {
        ok: false,
        error: `${label}.url must be https (allowInsecureUrl is ${allowInsecureUrl ? "on" : "off"})`
      };
    }
    const sha256 = entry.sha256;
    if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
      return { ok: false, error: `${label}.sha256 must be 64 lowercase hex chars` };
    }
    const bytes = entry.bytes;
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) {
      return { ok: false, error: `${label}.bytes must be a positive integer` };
    }
    const dshPeerRange = entry.dshPeerRange;
    if (typeof dshPeerRange !== "string" || dshPeerRange.length === 0) {
      return { ok: false, error: `${label}.dshPeerRange must be a non-empty string` };
    }
    skins.push({ name, version, skinId, url, sha256, bytes, dshPeerRange });
  }
  return {
    ok: true,
    manifest: {
      manifestVersion: SKINS_MANIFEST_VERSION,
      generatedAt: raw.generatedAt,
      releaseSet: raw.releaseSet,
      skins,
      ...allowInsecureUrl ? { allowInsecureUrl } : {}
    }
  };
}
async function loadSkinsManifest(manifestUrl) {
  const { readFile: readFile2 } = await import("node:fs/promises");
  let raw;
  try {
    raw = await readFile2(manifestUrl, "utf8");
  } catch (error) {
    return { ok: false, error: `skin manifest unreadable: ${String(error)}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `skin manifest is not valid JSON: ${String(error)}` };
  }
  return parseSkinsManifest(parsed);
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

// src/index.ts
var Config = createLoaderConfigSchema();
var SKINS_MANIFEST_URL = new URL("../skin-manifest.json", import.meta.url);
function apply(ctx) {
  let provisioningStarted = false;
  ctx.inject(["settings"], (child) => {
    child.effect(
      () => child.settings.configure({ auto: false }, ctx.fiber),
      "ui-skin-loader: settings page policy"
    );
    child.effect(
      () => {
        const handle = setTimeout(() => {
          if (!provisioningStarted) {
            console.warn(
              `[ui-skin-loader] skin provisioning inactive: host pluginManager service did not become available within ${PROVISIONING_START_GUARD_MS}ms`
            );
          }
        }, PROVISIONING_START_GUARD_MS);
        return () => clearTimeout(handle);
      },
      "ui-skin-loader: provisioning availability guard"
    );
  });
  ctx.inject(["settings", "pluginManager"], (child) => {
    const manager = child.pluginManager;
    if (!manager) return;
    child.effect(
      () => {
        let disposer = null;
        void loadSkinsManifest(SKINS_MANIFEST_URL).then((parsed) => {
          if (!parsed.ok) {
            console.error(`[ui-skin-loader] skin provisioning disabled: ${parsed.error}`);
            return;
          }
          provisioningStarted = true;
          disposer = createSkinProvisioner({
            manifest: parsed.manifest,
            pluginManager: manager,
            settings: child.settings,
            logger: createConsoleLogger("ui-skin-loader:provisioner")
          }).start();
        });
        return () => {
          disposer?.();
        };
      },
      "ui-skin-loader: skin provisioning lifecycle"
    );
  });
}
export {
  CONVENTION_ID,
  Config,
  LOADER_SLOT_PREFIX,
  SERVICE_NAME,
  SETTINGS_NAMESPACE,
  apply,
  createLoaderConfigSchema
};
