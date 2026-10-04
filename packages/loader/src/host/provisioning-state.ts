/**
 * 皮肤补齐任务状态（docs/git-distribution.md §3.5）。
 *
 * 持久化位置：加载器自有 settings 命名空间 `dsh-ui-skin-loader` 的 `provisioning`
 * volatile 字段（host Config schema 扩展）。**激活事实（activeSkin）与补齐状态严格分开**：
 * activeSkin 仍只由 client 半运行时写（公约 R6 镜像），provisioning 只由 host 半补齐器写，
 * 二者互不触碰对方的字段（settings.update 是按字段合并）。
 *
 * 状态语义（计划 §四.3 必须区分的六态）：
 * - pending    待安装（本轮会尝试）
 * - installing 安装中（崩溃/reload 恢复时重置回 pending——安装器以宿主实际状态为准）
 * - installed  安装成功（经 listBundles 复核）
 * - failed     安装失败（可重试；error 如实保留）
 * - present    宿主已有不同版本（不覆盖，展示差异）
 * - excluded   用户在补齐成功后卸载 / 明确排除（不再自动补回）
 */

import { describeError } from "../client/runtime/persistence.ts";

/** 状态结构版本（不兼容变更时 bump）。 */
export const PROVISIONING_STATE_VERSION = 1;

/** 单个皮肤制品的补齐状态。 */
export interface ProvisioningItemState {
  status:
    | "pending"
    | "installing"
    | "installed"
    | "failed"
    | "present"
    | "excluded";
  /** 清单目标版本。 */
  targetVersion: string;
  /** 实际安装/在宿主的版本（复核或版本差异时填）。 */
  installedVersion?: string;
  /** 本轮已尝试次数（有界重试）。 */
  attempts: number;
  /** 最近一次失败原因（如实展示，不自动绕过）。 */
  error?: string;
  /** 最近一次状态变更（ISO 8601）。 */
  updatedAt: string;
}

/** 补齐任务持久化状态。 */
export interface ProvisioningState {
  version: number;
  /** 用户开关（与 provisioning 分离：autoProvision 由 client 半写，本对象由 host 半写）。 */
  releaseSet: string;
  startedAt?: string;
  completedAt?: string;
  items: Record<string, ProvisioningItemState>;
}

/** 归一化空状态。 */
export function emptyProvisioningState(releaseSet: string): ProvisioningState {
  return { version: PROVISIONING_STATE_VERSION, releaseSet, items: {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const STATUSES: ProvisioningItemState["status"][] = [
  "pending",
  "installing",
  "installed",
  "failed",
  "present",
  "excluded",
];

/**
 * 防御性归一化：settings 里读到的值可能来自旧版本/被手工改动/损坏。
 * 归一化失败的字段丢弃、条目丢弃——绝不因为状态损坏让补齐器崩溃（网络失败同纪律）。
 */
export function normalizeProvisioningState(raw: unknown): ProvisioningState | null {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== PROVISIONING_STATE_VERSION) return null;
  if (typeof raw.releaseSet !== "string" || raw.releaseSet.length === 0) return null;
  if (!isPlainObject(raw.items)) return null;
  const items: Record<string, ProvisioningItemState> = {};
  for (const [name, entry] of Object.entries(raw.items)) {
    if (!isPlainObject(entry)) continue;
    const status = STATUSES.find((s) => s === entry.status);
    if (status === undefined) continue;
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
      ...(typeof entry.installedVersion === "string" && entry.installedVersion.length > 0
        ? { installedVersion: entry.installedVersion }
        : {}),
      ...(typeof entry.error === "string" && entry.error.length > 0 ? { error: entry.error } : {}),
    };
  }
  const state: ProvisioningState = { version: PROVISIONING_STATE_VERSION, releaseSet: raw.releaseSet, items };
  if (typeof raw.startedAt === "string" && raw.startedAt.length > 0) state.startedAt = raw.startedAt;
  if (typeof raw.completedAt === "string" && raw.completedAt.length > 0) state.completedAt = raw.completedAt;
  return state;
}

/** 读取 settings 值里的 provisioning 段（缺失/损坏 → null）。 */
export function readProvisioningState(settingsValue: unknown): ProvisioningState | null {
  if (!isPlainObject(settingsValue)) return null;
  return normalizeProvisioningState(settingsValue.provisioning);
}

/** 状态 → settings patch（update 按字段合并，整段替换 provisioning）。 */
export function toSettingsPatch(state: ProvisioningState): Record<string, unknown> {
  return { provisioning: state };
}

/** 错误 → 可读消息（复用 client 半的 describeError，避免重复实现）。 */
export function describeProvisioningError(error: unknown): string {
  return describeError(error);
}
