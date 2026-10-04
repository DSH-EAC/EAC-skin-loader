/**
 * 皮肤补齐状态的 client 侧投影（docs/git-distribution.md §3.5，计划 §三.4「最小状态界面」）。
 *
 * 职责边界：client 半只**读** host settings 命名空间里的 `provisioning` 段（host 半补齐器写）、
 * **写** `autoProvision`（开关）与 `provisionCommand`（一次性 retry 指令）。它不安装、不下载、
 * 不切换皮肤——安装能力在 host 半，切换裁决在 client 半运行时（公约 §4.1）。
 *
 * 纯 TS、零 React、零 DOM——node --test 可驱动（快照投影 / 订阅 / 写路径）。
 * 状态归一化复用 host/provisioning-state.ts（同一套防御性语义，控制台不自行解释）。
 */

import { SETTINGS_NAMESPACE } from "../../protocol.ts";
import type { DshAdapter, DshSettingsForm } from "../../adapter/types.ts";
import type { Disposer } from "../../protocol.ts";
import { normalizeProvisioningState, type ProvisioningState } from "../../host/provisioning-state.ts";

/** 控制台展示的单条补齐状态（host 状态的投影，附清单元数据由 host 状态自带）。 */
export interface ProvisioningItemView {
  name: string;
  status: ProvisioningState["items"][string]["status"];
  targetVersion: string;
  installedVersion?: string;
  error?: string;
  attempts: number;
  updatedAt: string;
}

/** 控制台展示的补齐总览。 */
export interface ProvisioningView {
  /** host 是否已在跑补齐（状态段存在）。 */
  available: boolean;
  /** 用户开关（autoProvision 字段；host 未挂载时 true 由 host 缺省承担）。 */
  enabled: boolean;
  releaseSet: string | null;
  items: ProvisioningItemView[];
  /** 汇总计数（控制台标题行用）。 */
  counts: { installed: number; failed: number; pending: number; present: number; excluded: number; installing: number };
}

export const EMPTY_PROVISIONING_VIEW: ProvisioningView = {
  available: false,
  enabled: true,
  releaseSet: null,
  items: [],
  counts: { installed: 0, failed: 0, pending: 0, present: 0, excluded: 0, installing: 0 },
};

/** 由 settings 快照值投影控制台视图（防御性：host 段缺失/损坏 → available:false）。 */
export function projectProvisioningView(
  settingsValue: unknown,
): ProvisioningView {
  const value = (settingsValue ?? {}) as Record<string, unknown>;
  const state = normalizeProvisioningState(value.provisioning);
  const enabled = value.autoProvision !== false;
  if (!state) {
    return { ...EMPTY_PROVISIONING_VIEW, enabled };
  }
  const items: ProvisioningItemView[] = Object.entries(state.items).map(([name, item]) => ({
    name,
    status: item.status,
    targetVersion: item.targetVersion,
    ...(item.installedVersion !== undefined ? { installedVersion: item.installedVersion } : {}),
    ...(item.error !== undefined ? { error: item.error } : {}),
    attempts: item.attempts,
    updatedAt: item.updatedAt,
  }));
  items.sort((a, b) => a.name.localeCompare(b.name));
  const counts = { installed: 0, failed: 0, pending: 0, present: 0, excluded: 0, installing: 0 };
  for (const item of items) counts[item.status] += 1;
  return {
    available: true,
    enabled,
    releaseSet: state.releaseSet,
    items,
    counts,
  };
}

/**
 * 控制台的补齐投影面：可快照订阅（uSES）+ 开关/retry 写路径。
 * 一个 runtime 实例持有一个 form 投影（adapter.settings.get 每次返回独立包装）。
 */
export interface ProvisioningFacade {
  snapshot(): ProvisioningView;
  subscribe(listener: () => void): Disposer;
  /** 写 autoProvision 开关；被拒/抛错返回 false（host 是唯一裁决者）。 */
  setEnabled(next: boolean): Promise<boolean>;
  /** 请求重试全部失败项（一次性指令）；被拒/抛错返回 false。 */
  requestRetry(): Promise<boolean>;
}

export function createProvisioningFacade(adapter: DshAdapter): ProvisioningFacade {
  const form: DshSettingsForm<Record<string, unknown>> = adapter.settings.get(SETTINGS_NAMESPACE);
  const listeners = new Set<() => void>();
  const projectionCache = new WeakMap<object, ProvisioningView>();
  let unsubscribe: Disposer | null = null;

  const ensureSubscribed = (): void => {
    if (unsubscribe !== null) return;
    unsubscribe = form.subscribe(() => {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // 单个订阅者异常不阻断广播。
        }
      }
    });
  };

  return {
    snapshot(): ProvisioningView {
      const snapshot = form.get();
      if (snapshot.status !== "ready") {
        return { ...EMPTY_PROVISIONING_VIEW };
      }
      const cached = projectionCache.get(snapshot as unknown as object);
      if (cached) return cached;
      const view = projectProvisioningView(snapshot.value);
      projectionCache.set(snapshot as unknown as object, view);
      return view;
    },
    subscribe(listener: () => void): Disposer {
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
    async setEnabled(next: boolean): Promise<boolean> {
      try {
        return (await form.set("autoProvision", next)) === true;
      } catch {
        return false;
      }
    },
    async requestRetry(): Promise<boolean> {
      try {
        const command = { kind: "retry", at: new Date().toISOString() };
        return (await form.set("provisionCommand", command)) === true;
      } catch {
        return false;
      }
    },
  };
}

/** 状态 → 控制台文案键（zh/en 双语在 messages.ts）。 */
export function provisioningStatusMessageKey(status: ProvisioningItemView["status"]): string {
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
