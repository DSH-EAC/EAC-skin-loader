/**
 * 固定版本皮肤制品清单（docs/git-distribution.md §3.3）。
 *
 * 清单由发布管线从真实构建产物生成（tools/generate-skin-manifest.mjs，Phase 4）并随包提交，
 * 补齐器在运行期只读它——**不运行时追最新版**（计划 §三.2「首版锁定一个经过验证的发布集合」）。
 *
 * 校验纪律（计划 §四.2「缺少必要校验信息直接拒绝」）：本模块是 fail-closed 的唯一闸口——
 * manifestVersion / 包名 / 皮肤 id / URL / SHA256 / 字节数任一非法即整份清单拒绝，
 * 补齐器据此进入「清单不可用」状态并如实上报，绝不降级为「跳过坏条目继续装其余」。
 */

/** 皮肤 id 正则（与 protocol.ts / 公约 §3 同一形态；此处独立声明避免 host 半引入 client 面）。 */
const SKIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** npm 包名（scope 可选）；补齐器用它派生缓存文件名，字符集必须可安全入路径。 */
const PACKAGE_NAME_PATTERN = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$|^@[a-z0-9][a-z0-9._-]*$/;

/** 十六进制 SHA256（小写）。 */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** 清单结构版本（不兼容变更时 bump，旧补齐器拒绝新清单）。 */
export const SKINS_MANIFEST_VERSION = 1;

/** 清单里的一条皮肤制品。 */
export interface SkinArtifact {
  /** npm 包名（== 安装后的 bundle 名）。 */
  name: string;
  /** 制品版本（与包内 package.json / dsh.skin.version 一致）。 */
  version: string;
  /** 公约皮肤 id（控制台展示用）。 */
  skinId: string;
  /** 制品下载地址（发布资产）。 */
  url: string;
  /** 制品 SHA256（小写十六进制）。 */
  sha256: string;
  /** 制品字节数。 */
  bytes: number;
  /** 该制品声明的宿主兼容范围（透传展示，安装期闸门由宿主强制）。 */
  dshPeerRange: string;
}

/** 固定版本皮肤制品清单。 */
export interface SkinsManifest {
  manifestVersion: number;
  /** 生成时间（ISO 8601，展示用）。 */
  generatedAt: string;
  /** 发布集合标识（与加载器版本对应，计划 §四.4）。 */
  releaseSet: string;
  skins: SkinArtifact[];
  /**
   * 允许非 https 下载地址。**仅供隔离验证的本地清单使用**（file/http 回环）；
   * 发布管线生成的清单不得置位。
   */
  allowInsecureUrl?: boolean;
}

export type ManifestParseResult =
  | { ok: true; manifest: SkinsManifest }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析并整份校验清单；任何非法字段 → 整份拒绝（fail-closed）。 */
export function parseSkinsManifest(raw: unknown): ManifestParseResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "skin manifest must be a JSON object" };
  }
  const manifestVersion = raw.manifestVersion;
  if (manifestVersion !== SKINS_MANIFEST_VERSION) {
    return {
      ok: false,
      error: `skin manifest version ${String(manifestVersion)} is not supported (expected ${SKINS_MANIFEST_VERSION})`,
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
  const skins: SkinArtifact[] = [];
  const seenNames = new Set<string>();
  const seenSkinIds = new Set<string>();
  for (const [index, entry] of raw.skins.entries()) {
    const label = `skins[${index}]`;
    if (!isPlainObject(entry)) {
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
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `${label}.url is not an absolute URL` };
    }
    if (parsed.protocol !== "https:" && !(allowInsecureUrl && parsed.protocol === "http:")) {
      return {
        ok: false,
        error: `${label}.url must be https (allowInsecureUrl is ${allowInsecureUrl ? "on" : "off"})`,
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
      ...(allowInsecureUrl ? { allowInsecureUrl } : {}),
    },
  };
}

/**
 * 从补齐器所在包目录读取并解析 skin-manifest.json。
 * 路径以 lib/index.js 的 import.meta.url 为锚（lib/../skin-manifest.json），
 * 与发布管线写入位置一致；读不到 / 解析失败 → fail-closed。
 */
export async function loadSkinsManifest(manifestUrl: URL | string): Promise<ManifestParseResult> {
  const { readFile } = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await readFile(manifestUrl, "utf8");
  } catch (error) {
    return { ok: false, error: `skin manifest unreadable: ${String(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `skin manifest is not valid JSON: ${String(error)}` };
  }
  return parseSkinsManifest(parsed);
}
