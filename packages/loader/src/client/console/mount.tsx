/**
 * 控制台挂载接线（T2.5）。
 *
 * 三处挂载（api-notes §6 实测形态，全部 list/additive 槽位；`sidebar` 本体是
 * occupied single，禁碰——§6.3 定案）：
 * - `settings.section`：控制台主界面（分区 id = 公约保留面 `dsh-ui-skin-loader`，
 *   order 90；label 注册期本地化文案——locale 变化时**重新注册**（api-notes §6.2/
 *   §13.6：壳不订阅 locale 状态，靠 ledger bump 触发重渲染））；
 * - `sidebar.footer.action`：侧栏底部入口按钮（owner props { wide }）；
 *   点击展开/收起 shell.overlay 上的控制台浮层（宿主无已验证的「打开设置面板」
 *   客户端导航 API——设置面板 open state 是 ui-settings-general 私有 store，
 *   brief §1 授权的第二形态「展开控制台」）；
 * - `shell.overlay`：全帧浮层席位（click-through 层，浮层自持 pointer-events）。
 *
 * 上游事件订阅在 mount 期（ctx.effect 语境）完成：theme/change → 配色 store、
 * locale/change → revision store + 分区 label 重注册（React 组件不直接 ctx.on，
 * 见 env.ts 头注）。start() 返回的组合 disposer 随加载器 fiber 卸载级联撤除。
 */

import { composeDisposers } from "../../adapter/dsh-0.1.7.ts";
import type { DshAdapter } from "../../adapter/types.ts";
import type { Disposer, SkinRuntime } from "../../protocol.ts";
import type { ConsoleEnv } from "./components.tsx";
import { ConsoleEnvProvider, FooterAction, OverlayHost, SettingsSection } from "./components.tsx";
import { createFlagStore, createLocaleRevisionStore, createSchemeStore } from "./env.ts";
import { createProvisioningFacade } from "./provisioning.ts";
import { CONSOLE_ENTRY_ID, CONSOLE_LOCALE_NS, MESSAGES } from "./messages.ts";
import { ensureConsoleStyles } from "./styles.ts";

/** JSX 命名空间类型（React 19 的 global JSX 已移除；显式引 ReactNode）。 */
import type { ComponentType, ReactNode } from "react";

export interface ConsoleControllerOptions {
  /** 基于加载器自身 client ctx 构造的 adapter（per-ctx 告戒同 runtime）。 */
  adapter: DshAdapter;
  /** SkinRuntime 公共面（冻结面；组件只消费 list/current/switchTo/subscribe）。 */
  runtime: SkinRuntime;
  /** 文档句柄（样式注入）；缺省 globalThis.document（浏览器宿主恒有）。 */
  document?: Document;
}

export interface ConsoleController {
  /**
   * 挂载控制台：注册 locale 字典、订阅 theme/locale 事件、注册三个槽位。
   * 返回组合 disposer（client wiring 经 ctx.effect 登记，unload 逆序释放）。
   */
  start(): Disposer;
}

export function createConsoleController(options: ConsoleControllerOptions): ConsoleController {
  const { adapter, runtime } = options;
  const doc = options.document ?? globalThis.document;

  function start(): Disposer {
    const disposers: Disposer[] = [];

    // ---- 样式（幂等注入；卸载移除）
    disposers.push(ensureConsoleStyles(doc));

    // ---- 文案（api-notes §10：双语 register + bind；bind 同 ns 幂等）
    disposers.push(
      adapter.locale.register(CONSOLE_LOCALE_NS, { en: { ...MESSAGES.en }, zh: { ...MESSAGES.zh } }),
    );
    const t = adapter.locale.bind(CONSOLE_LOCALE_NS);

    // ---- 配色跟随（api-notes §7：getTheme 快照 + theme/change 持续同步）
    const scheme = createSchemeStore(adapter.theme.getTheme().colorScheme);
    disposers.push(
      adapter.events.on("theme/change", (...args: unknown[]) => {
        const snapshot = args[0] as { active?: { colorScheme?: unknown } } | undefined;
        scheme.set(snapshot?.active?.colorScheme === "dark" ? "dark" : "light");
      }),
    );

    // ---- 双语跟随 revision（api-notes §10：locale/change 仅激活语言切换时发）
    const localeRevision = createLocaleRevisionStore();
    // ---- 浮层展开旗标（侧栏入口 ↔ shell.overlay 共享）
    const overlayOpen = createFlagStore(false);

    // ---- 皮肤补齐投影（host settings `provisioning` 段；只读投影 + 开关/重试写路径）
    const provisioning = createProvisioningFacade(adapter);

    const env: ConsoleEnv = { runtime, t, scheme, localeRevision, overlayOpen, provisioning };

    // 给槽位组件包一层 ConsoleEnvProvider（三处槽位 = 三棵独立 React 子树）。
    // 注意必须以「元素」形态渲染 Component（不能函数直调 Component(props)）——
    // 直调时组件函数在 provider 之外的 context 里执行，useContext 拿不到 env。
    // 槽位 owner props 只有 { wide } / { close }（api-notes §6.2/§6.3），
    // 包装面统一为 { wide?: boolean }，其余 owner props 在运行期原样透传后由组件忽略。
    const withEnv = (
      Component: ComponentType<{ wide?: boolean }>,
    ): ((props: { wide?: boolean }) => ReactNode) => {
      const Element: ComponentType<{ wide?: boolean }> = Component;
      return (props) => (
        <ConsoleEnvProvider env={env}>
          <Element {...props} />
        </ConsoleEnvProvider>
      );
    };

    // ---- settings.section（label 注册期本地化；locale 变化时重注册——api-notes §6.2/§13.6）
    let sectionOff: Disposer | null = null;
    const registerSection = (): void => {
      sectionOff?.();
      sectionOff = adapter.slots.register(
        {
          name: "settings.section",
          kind: "list",
          id: CONSOLE_ENTRY_ID,
          order: 90,
          label: t("nav.label"),
        },
        withEnv(SettingsSection),
      );
    };

    disposers.push(
      adapter.events.on("locale/change", () => {
        localeRevision.bump();
        registerSection();
      }),
    );

    // ---- 槽位挂载（声明出现前 inject 等待；声明已存在则同步执行）
    disposers.push(
      adapter.slots.inject("settings.section", () => {
        registerSection();
        return () => {
          sectionOff?.();
          sectionOff = null;
        };
      }),
    );
    disposers.push(
      adapter.slots.inject("sidebar.footer.action", () =>
        adapter.slots.register(
          { name: "sidebar.footer.action", kind: "list", id: CONSOLE_ENTRY_ID, order: 90 },
          withEnv(FooterAction),
        ),
      ),
    );
    disposers.push(
      adapter.slots.inject("shell.overlay", () =>
        adapter.slots.register(
          { name: "shell.overlay", kind: "list", id: CONSOLE_ENTRY_ID, order: 90 },
          withEnv(OverlayHost),
        ),
      ),
    );

    return composeDisposers(disposers);
  }

  return { start };
}
