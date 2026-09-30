# DSH API 核对笔记

## 0.2.0-rc.2 适配补充（2026-09-30）

本节是新增版本的产物契约核对，不是 Desktop boot 或视觉验收。下方 `0.1.7-rc.2` 原报告保持历史含义，不将旧版实机结果移用于新版。

### 材料与版本边界

- 加载器基线：`afa947215a862a9c3304f6fff7a812efe5a42fdc`。
- 规划指定官方 tag：`dsh-v0.2.0-rc.2`，提交 `639ed015397290b3745d163aafe02ffee4aa3f84`（来自已确认的规划材料，本轮未重新获取该 tag 源码）。
- 实际执行契约测试的材料：只读提取 `D:/profile/dsd/resources/app.asar` 中的官方包；Desktop 元数据版本为 `0.2.0-rc.2`，`dshBuildCommit=04f392c9ddd144fa426da2045178797da6db6c11`，`dshBuildDirty=false`。**此构建提交与指定 tag 提交不同，不能视作同一源码快照。**
- 官方包版本逐个校验为 `0.2.0-rc.2`，Cordis 为 `4.0.4`，Schemastery 为 `3.18.4`。store 的 Node 入口需要额外的 Zustand/Immer 构建依赖，这些仅安装于忽略的 `.verify/` 目录，未加入业务依赖。

### 接口结论

| 能力 | 本次核对与测试 | 复用结论及边界 |
| --- | --- | --- |
| client 模块 | 官方 `ClientModuleSystem` 接受 `{ id, factory }`，惰性材料化、重复 import 缓存 | 沿用 `getModuleLoader()` |
| 槽位 | 官方 `SlotCore` 接受 list 席位、幂等释放及 owner 级联 | 沿用 register；三个席位 key 在 ui-layout/ui-sidebar/ui-settings-general 发布 bundle 中核对；测试中的声明人为提供，不验证真实席位渲染或 Cordis `slots.inject` |
| 主题 | 官方 `ThemeRuntime` 接受 register 与亮暗双值 override，释放后保留偏好且移除 token | 沿用 adapter；未模拟系统主题切换或 React 渲染 |
| locale | 官方 `LocaleRuntime` 接受双语 register/bind、插值和幂等清理 | 沿用 adapter；不执行 Desktop preload 语言初始化 |
| 设置 | 官方 ConfigForms、store、schema 读取既有 `activeSkin`，稳定快照，拒绝写入回读、接受写入到 `default`，事件订阅释放 | 沿用 adapter；Cordis Service 注入与远端 transport 是明确边界桩，不是实际 host 写盘或 SSE 网络验证 |
| host 配置 | 发布产物仍通过 `ctx.settings.configure({ auto: false }, ctx.fiber)` 禁用自动配置 | 沿用现有 host adapter；host 注入的生产形态通过只读检查，现有 host 单测验证 schema 与调用形态 |

未发现要求复制新版 adapter 的调用形态差异，因此保留 `dsh-0.1.7.ts` 及 `dsh-0.1.7-host.ts` 的文件名和生产实现。皮肤的可选 `workspaces`/`connection` 服务访问以及深鲸的 `theme.setTheme` 调用未作机械改写；逐包生命周期单测仍需与真实 Desktop 验收区分。

兼容声明为 `0.1.7-rc.2 || 0.2.0-rc.2`，只放行这两个精确版本；13 款稳定 ID、`activeSkin`、命名空间、默认外观和 vendor 内容不变。接口核对和本地测试不能证明新版 CSS/DOM 视觉、插件安装、真实单实例或跨重启行为已通过。

---

# DSH 0.1.7-rc.2 API 实机核对笔记（M1 / T2.2 历史产出）

> 本文是 adapter 层（`src/adapter/dsh-0.1.7.ts`，T2.3）的**唯一权威**依据。
> 全部结论来自 2026-09-25 在完全隔离环境（`DSH_HOME=<repo>/.verify/dsh-home`）中对
> `@deepseek-ai/dsh@0.1.7-rc.2`（npm，npmmirror 源）的真实 boot + 探针插件 + 源码核对，
> 未采用任何 0.1.5 时代或文档推断的结论。
>
> **引用路径约定**：`$NM` = `.verify/probe/node_modules/@deepseek-ai/`（npm 发布版源码树）。
> 上游 monorepo 源路径（PLAN §0.4 用的 `packages/client/ui-theme/...` 形式）与发布包名的映射：
> `packages/client/ui-theme` → `$NM/dsh-client-ui-theme`，`packages/client/modules` → `$NM/dsh-client-modules`，
> 以此类推（client 侧一律加 `dsh-client-` 前缀）。
>
> 结论标记：✅ 与 PLAN §0.4 表一致 ｜ ⚠️ 有出入（以本文实测为准）｜ ❌ 不存在（给替代）

---

## 0. 速览：与 PLAN §0.4 表的逐行结论

| PLAN §0.4 行 | 结论 | 修正/补充要点 |
| --- | --- | --- |
| `window.__ModuleLoader__.load({id, factory})` | ✅ | 发布物形如 `load({id, factory})`，factory 惰性执行；见 §3.1 |
| package.json `dsh.client`（platform/inject/external/immediately）+ `exports["./client"]`；`dsh.bundle.patch` | ✅ | ⚠️ `dsh.client.inject` **不是** cordis 服务注入（informational）；见 §4.1 R10 定案 |
| `ctx.slots.register(options, component) → disposer`；`ctx.slots.inject(key, cb)`；kind single/list/keyed/chain；scope root/session | ⚠️ | scope 实为 `'root' \| 'session-maybe' \| 'session'`；register 首参带 `name`；list 槽位必填 `id`；见 §5 |
| 已知 slot key 清单 | ⚠️ | 清单全部存在；**`sidebar` 不可用**（single+已被占，第二注册会 shadow）；additive 侧栏席位是 `sidebar.footer.action`；另存在未列出的 `sidebar.*` / `settings.plugins.tab` 等；见 §6 |
| `ctx.theme.register/overrideTokens`、`setTheme(id)`、`theme/change` | ✅ | ⚠️ `overrideTokens` 的 tokens 要求 light+dark 双值；`register` 的 tokens 是单值表；见 §7 |
| host `ctx.settings.configure({auto}, fiber)` | ✅ | settings 命名空间 == Loader entry id（patch 行 id）；见 §8.1 |
| client `ctx.configForms.get(entryId)`（set/unset/mutate/getSnapshot/subscribe）；`whileServed` | ✅ | `get()` 无需 decode 时直接用默认 wire schema 校验；见 §8.2 |
| SSE `settings/document-updated` 跨标签页 | ✅ | 事件挂在 remote 通道上：`ctx.remote.$on("settings/document-updated", cb)`；见 §8.3 |
| 启停粒度：patch 行 `disabled`；fiber dispose 逆序释放 `ctx.effect` | ✅ | 插件管理器只改 profile `cordis.patch.yml` 最后一个匹配行的 `disabled`；见 §9 |
| `ctx.locale.register/bind` | ✅ | 两个 register 重载（typed 双语表 / untyped 单 locale）；见 §10 |
| `ctx.webServer.register/registerFallback` | ✅ | `registerFallback` 全局仅一个 owner，第二个注册抛错；见 §11 |
| 安装：`dsh plugin --profile <name> add <…>`；profile 在 `$DSH_HOME/profiles/<name>/` | ✅ | ⚠️ 兼容性闸门是 **peerDependencies 的 `@deepseek-ai/dsh*` semver 检查**（声明了 peer 才检查；不是 engines.dsh）；见 §12 |

**根本性新发现（PLAN 未预见）**：
1. **R10 定案**——client 侧跨插件服务注入 = client bundle 顶层 `exports.inject = [服务名…]` + `exports.apply(ctx)`；package.json 的 `dsh.client.inject` 只是模块图依赖声明。详见 §4。
2. **探针插件全链路实测通过**：本地路径 `dsh plugin add` → bundle 自动启用 → client 半进入 boot graph → 浏览器实机渲染 `settings.section` 与 `sidebar.footer.action` → remove 后完全恢复干净。详见 §12.4。
3. **HMR 热应用**：web profile 启用了 hmr，`dsh plugin add` 在 boot 运行中执行时会把新插件**热应用到正在运行的进程**（实测：新路由即刻 200）。T2.7 验证矩阵设计用例时要考虑这点。

---

## 1. 插件包的完整形态（实测可运行）

一个"host 半 + client 半"的标准 dsh 插件包（探针插件 `@dsh-eac/probe-plugin` 的实测形态，
位于 `.verify/probe-plugin/`，按此结构可直接复用为 loader 包骨架）：

```
<dsh-ui-skin-loader>/
  package.json        ← 见下
  cordis.patch.yml    ← dsh.bundle.patch 指向的补丁层
  lib/index.js        ← host 半：ESM，导出 apply(ctx, config)（可导出 Config schema）
  lib/client.js       ← client 半：window.__ModuleLoader__.load({id, factory}) 包裹
```

### 1.1 package.json

```jsonc
{
  "name": "@dsh-eac/ui-skin-loader",
  "version": "…",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",          // host 半（Loader entry name 解析的是包根 export）
    "./client": "./lib/client.js",  // client 半：client-modules 按 ./client 子路径取 bundle
    "./package.json": "./package.json"
  },
  // ⚠️ 安装期兼容性闸门检查的是这里的 @deepseek-ai/dsh* peer（semver, includePrerelease）
  "peerDependencies": {
    "@deepseek-ai/dsh": "0.1.7-rc.2",
    "@deepseek-ai/cordis": "~4.0.4"
  },
  "engines": { "dsh": "0.1.7-rc.2", "node": ">=24" },  // 声明性；安装器不强制（见 §12.2）
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },   // 补丁层；也接受 string[]（如 dsh-web-app 的 5 个 patch）
    "client": {
      "platform": "web"          // 必填 string；web 消费方选 "web"
      // "inject": [包名…],      // 可选：模块到达顺序的包名依赖（非 cordis 服务注入！）
      // "external": [模块名…],  // 可选：baseline 之外额外请求的模块表词（§3.3）
      // "immediately": true     // 可选：第一阶段预取；缺省进 application 批次
    }
  }
}
```

依据：`$NM/dsh-package-manifest/lib/types/types.d.ts` L42-96（`DshPackageManifest`/`DshManifest`/`DshBundleManifest`/`DshClientManifest`，其中 L79 注释明确 inject "Informational package-name dependencies, not Cordis service injection"）；实机样例 `$NM/dsh-client-ui-theme/package.json`、`$NM/dsh-client-ui-settings-general/package.json`。

### 1.2 cordis.patch.yml（bundle 补丁层）

```yaml
- insert:
    - id: ui-skin-loader            # Loader entry id == settings 命名空间 == configForms.get() 的 entryId
      name: "@dsh-eac/ui-skin-loader"  # 包名；Loader import 包根 export 并调用其 apply
      # disabled: true              # 插件管理器启停开关改的就是这一字段
      # config: { … }               # 该 entry 的 Config（patch 替换整段 config，不合并）
```

依据：`$NM/dsh-base/cordis.patch.yml`（权威样例，528 行）与 `$NM/dsh-web-app/cordis.patch.yml` L230-246
（`- id: ui-theme / name: '@deepseek-ai/dsh-client-ui-theme'` —— client 插件同样以 host 行插入）。
规则：后层 patch 同 id 覆盖前层，"last write wins per row"；patch 替换目标行整段 `config` 而非合并
（`$NM/dsh-base/cordis.patch.yml` 头注 L1-13 原文）。

### 1.3 host 半（lib/index.js）

```js
export function apply(ctx, config) {
  // 等服务可用再执行（cordis 子 fiber；unload 自动逆序回收）
  ctx.inject(["webServer"], (web) => {
    web.effect(() => web.webServer.register({ kind: "exact", path: "/x/ping",
      handler: (req, res) => { res.writeHead(200, {"content-type":"application/json"}); res.end("{}"); },
    }), "label");
  });
  // settings 页策略（关闭自动生成设置页）
  // ctx.inject(["settings"], (child) => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)));
}
// 可选：export const Config = z.object({ … })（@deepseek-ai/schemastery）
```

依据：`$NM/dsh-client-ui-theme/lib/index.js` L60-96（`Config` + `apply`，apply 内 `ctx.inject(["settings"], …)` 调 `settings.configure({auto:false}, ctx.fiber)`）；
`$NM/dsh-client-modules/lib/index.js` L525-528（`ctx.inject(["webServer"], registerWebCarrier)` 的官方用法）。

### 1.4 client 半（lib/client.js）——**bundle 纯度与接线方式全部定案**

```js
window.__ModuleLoader__.load({
  id: "@dsh-eac/ui-skin-loader",            // == 包名 == graph row id
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const jsxRuntime = require("react/jsx-runtime");   // baseline 词可直接 require（§3.3）

    function ProbeSection() { /* React 函数组件；settings.section 的 owner props 是 { close } */ }
    const inject = ["slots"];        // ★ cordis 服务注入：fiber 等这些服务就绪后才跑 apply
    function apply(ctx) {
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section", id: "dsh-eac-probe", order: 90, label: "Probe",
      }, ProbeSection));
    }
    exports.apply = apply;
    exports.inject = inject;         // ★ 由 vendored cordis Loader 读取并组 fiber
    return module.exports;
  },
});
```

依据（ shipped 官方样例逐字段对照）：`$NM/dsh-client-ui-settings-general/lib/client.js` L1-6（load 形态）、
L938-950（`const inject = ["slots","locale","connection","remote","remote.settings","configForms","shortcuts"]` 及注释
"Required services (cordis fiber inject)"）、L952+（`apply(ctx)` 用 `ctx.slots.inject` + `ctx.effect`）、
L1181-1182（`exports.apply = apply; exports.inject = inject;`）。

**运行时验证**：探针 client 半按此形态手写（非打包器产物），在实机浏览器中成功材料化、apply 执行、
两个槽位渲染（§12.4）。证明 hand-written bundle 与打包器产物同权。

---

## 2. 生命周期与启动链路（实测 + 源码）

1. host boot 组合 profile：`dsh.profile.bundles` 各 bundle 的 patch 依序叠层 → 用户 `cordis.patch.yml` → `--patch` overlays
   （`$NM/dsh/lib/bin.js` L22-48 帮助文本；`$NM/dsh-app-boot`）。
2. 每个 insert 行成为 Loader entry；`ClientModuleRegistry`（`static inject = ["loader"]`）订阅 `internal/plugin` 事件，
   对每个 fiber 的 entry 名做增量 `dsh.client` 扫描，把声明了 client 的包组成 `window.__DSH_BOOT__` graph
   （`$NM/dsh-client-modules/lib/index.js` L100-126 模块文档、L500-560 `ClientModuleRegistry`）。
3. 浏览器端 HTML bootstrap facade `window.__ModuleLoader__` 先 queue 后 live；模块系统 create 后，
   cordis 逐 entry 组 fiber：读 client exports 的 `inject`（服务名）等依赖就绪 → 调 `apply(ctx)` → fiber 存活期间
   `ctx.effect` 登记的副作用在 unload 时**逆序**释放（`$NM/cordis/lib/types/fiber.d.ts` L36-40 "Disposers run in reverse
   registration order when the owning fiber unloads"；实现 `$NM/cordis/lib/index.js` L1179 `.reverse()`）。
4. disable 某行 → fiber dispose → 全部 slot 注册、路由、locale 字典等经由 ctx.effect/disposer 级联撤除。

---

## 3. client 模块系统（ModuleLoader）

### 3.1 注册面 ✅

- `window.__ModuleLoader__.load({ id, factory })`，`factory: (require) => exports`，惰性材料化（脚本执行只登记，
  首次 require/import 才执行 factory；CSS 注入等副作用都在 factory 闭包内）。
- 类型：`ClientBundleRegistration { id; chunk?; factory }`、`ClientModuleLoaderTarget { mode: 'queue'|'live'; pendingQueue; load(); create() }`
  ——`$NM/dsh-client-modules/lib/types/client/manifest.d.ts` L177-216。
- 实机：boot 出的 index.html 内联脚本就是该 facade（queue 模式起手）；页面跑起来后 `window.__ModuleLoader__.mode === "live"`（浏览器 eval 实测）。
- PLAN 引用的 `packages/client/modules/src/client/manifest.ts` L299-310 在发布树中对应本包（类型面完全一致）。

### 3.2 boot wire（`window.__DSH_BOOT__`）

`{ rev, entries: [{ id, url, rev, inject?, immediately?, external? }], batches: [...] }`；
实机抓取（隔离 profile）确认 graph 按模块图序输出，探针条目 `{"id":"@dsh-eac/probe-plugin","url":"plugins/??@dsh-eac/probe-plugin/client.js&rev=…"}`。

### 3.3 模块表词（baseline externals）

client bundle 里 `require()` 只能要 **graph 行包名** 或 **模块表词**。内置静态模块表（shell 注入，
`dsh-web-frontend/dist/assets/index-*.js` 内 `WS()` 函数，minified 实读）：

```
react / react/jsx-runtime / react-dom / react-dom/client
@deepseek-ai/cordis
@deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-dockkit
```

之外的模块要在 package.json `dsh.client.external` 里声明（精确表词，含 `<pkg>/client` 子路径——`/client` 后缀在解析时被剥离等价于包名，`stripClientSuffix`）。**因此皮肤/loader 的 client 半可以直接 `require("react")`、`require("@deepseek-ai/cordis")`、`require("@deepseek-ai/dsh-client-ui-slots")`，零 external 声明。**

> 注意：`require("@deepseek-ai/dsh-client-ui-slots")` 拿到的是**类型+运行时常量**；React 组件与槽位系统交互仍走 `ctx.slots`（cordis 服务），不是直接 import 渲染器。

---

## 4. R10 定案：三处 "inject" 的确切关系（PLAN §2.3 依据，必读）

| 名字 | 位置 | 语义 | 实测依据 |
| --- | --- | --- | --- |
| `dsh.client.inject` | package.json | **informational 的包名依赖**：模块到达顺序（factory 先注册）+ cordis entry 组合的包边。**不是服务注入** | `$NM/dsh-package-manifest/lib/types/types.d.ts` L79 原文 "Informational package-name dependencies, not Cordis service injection"；`$NM/dsh-client-modules/lib/types/client/manifest.d.ts` L43-46 注释 "Cordis separately uses the same package edges to compose entries"（短语在 L45） |
| `exports.inject`（client） | client bundle 顶层导出 | **cordis 服务注入**：服务名数组；vendored Loader 组 fiber 时等这些服务就绪才调 `apply`。跨插件 client 协作的正道 | `$NM/dsh-client-ui-settings-general/lib/client.js` L934-950；`$NM/dsh-client-ui-settings/lib/types/client/config-form.d.ts` L99-105（"the client bundle purity gate forbids cross-plugin value imports and directs cross-plugin collaboration through cordis services"，短语在 L102） |
| `ctx.provide(name, value)` / `super(ctx, name)`（服务提供） | cordis Context / Service 基类 | **提供**命名服务：`ctx.provide(name, value)`（`$NM/cordis/lib/types/reflect.d.ts` L43、L144）；Service 子类 `super(ctx, name)` 在构造时立即注册并随拥有 fiber 卸载自动移除（`$NM/cordis/lib/types/service.d.ts` L1-6、L31-36）。官方实例见下方落地方案 | `ctx.provide("locale", locale)`：`$NM/dsh-client-locale/lib/client.js` L1526；`ctx.provide("theme", theme)`：`$NM/dsh-client-ui-theme/lib/client.js` L1582；`super(ctx, "configForms")`：`$NM/dsh-client-ui-settings/lib/client.js` L1284；`ctx.reflect.provide("uiRenderer", …)`：`$NM/dsh-client-ui-renderer/lib/client.js` L1844 |
| `ctx.inject([…], cb)`（host/通用） | cordis Context | cordis 通用 API：创建子 fiber 等服务就绪后执行 cb（host 半用它拿 `webServer`/`settings` 等） | `$NM/dsh-client-ui-theme/lib/index.js` L88-94；`$NM/dsh-client-modules/lib/index.js` L552（`ClientModuleRegistry` 类定义 L506） |

> ⚠️ **cordis 运行时没有 `ctx.service` 这个 API**：对整个 `$NM` 树 grep `ctx.service(` 零命中。提供服务一律用 `ctx.provide` / Service 基类。

**对 PLAN §2.3 的落地方案（加载器接线）**：
- 加载器 client 半提供皮肤注册服务：`exports.apply(ctx)` 里 **`ctx.provide("uiSkinLoader", skinRuntime)`**。cordis 服务提供 API 只有两种形态：
  `ctx.provide(name, value)`（`$NM/cordis/lib/types/reflect.d.ts` L43、L144——"Same as above for service names outside the typed `Context` surface"）
  或 Service 子类 `super(ctx, name)` 构造即注册、随 fiber 卸载自动移除（`$NM/cordis/lib/types/service.d.ts` L1-6、L31-36）。
  **不存在 `ctx.service(...)`**（全 `$NM` 树 grep 零命中）。官方实例：
  `ctx.provide("locale", locale)`（`$NM/dsh-client-locale/lib/client.js` L1526）、
  `ctx.provide("theme", theme)`（`$NM/dsh-client-ui-theme/lib/client.js` L1582）、
  Service 子类形态 `super(ctx, "configForms")`（`$NM/dsh-client-ui-settings/lib/client.js` L1284）、
  `ctx.reflect.provide("uiRenderer", …)`（`$NM/dsh-client-ui-renderer/lib/client.js` L1844）。
  皮肤 client 半 `exports.inject = ["slots", "uiSkinLoader"]` 后在 `apply` 里调 `ctx.uiSkinLoader.registerSkin(…)`。
- 公约 §9 伪码 `ctx.inject(["uiSkinLoader"])` 对应上表 `exports.inject`（client 侧）与 `ctx.inject`（host 侧）两行的形态；**package.json `inject: ["uiSkinLoader"]` 不承担此职责**（只保证模块先到达）。公约文本发布前应把伪码改为 `exports.inject` 语义，并把"提供方"一侧写成 `ctx.provide`。
- client 服务等待即"皮肤 fiber 存活期间只做 registerSkin 然后 apply 返回即停"的实现载体：把 `registerSkin` 调用放 apply 体内，apply 返回即结束，无 effect 登记 → fiber 空转不占副作用。

---

## 5. 槽位系统 API（slots）

来源：`$NM/dsh-client-ui-slots/lib/types/index.d.ts`（纯核心）+ `$NM/dsh-client-ui-renderer/lib/types/client/registry.d.ts`（cordis Service 层）。

- `ctx.slots.register(options, component) → disposer`（幂等；stale disposer 是 no-op）
  - options（`BaseOptions` L596-614 + `KindOptions` L553-595）：
    - `name`（SlotMap key，必填）；`children?: { [slotKey]: SlotSpec }`（声明即独占：同一 children 声明只允许一个 entry）；`store?`；`locale?: ns`（声明后组件 props 获得 `t`）；`registrant?`（诊断标签，Service 包装会自动盖调用方 fiber 名）
    - kind 形态字段：`list` → **`id` 必填** + `order?` + `label?`；`keyed` → `key` + `priority?`；`single`/`chain` → 无（chain 用 `select`）；`single` 的 `priority` 是 cell shadowing rank（同 key 同 priority 抛错）
    - `inject?: (…args) => I`：注册者的业务面工厂（把 ctx 侧数据注入组件 props）
  - `label?: SlotLabel = string | (() => string)`（L555；thunk 按当前 locale 读）
  - component：React 函数组件，props = owner props + renderSlot 函数 + inject 面 + 可选 `t`
- `ctx.slots.inject(key, callback) → disposer`：声明已存在则同步执行 callback，否则在声明提交时执行；
  callback 返回 disposer 或 disposer 迭代；**controller 归调用方 fiber**（插件卸载自动取消等待+撤除已登记内容）
  （registry.d.ts L111 附近签名与文档）。
- kind：`'single' | 'list' | 'keyed' | 'chain'`（L83）✅
- scope：`'root' | 'session-maybe' | 'session'`（L85）⚠️（PLAN 写 "root/session" 少了 session-maybe；加载器只碰 root 槽位，无实际影响）
- 实机：探针经 `slots.inject` + `register` 两个 list 槽位渲染成功（§12.4）。
- 调试面：`ctx.slots.snapshot(root?)`、`ctx.slots.entries(key)`、`ctx.slots.subscribe(key, fn)`、`ctx.slots.onEntryError(fn)`（对 V8 故障隔离有用）。

---

## 6. 槽位键位清单与控制台挂载点定案（M1 核心问题）

### 6.1 全部 SlotMap 键（发布树实搜 `interface SlotMap`，20 个文件声明）

| key | kind/scope | 状态 | 出处 |
| --- | --- | --- | --- |
| `root` | single/root | **OCCUPIED**（ui-layout AppFrame；勿注册，第二注册 shadow 它且动态注册 priority 更低 → 页面只剩你的组件） | `$NM/dsh-client-ui-renderer/lib/types/client/registry.d.ts` L20-33 |
| `sidebar` | single/root | **OCCUPIED**（ui-sidebar 壳） | `$NM/dsh-client-ui-layout/lib/types/client/index.d.ts` L44-52 |
| `main` | keyed/root | 布局中央面板 | 同上 L53-58 |
| `rightbar` | single/root | OCCUPIED（右栏） | 同上 L70-84 |
| `shell.overlay` | **list**/root | **additive**（全帧浮层，click-through） | 同上 L85-101 |
| `shell.leading` | single/root | OCCUPIED | 同上 L102-107 |
| `sidebar.brand.mark` / `sidebar.brand.name` | single/root | OCCUPIED（有 fallback 语义） | `$NM/dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts` L31-50 |
| `sidebar.toggle.badge` | single/root | additive-able | 同上 L24-30 |
| `sidebar.panellist` | **list**/root | additive（全局面板行） | 同上 L51-58 |
| `sidebar.workspaces` | single/root | OCCUPIED（ui-workspace） | 同上 L59-66 |
| `sidebar.settings` | single/root | OCCUPIED（ui-settings 触发行+面板） | 同上 L67-74 |
| **`sidebar.footer.action`** | **list**/root | **additive（侧栏底部 Settings 旁；owner props `{ wide: boolean }`）** | 同上 L76-80、L128-131 |
| `settings.launcher` | single/root | OCCUPIED | `$NM/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts` L14-26 |
| `settings.trigger` | single/root | OCCUPIED | 同上 L27-36 |
| `settings.header` | single/root | additive-able | 同上 L37-46 |
| `settings.action` | **list**/root | additive（设置面板头动作） | 同上 L47-56 |
| `settings.close` | single/root | additive-able | 同上 L57-66 |
| **`settings.section`** | **list**/root | **additive（一个 entry = 一个设置页分区）** | 同上 L73-85 |
| `settings.plugins.tab` | **list**/root | additive（内置插件页的 tab） | 同上 L86-100 |
| `settings.onboarding` | **list**/root | additive | 同上 L101-119 |
| `settings.general.item` | **list**/root | additive（General 分区里的单行偏好） | 同上 L120-133 |

（另有一些非本清单关注面的声明：ui-chat / ui-tool / ui-workspace / ui-cordis 等包内槽位，见各自 `lib/types/client/**/slots*.d.ts`，与换肤控制台无直接关系。）

### 6.2 `settings.section` 真实注册形态（浏览器实测通过）

- **声明**（`$NM/dsh-client-ui-settings/lib/types/client/contract/slots.d.ts` L60-85）：
  list/root；options 的 `id` = 分区键（nav 过滤用）、`order` = nav 位置、`label` = 注册者本地化文案
  （**locale 变化时注册者要重新注册新文案**——壳不订阅 locale 状态，靠 ledger bump 触发重渲染）。
- **owner props**（`SettingsSectionOwnerProps`，同文件 L142-147）：`{ close: () => void }`（关设置面板）。
- **渲染上下文**：分区渲染在设置面板内容列；壳只提供导航与模态，文案/内容全归注册者。组件框架就是
  baseline 模块表里的 React（无自建框架要求）。
- **实机**：探针注册 `id:"dsh-eac-probe", order:90, label:"Probe"` 后，设置导航出现 "Probe" 项，点击后
  分区内容 `dsh-eac probe settings section` 实际渲染（容器 `[data-slot="settings.section"]`；截图
  `.verify/probe-settings-section.png`）。
- **dispose**：`register` 返回的 disposer（或 `slots.inject` 的外层 disposer）随 fiber 卸载级联，导航项与内容一并消失。

### 6.3 "sidebar 入口项"定案 ⚠️（PLAN §2.5 需修正）

- ❌ **不能注册 `sidebar` 槽位本体**：single + 已被 ui-sidebar 占用，动态注册会以更低 priority shadow 胜出，
  把整个侧栏顶掉（ui-layout 对 `root` 的同款警告原文见 §6.1 表）。`settings.launcher`/`settings.trigger` 同理。
- ✅ **可行替代（实测通过）**：`sidebar.footer.action`（list，additive）——侧栏底部 "设置" 旁的图标/动作位，
  owner props 只有 `{ wide }`。探针在此渲染了 "probe" 字样。
- 控制台入口的最终建议：**`settings.section`（主界面，必选）+ `sidebar.footer.action`（可选快捷入口）**；
  全帧浮层提示用 `shell.overlay`（list）。

### 6.4 降级链评估（PLAN §2.8）

`settings.section` → `sidebar.footer.action` → 独立 route（`ctx.webServer.register` + 自绘页面）：
前两级已实测可行；第三级无需槽位（探针 host 半的 `/dsh-eac-probe/ping` 路由已证明 `webServer.register` 实机可用），
但独立 route 拿不到 client 槽位渲染上下文，仅作兜底。

---

## 7. 主题 API（`ctx.theme`，ThemeRuntime）

来源：`$NM/dsh-client-ui-theme/lib/types/client/index.d.ts`（类型）+ `lib/client.js` L1581（服务装配）。

- `ctx.theme.register(definition: ThemeDefinition) → disposer`（L161）：`{ id, colorScheme: 'light'|'dark', tokens: ThemeTokens }`；
  `ThemeTokens = Record<string, string>`（`--dsw-alias-*` 别名层覆盖，单值）；重复 id 抛错（内置 light/dark 占位，
  `system` 是偏好值不是可注册 id）；dispose 掉当前激活主题会把偏好重置回默认。
- `ctx.theme.overrideTokens(source, tokens: ThemeTokenOverrides) → disposer`（L178）：⚠️ `ThemeTokenOverrides =
  Record<string, { light: string; dark: string }>`（`ThemeTokenModes` L34-40、别名 L41）——**每个 token 必须同时给亮暗两值**（值不随 scheme 变化也要重复填）；
  同 source 再调 = 替换该层并重新置顶；裸字符串值抛教学错误。
- `ctx.theme.setTheme(id)`（L143）：唯一偏好写入口；未知 id 抛错；接受 `system`。
- `ctx.theme.getTheme(): ThemeSnapshot`（L131-137 快照读）；`theme/change` 事件（Context Events 声明，payload = ThemeSnapshot）✅；
  另有 `setFontSize(px)`、`exportInspectTokens()`（token 目录自省，带 name/description/cssVariable）。
- 未实测调用（源码级核对）；token 名以 `exportInspectTokens()` 运行期输出为准，T2.5 实现时先打一份目录。

---

## 8. 设置系统（host + client）

### 8.1 host：`ctx.settings.configure` ✅

- `ctx.settings.configure({ auto?: boolean }, owner?: Fiber) → disposer`（`$NM/dsh-settings/lib/types/index.d.ts` L80-88）。
  注册本 entry 的设置页策略；`auto: false` = 不自动生成设置页（ui-theme 的用法）。
- **命名空间 == Loader entry id**（= cordis.patch.yml 插入行的 `id`）：update/replace/mutate 的
  `@param ns Profile entry id` 注释（`$NM/dsh-settings/lib/types/index.d.ts` L98/L104/L110；
  `SettingsDescriptor.ns` 字段本身无注释，L8-18）；ui-theme 的 patch 行 id 为 `ui-theme`、
  其 `THEME_SETTINGS_NAMESPACE = "ui-theme"`（`lib/index.js` L11 + `lib/client.js` L992）。
  → 加载器用行 id `ui-skin-loader` 后，host 写、client 读（`configForms.get("ui-skin-loader")`）自动对上。
- 写接口：`update/replace/mutate(ns, …, expectedRevision?)`，冲突抛 `SettingsConflictError`（code `SETTINGS_CONFLICT`）。

### 8.2 client：`ctx.configForms` ✅

来源：`$NM/dsh-client-ui-settings/lib/types/client/config-form.d.ts`（ConfigForms L131-157）+ `config-form-types.d.ts`（ConfigForm L36-93）。

- `ctx.configForms.get<T>(entryId): ConfigForm<T>`（L142）：
  - `getSnapshot(): { status: 'loading'|'ready'|'unavailable', value, base, user, revision, writable, mode: 'host'|'memory' }`（稳定引用，uSES 友好）
  - `subscribe(listener) → disposer`
  - `set(field, value) → Promise<boolean>` / `unset(field)` / `mutate(ops: SettingsPathOpView[], expectedRevision?)`：
    排队顺序写、每次带最新 revision 栅栏、被拒时回读恢复；`memory` 模式（非 loopback 页面）不可写。
  - 默认按该命名空间的 wire schema 校验段落；自定义窄化才需要 `decode`。
- `ctx.configForms.whileServed(namespaces, register) → disposer`（L156）：跟随命名空间是否被 host 提供而挂/撤注册
  （跨插件设置页依赖的正确姿势；caller 自行包 ctx.effect）。
- 装配方（提供 `configForms` 服务的插件）：`$NM/dsh-client-ui-settings/lib/client.js` L1505-1525。

### 8.3 跨标签页同步 ✅

- 事件 `settings/document-updated`（remote 事件表 `$NM/dsh-api-remotes/lib/types/remote-events.d.ts` L85；emit 模式）。
- client 侧消费即 `ctx.remote.$on("settings/document-updated", () => mirror.load())`
  （`$NM/dsh-client-ui-settings/lib/client.js` L1512）。**加载器跨标签页重放切换（PLAN V7）直接订阅同一事件即可。**

---

## 9. 启停粒度与插件管理（disabled / fiber dispose）✅

- 插件管理器（`$NM/dsh-plugin-manager/README.md`）：toggle 只改 profile `cordis.patch.yml` 中**最后一个匹配行**的
  `disabled` 字段（无匹配则追加 override）；bundle toggle 改 `package.json` 的 `dsh.profile.bundles` 有序列表；
  禁用保留依赖，启用追加到列表尾（可能改变配置优先级）。
- HMR 开启时配置变更即时生效（实测 §12.4 第 0 步：add 后未重启，旧进程即刻提供探针路由）；关闭 HMR 则重启后生效。
- disable → fiber dispose → `ctx.effect` 登记的副作用逆序释放（§2 第 4 步；cordis 引用见彼处）。

---

## 10. i18n（`ctx.locale`）✅

来源：`$NM/dsh-client-locale/lib/types/client/index.d.ts`；运行时 `lib/client.js` L1387+。

- `ctx.locale.register(ns, { en: dict, zh: dict }) → disposer`（typed，L199；dict 缺键回退 en，双语齐备强制）
- `ctx.locale.register(ns, "zh", dict) → disposer`（untyped 单 locale 形式，L209；语言包用）
- `ctx.locale.bind(ns) → Translate`（L219/226；**同一 ns 重复 bind 返回同一函数**（memoization 安全）；
  `(key, params?) => string`，`{name}` 模板；查键链：active ns → `common` ns → key 本身）
- `locale/change` 事件：仅激活语言切换时发；字典注册不发（渲染刷新走 LocaleFace revision）。
- 命名空间表 `LocaleNamespaceMap` 由声明合并扩（同 SlotMap 模式）；未合并 ns 用 untyped 形式即可。
- 运行时校验：locale id 必须 BCP 47 风格；重复 (ns, locale) 抛错。

---

## 11. HTTP（`ctx.webServer`）✅

来源：`$NM/dsh-host-webserver/lib/types/index.d.ts`。**实测：探针路由 200。**

- `ctx.webServer.register({ kind: 'exact'|'prefix', path, handler }) → disposer`（L90）；同 (kind,path) 重复抛错；
  handler `(req, res) => void | Promise<void>`，持完整响应生命周期（可 SSE 长连）。
- `ctx.webServer.registerFallback(handler) → disposer`（L106）：**全局一个 owner**，第二个注册抛错（SPA dist 占用中——
  加载器别想 fallback 席）。
- `ctx.webServer.registerUpgrade({ path, handler })`（WebSocket upgrade，exact path）；`tapIndex(fn)`（index.html 变换）。
- index 注入行事件 `webserver/index-inject`（table.push 语义；ui-theme 用它注入首屏主题脚本，`{kind:'style'|'script', placement, text}`）——
  **换肤首屏防闪烁可复用此机制**（boot 阶段注入 `<style>`，见 `$NM/dsh-client-ui-theme/lib/index.js` L60-84）。

---

## 12. 安装链路（`dsh plugin`）✅ + 兼容性闸门 ⚠️

### 12.1 CLI

- `dsh plugin --profile <name> <pnpm-args…>`：**转发给 pnpm**（在 profile 目录内执行），DSH 只拦截
  `version-exemptions / allow-version / revoke-version` 三个自有命令。转发证据链：命令注册及描述
  "manage a profile's plugins by forwarding the remaining arguments to pnpm in the profile directory"
  （`$NM/dsh/lib/bin.js` L114-115）→ `runPlugin` 调 `runPluginCommand`（`$NM/dsh/lib/plugin-DkYIj96-.js` L58-78，
  调用点 L63；`runPluginCommand` 自 `$NM/dsh-plugin-manager/operations` 导入，L6）→ 实际执行 pnpm 的进程创建
  `$NM/dsh-plugin-manager/lib/index.js` L517 `execa(options.command ?? "pnpm", [...args…], { cwd: dir, … })`。
- `add` spec 支持：npm 包名、**本地路径**（实测 `link:` 方式装入）、git 地址、tarball；git+tarball 的兼容性判定在
  装完后做（失败会恢复 manifest+lockfile）。
- profile 目录：`$DSH_HOME/profiles/<name>/`（`package.json` + `cordis.yml`（勿改）+ `cordis.patch.yml`（用户层）+
  `pnpm-workspace.yaml`（`nodeLinker: hoisted`）+ `.plugin-manager/`）。

### 12.2 兼容性闸门（重要修正）

- **安装前检查的是 `peerDependencies` 中名为 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的条目**
  （semver `satisfies(runtimeVersion, range, { includePrerelease: true })`），不满足 → 拒绝安装（exit 1，零下载）。
  `engines.dsh` 是声明性的，**安装器不强制**（`$NM/dsh-package-manifest/README.zh.md` "已知限制"）。
  实现：`$NM/dsh-app-boot/lib/index.js` L286-313 `evaluatePluginCompatibility`；豁免走 profile 的 `compatibility.json`
  + `dsh plugin allow-version <pkg@ver> --dsh-version <runtime> --accept-risk`。
- ⚠️ **闸门只作用于声明了 peer 的包**：`evaluatePluginCompatibility` 开头
  `if (!Object.hasOwn(fields, "peerDependencies")) return void 0;`（同文件 L289）——完全不声明 peerDependencies
  的包**跳过检查而非被拒**。准确规则：**凡声明了 `@deepseek-ai/dsh*` peer，其 semver 必须满足运行时版本
  （includePrerelease），否则安装被拒**。
- → 推荐动作不变：加载器与皮肤包声明 `peerDependencies: { "@deepseek-ai/dsh": "0.1.7-rc.2" }`（或兼容 semver），
  主动参与闸门校验并向安装方表达兼容承诺。
- pnpm 11 阻止依赖构建脚本时安装报 `pendingBuilds`；我们的包无构建脚本，不受影响；git 插件需在 profile
  `pnpm-workspace.yaml` 的 `allowBuilds` 里放行 prepare。

### 12.3 add/remove 的实际文件效果（实测）

- add：`package.json` dependencies 加 `"<pkg>": "link:<abs path>"`；`dsh.profile.bundles` **自动追加**（安装即启用）。
- remove：bundles 移除该包 → 卸载其运行时贡献 → pnpm remove（`$NM/dsh-plugin-manager/README.md` "Failure behavior"；
  顺序固定，前步失败停止后步）。
- ⚠️ 小坑：remove 成功后 hoisted 布局下可能残留 `node_modules/@scope/pkg` 目录（下次包操作时剪除）；
  已实测残留不参与 boot（graph 与路由恢复干净）。

### 12.4 探针全流程实测记录（0.1.7-rc.2，隔离 DSH_HOME）

| 步骤 | 命令/动作 | 结果 |
| --- | --- | --- |
| 1 | `npm i @deepseek-ai/dsh@0.1.7-rc.2`（`.verify/probe/`） | 520 包；`dsh-win32-process` **单拷贝**（R9 未复现） |
| 2 | `npx dsh --profile web --no-open --port 18517` | 日志仅 1 行 URL，**无 error/warn**；UI 200（token→cookie 认证） |
| 3 | `dsh plugin --profile web add <本地路径>` | pnpm `link:` 装入；bundle 自动启用；**运行中的旧进程经 HMR 即刻热应用**（探针路由当场 200） |
| 4 | 杀残留进程后重启 boot | 无 error/warn；`/dsh-eac-probe/ping` → 200 `{"ok":true,…,"from":"host-half"}`；boot graph 含探针 entry；client bundle 经 `/plugins/??@dsh-eac/probe-plugin/client.js&rev=…` 正常下发 |
| 5 | 浏览器实测（token 打开 UI） | `sidebar.footer.action` 注册即时渲染（`probeFooter:true`）；`window.__ModuleLoader__.mode === "live"`；设置导航出现 "Probe" 分区，点击后 `[data-slot="settings.section"]` 内渲染探针内容（截图 `.verify/probe-settings-section.png`） |
| 6 | `dsh plugin --profile web remove "@dsh-eac/probe-plugin"` | bundles 移除 + 依赖移除 |
| 7 | 重启 boot | 无 error/warn；ping 404；boot graph 零探针残留 |

---

## 13. 坑清单（实现时注意）

1. **Windows 下 TaskStop/杀 shell 不一定杀掉 node 子进程**：端口 18517 可能被旧 boot 占用 → 新 boot 报
   `EADDRINUSE`（webserver 是 required 插件，boot 失败）。收尾用 `netstat -ano | grep <port>` + `taskkill //F //PID //T`。
2. **token 认证**：UI/`/api` 需要 boot 日志里的 `?token=` 换 cookie（`/` 裸访问 401）；脚本化验证先 GET
   `/?token=…` 存 cookie 再带 cookie 访问。
3. **`require` 限定**：client bundle 内只能 require 模块表词（§3.3）与 graph 行包名；Node 内置/任意 npm 包一律不行
   （throw loud）。CSS 也要走 factory 闭包内注入（材料化才执行）。
4. **patch 替换而非合并**：patch 行覆盖目标行整段 `config`；给既有行补配置时要把该行关心的全部键重写全
   （dsh-base 头注释明确此规则）。
5. **`registerFallback` 席位被 SPA 占用**；`root`/`sidebar`/`main` 不得注册（shadow/占用见 §6.1）。
6. **多注册 label 的 locale 刷新**：`settings.section` 的 label 不随 locale 自动变；换语言要重新 register（或用 thunk
   label——`SlotLabel = string | (() => string)`，thunk 在读取时求值并跟随 locale，GeneralSection 的用法）。
7. **settings `memory` 模式**：非 loopback 页面 configForms 只读（`writable:false`）——本地验证恒为 host 模式，无碍。
8. **包名撞名**：`@deepseek-ai/dsh-skin-switch` 已被 EAC 私有插件占用（PLAN §0.2 已记）；兼容性闸门只认
   `@deepseek-ai/dsh*` 前缀 peer，第三方 scope（`@dsh-eac/*`）声明 peer `@deepseek-ai/dsh` 即可被闸门校验。

---

## 14. 证据索引（均在 loader 仓库 `.verify/`，不入库）

| 证据 | 路径 |
| --- | --- |
| 基线 boot 日志（无 error/warn，1 行） | `.verify/boot-rc2.log` |
| 探针期 boot 日志（含加载探针后的干净 boot） | `.verify/boot-probe.log` |
| remove 后 boot 日志（无 error/warn） | `.verify/boot-after-remove.log` |
| 探针插件源（本笔记 §1 的实物） | `.verify/probe-plugin/{package.json,cordis.patch.yml,lib/index.js,lib/client.js}` |
| 设置分区渲染截图 | `.verify/probe-settings-section.png` |
| 隔离 DSH_HOME（profiles/web 等全部数据） | `.verify/dsh-home/` |
| 失败启动完整诊断样例（EADDRINUSE） | `.verify/dsh-home/logs/startup-2026-09-25T12-43-46.266Z-*.log` |

## 15. 未覆盖项（对 T2.3 无阻塞）

- `theme.register` / `overrideTokens` 未在浏览器实测调用（类型 + shipped 实现已核对；token 名清单运行期打点）。
- `session`/`session-maybe` scope 槽位的会话绑定细节（加载器只用 root 槽位）。
- Electron/桌面载体的 `globalThis.dshDesktop` 载体接口（本项目只面向 web profile）。
