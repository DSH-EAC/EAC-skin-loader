/**
 * DSH 0.1.7-rc.2 的 adapter 实现（T2.3）。
 *
 * 唯一权威：`docs/api-notes.md`（machine-verified，T2.2 产出）——每个成员的注释标注来源章节。
 * 本目录是仓库内唯一允许出现 `@deepseek-ai/*` 调用形态与上游私有全局
 * `__ModuleLoader__` / `__DSH_BOOT__` 的地方（根 eslint.config.js 机械强制）。
 *
 * 刻意零运行时依赖：上游 API 全部以「最小结构类型」描述（不 import 任何 @deepseek-ai 包），
 * adapter 只在调用形态这一层与上游耦合。
 */

import type {
  ClientBundleRegistration,
  Disposer,
  DshAdapter,
  DshEvents,
  DshLocale,
  DshModuleLoader,
  DshRemote,
  DshSettings,
  DshSettingsForm,
  DshSlots,
  DshTheme,
  HostInfo,
  SettingsSnapshot,
  SlotComponent,
  SlotOptions,
  ThemeDefinition,
  ThemeSnapshotInfo,
  ThemeTokenModes,
  Translate,
} from "./types.ts";

// ---------------------------------------------------------------------------
// 上游形态的最小结构类型（只描述我们实际调用的成员；api-notes 章节见各注释）
// ---------------------------------------------------------------------------

/** api-notes §3.1：`window.__ModuleLoader__` facade（ClientModuleLoaderTarget）的 adapter 侧最小形态。 */
interface ModuleLoaderTarget {
  load(registration: ClientBundleRegistration): void;
}

/** api-notes §3.2：boot wire（`window.__DSH_BOOT__`）顶层——adapter 只读 `rev`。 */
interface BootWire {
  rev?: unknown;
}

/** api-notes §5：`ctx.slots`（SlotRegistry）的 adapter 侧最小形态。 */
interface UpstreamSlots {
  register(options: Record<string, unknown>, component: unknown): Disposer;
  inject(key: string, callback: () => unknown): Disposer;
}

/** api-notes §7：`ctx.theme`（ThemeRuntime）的 adapter 侧最小形态。 */
interface UpstreamTheme {
  register(definition: {
    id: string;
    colorScheme: "light" | "dark";
    tokens: Record<string, string>;
  }): Disposer;
  overrideTokens(
    source: string,
    tokens: Record<string, ThemeTokenModes>,
  ): Disposer;
  /** api-notes §7：快照读；adapter 只取 preference 与 active.colorScheme。 */
  getTheme(): {
    preference?: unknown;
    active?: { colorScheme?: unknown };
  };
}

/** api-notes §8.2：`ctx.configForms.get(entryId)` 返回的 ConfigForm 的 adapter 侧最小形态。 */
interface UpstreamConfigForm {
  getSnapshot(): SettingsSnapshot;
  subscribe(listener: () => void): Disposer;
  set(field: string, value: unknown): Promise<boolean>;
}

/** api-notes §8.2：`ctx.configForms`（ConfigForms）的 adapter 侧最小形态。 */
interface UpstreamConfigForms {
  get(entryId: string): UpstreamConfigForm;
}

/** api-notes §10：`ctx.locale` 的 adapter 侧最小形态（双语 register + bind）。 */
interface UpstreamLocale {
  register(
    ns: string,
    dicts: Record<string, Record<string, string>>,
  ): Disposer;
  bind(ns: string): Translate;
}

/** api-notes §8.3：`ctx.remote` 的 adapter 侧最小形态（加载器只订阅转发事件）。 */
interface UpstreamRemote {
  $on(event: string, listener: (...args: unknown[]) => void): Disposer;
}

/**
 * api-notes §7/§10：`ctx.on`（cordis emitter，发布树 events.d.ts L197）的 adapter 侧
 * 最小形态——theme/change 与 locale/change 的订阅通道（宿主 ui-layout 同款形态）。
 */
interface UpstreamEvents {
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
}

/**
 * api-notes §4/§5/§7/§8.2/§8.3/§10：client cordis context 的 adapter 侧最小结构形态
 * （client bundle 的 `apply(ctx)` 收到的 ctx；只描述 adapter 用到的成员）。
 * `effect` 即 cordis fiber 的副作用登记面（api-notes §2：unload 逆序释放，
 * disposer 可异步、unload 会等待）——T2.4 运行时经它登记生命周期清理。
 */
export interface Dsh017ClientContext {
  /** api-notes §4：`ctx.provide(name, value)` → disposer——服务提供的唯一形态（运行时无 `ctx.service`）。 */
  provide(name: string, value: unknown): Disposer;
  /**
   * api-notes §2：`ctx.effect(execute, label?)`——execute 同步返回 disposer（可返回
   * 异步 disposer，unload 会 await）；返回值是 AsyncDisposable，调用方通常忽略。
   */
  effect(execute: () => (() => unknown) | void, label?: string): unknown;
  readonly slots: UpstreamSlots;
  readonly theme: UpstreamTheme;
  readonly configForms: UpstreamConfigForms;
  readonly locale: UpstreamLocale;
  readonly remote: UpstreamRemote;
  readonly on: UpstreamEvents["on"];
}

// ---------------------------------------------------------------------------
// 公共组合子
// ---------------------------------------------------------------------------

/**
 * 组合多个 disposer：逆序释放（对齐 cordis fiber 的 effect 卸载语义，api-notes §2），
 * 结果幂等（只释放一次）。
 */
export function composeDisposers(disposers: Iterable<Disposer>): Disposer {
  const list = [...disposers];
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const errors: unknown[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      try {
        list[i]?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `disposer cleanup failed: ${errors.map(String).join("; ")}`);
    }
  };
}

/** api-notes §5：inject callback 的返回形态（单个 disposer / disposer 迭代 / void）→ 单个 disposer。 */
function composeDisposerResult(
  result: Disposer | Iterable<Disposer> | void,
): Disposer {
  if (typeof result === "function") {
    return result;
  }
  return composeDisposers(result ?? []);
}

// ---------------------------------------------------------------------------
// moduleLoader（独立于 ctx：bundle 顶层注册发生在 apply 之前）
// ---------------------------------------------------------------------------

/**
 * api-notes §3.1：读取 `window.__ModuleLoader__` facade 并投影为 DshModuleLoader。
 * facade 由 HTML bootstrap 在脚本执行前安装（queue 模式起手，live 后直通）。
 * 缺失时抛出带指引的错误——本仓库内唯一触碰该私有全局的位置。
 */
export function getModuleLoader(): DshModuleLoader {
  const target = (globalThis as { __ModuleLoader__?: ModuleLoaderTarget })
    .__ModuleLoader__;
  if (!target || typeof target.load !== "function") {
    throw new Error(
      "window.__ModuleLoader__ not found: the dsh web client boot facade must exist before the loader client bundle registers (api-notes §3.1)",
    );
  }
  return {
    load(registration: ClientBundleRegistration): void {
      target.load(registration);
    },
  };
}

// ---------------------------------------------------------------------------
// hostInfo（独立于 ctx：读 boot wire 全局）
// ---------------------------------------------------------------------------

/**
 * api-notes §12.2/§15：安装期兼容性闸门走 peerDependencies semver 检查；
 * client 侧无已验证的运行期版本读取面（boot wire 的 `rev` 是内容修订非 semver，§3.2）。
 * dshVersion 固定 null（语义占位，待有已验证读取面再接），bootRev 透出已实测的 wire 字段。
 */
export function getHostInfo(): HostInfo {
  const boot = (globalThis as { __DSH_BOOT__?: BootWire }).__DSH_BOOT__;
  return {
    dshVersion: null,
    bootRev: typeof boot?.rev === "string" ? boot.rev : null,
  };
}

// ---------------------------------------------------------------------------
// slots
// ---------------------------------------------------------------------------

/**
 * api-notes §5：把 adapter 的判别联合选项映射为上游 register options——
 * 校验 kind 对应的必填形态字段（list→id、keyed→key、chain→select），剥掉 adapter-only 的
 * `kind` 元数据（上游 kind 由槽位键的 SlotMap 声明决定），其余字段（name/label/registrant/
 * id/order/key/priority/select）原样透传。
 */
function toUpstreamSlotOptions(options: SlotOptions): Record<string, unknown> {
  switch (options.kind) {
    case "list":
      if (!options.id) {
        throw new Error(
          `list slot "${options.name}" registration requires \`id\` (api-notes §5)`,
        );
      }
      break;
    case "keyed":
      if (!options.key) {
        throw new Error(
          `keyed slot "${options.name}" registration requires \`key\` (api-notes §5)`,
        );
      }
      break;
    case "chain":
      if (typeof options.select !== "function") {
        throw new Error(
          `chain slot "${options.name}" registration requires \`select\` (api-notes §5)`,
        );
      }
      break;
    case "single":
      break;
  }
  const upstream: Record<string, unknown> = { ...options };
  delete upstream.kind;
  return upstream;
}

function createSlotsAdapter(upstream: UpstreamSlots): DshSlots {
  return {
    register(options: SlotOptions, component: SlotComponent): Disposer {
      return upstream.register(toUpstreamSlotOptions(options), component);
    },
    inject(
      key: string,
      callback: () => Disposer | Iterable<Disposer> | void,
    ): Disposer {
      // api-notes §5：声明已存在 → 同步执行；否则在声明提交时执行；
      // callback 返回的 disposer/迭代由 adapter 聚合成单个 effect（逆序释放）再交给上游，
      // 上游把该 effect 挂到调用方 fiber（卸载级联 + 可通过返回的 disposer 主动撤除）。
      return upstream.inject(key, () => composeDisposerResult(callback()));
    },
  };
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

function createThemeAdapter(upstream: UpstreamTheme): DshTheme {
  return {
    register(definition: ThemeDefinition): Disposer {
      // api-notes §7：{id, colorScheme, tokens} 单值 token 表，原样透传。
      return upstream.register(definition);
    },
    overrideTokens(
      source: string,
      tokens: Record<string, ThemeTokenModes>,
    ): Disposer {
      // api-notes §7：每个 token 必须同时给亮暗两值（裸字符串上游抛教学错误）——adapter 提前校验。
      for (const [token, modes] of Object.entries(tokens)) {
        if (
          modes === null ||
          typeof modes !== "object" ||
          typeof modes.light !== "string" ||
          typeof modes.dark !== "string"
        ) {
          throw new Error(
            `overrideTokens("${source}") token "${token}" requires { light, dark } string values (api-notes §7)`,
          );
        }
      }
      return upstream.overrideTokens(source, tokens);
    },
    getTheme(): ThemeSnapshotInfo {
      // api-notes §7：快照读 + active.colorScheme 解析（preference 为 "system" 时上游已解析）。
      const snapshot = upstream.getTheme();
      const preference =
        typeof snapshot?.preference === "string"
          ? snapshot.preference
          : "system";
      const colorScheme =
        snapshot?.active?.colorScheme === "dark" ? "dark" : "light";
      return { preference, colorScheme };
    },
  };
}

// ---------------------------------------------------------------------------
// settings（client configForms 投影；host 侧 configure 属 T2.4）
// ---------------------------------------------------------------------------

function createSettingsAdapter(upstream: UpstreamConfigForms): DshSettings {
  return {
    get<T = Record<string, unknown>>(entryId: string): DshSettingsForm<T> {
      // api-notes §8.1/§8.2：entryId == patch 行 id == settings 命名空间。
      const form = upstream.get(entryId);
      // api-notes §8.2：上游 getSnapshot() 是「稳定引用，uSES 友好」——投影按上游快照标识
      // memoize（WeakMap 随快照对象回收），同一快照标识返回同一投影对象，否则 T2.5 在
      // useSyncExternalStore(form.subscribe, form.get) 下会触发 React
      // "getSnapshot should be cached" 无限重渲染循环。
      const projectionCache = new WeakMap<object, SettingsSnapshot<T>>();
      return {
        get(): SettingsSnapshot<T> {
          const snapshot = form.getSnapshot();
          const cached = projectionCache.get(snapshot);
          if (cached) {
            return cached;
          }
          const projected: SettingsSnapshot<T> = {
            status: snapshot.status,
            value: snapshot.value as T,
            revision: snapshot.revision,
            writable: snapshot.writable,
          };
          // 快照契约是对象（§8.2）；防御性跳过非对象键，避免 WeakMap.set 抛错。
          if (typeof snapshot === "object" && snapshot !== null) {
            projectionCache.set(snapshot, projected);
          }
          return projected;
        },
        set(field: string, value: unknown): Promise<boolean> {
          return form.set(field, value);
        },
        subscribe(listener: () => void): Disposer {
          return form.subscribe(listener);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// locale
// ---------------------------------------------------------------------------

function createLocaleAdapter(upstream: UpstreamLocale): DshLocale {
  return {
    register(ns: string, dicts: { en: Record<string, string>; zh: Record<string, string> }): Disposer {
      // api-notes §10：typed 双语形态 register(ns, {en, zh})——缺键回退 en，双语齐备强制。
      return upstream.register(ns, dicts);
    },
    bind(ns: string): Translate {
      // api-notes §10：同 ns 重复 bind 返回同一函数（上游 memoization）。
      return upstream.bind(ns);
    },
  };
}

// ---------------------------------------------------------------------------
// 聚合
// ---------------------------------------------------------------------------

/**
 * api-notes §4/§5/§7/§8.2/§8.3/§10：基于 client cordis ctx 构造 adapter 聚合面。
 *
 * ⚠️ 应基于「调用方自己的 client ctx」构造：上游 SlotRegistry 经 cordis service proxy
 * 在调用时把 `this.ctx` 绑定到调用方 context（api-notes §5），dispose 因此路由进调用方 fiber。
 * 跨 fiber 共享一个用加载器 ctx 构造的单例，会把皮肤注册的撤除路由进加载器 fiber——
 * T2.4 在 registerSkin 时应以皮肤 apply 收到的 ctx 现场构造。
 */
export function createDsh017Adapter(upstream: Dsh017ClientContext): DshAdapter {
  return {
    slots: createSlotsAdapter(upstream.slots),
    theme: createThemeAdapter(upstream.theme),
    settings: createSettingsAdapter(upstream.configForms),
    locale: createLocaleAdapter(upstream.locale),
    remote: createRemoteAdapter(upstream.remote),
    events: createEventsAdapter({ on: upstream.on }),
    hostInfo: getHostInfo(),
  };
}

/**
 * api-notes §8.3：`ctx.remote.$on` 语义投影——T2.4 加载器跨标签页重放切换
 * 直接订阅 `settings/document-updated`（api-notes §8.3 的明确指引）。
 */
function createRemoteAdapter(upstream: UpstreamRemote): DshRemote {
  return {
    $on(event: string, listener: (...args: unknown[]) => void): Disposer {
      return upstream.$on(event, listener);
    },
  };
}

/**
 * api-notes §7/§10：`ctx.on` 语义投影——theme/change（亮暗自适应）与
 * locale/change（双语跟随）的订阅通道。防御性包装：上游返回值仅在可调用时
 * 视为 disposer（cordis `on` 在 fiber 未激活等边缘可返回 true/undefined）。
 */
function createEventsAdapter(upstream: UpstreamEvents): DshEvents {
  return {
    on(event: string, listener: (...args: unknown[]) => void): Disposer {
      const result = upstream.on(event, listener);
      return typeof result === "function" ? (result as Disposer) : () => undefined;
    },
  };
}
