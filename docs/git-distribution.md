# Git 分发与皮肤自动补齐——安装契约（Phase 1 冻结）

> 状态：**设计冻结（2026-10-05）**。全部结论来自隔离 `DSH_HOME`（dsh 0.2.0-rc.2 CLI）的实机安装核对，
> 不是路径推断；验证证据见文末「验证记录」。对应目标：`Desktop 添加 github:DSH-EAC/EAC-skin-loader`
> → 加载器安装并启动 → 自动补齐缺失皮肤。

## 1. 基线缺陷（已实机复现）

对 `f2cad50` 直接执行 `dsh plugin --profile web add <仓库根路径>`：

```text
dsh: warning: dsh-ui-skin-loader declares no dsh.bundle — installed as a plain dependency, not a profile layer
```

两个独立缺陷：

1. **根 `package.json` 是开发 workspace 清单**（`dsh-ui-skin-loader` 0.0.0 / private / 无 `dsh.bundle`），
   `github:DSH-EAC/EAC-skin-loader` 解析的就是它 → 安装后不进 `dsh.profile.bundles`，加载器永不挂载。
2. **`lib/` 在 `.gitignore`** → 即便根清单声明了 `dsh.bundle`，git 树里也没有 host/client 入口。

## 2. 宿主安装机制的实测约束（决定结构选型）

| 约束 | 实测证据 |
| --- | --- |
| git 包内**相对 `file:` 子依赖不可用** | `file:packages/loader` → `ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`（按 profile 目录解析，不按包目录）；`file:./vendor/x.tgz` → `ENOENT` |
| git 包内 **URL/tarball 子依赖被禁** | `dependencies: {"@dsh-eac/ui-skin-loader": "http://…"}` → `ERR_PNPM_EXOTIC_SUBDEP`（profile `pnpm-workspace.yaml` `blockExoticSubdeps`） |
| git-hosted `prepare` 被 pnpm 拦截 | 安装失败提示「add the exact key … under allowBuilds」→ 不能把构建寄托在 prepare 上（与计划 §三.1 一致） |
| `files` 白名单对 git 安装生效 | 实测安装产物只含 `files` 列出的路径 → 产物必须**提交进 git** |
| client-modules 的 `nearestPackage` 身份匹配 | 解析文件的最近 `package.json` 的 `name` 必须与 patch 行 `name` 完全一致 → `packages/loader/package.json` 的 name **不可改** |

**结论**：计划 §四.1 的首选形态「独立命名的根目录组合包，**依赖**固定的加载器制品」在宿主 pnpm 配置下
**不可能**——任何形式的子依赖（file/URL/git）都会被上述三条约束拦下。可行替代是同一思想的变体：
**加载器制品随仓内嵌，根组合包通过 patch 以相对路径挂载它**。计划已预见该分支（§四.1「如果该结构无法
满足默认 Git 地址：明确报告原因及证据。提出构建产物分发方案」），本文件即该报告。

## 3. 冻结的分发契约

### 3.1 包身份（保留面全部不变）

| 保留面 | 值 | 说明 |
| --- | --- | --- |
| settings 命名空间 / patch 行 id | `dsh-ui-skin-loader` | 公约保留面，不改 |
| 加载器包名 / 浏览器 ModuleLoader id | `@dsh-eac/ui-skin-loader` | 公约保留面，不改（`packages/loader/package.json` 的 name） |
| locale ns | `dsh-ui-skin-loader/console` | 不改 |
| cordis 服务名 | `uiSkinLoader` | 不改 |
| 皮肤包 / 皮肤 id | `@dsh-eac/skin-*` / `dsh-eac.skin.*` | 13 款，不改 |

**新增**分发身份（此前不存在）：根目录组合包名 `@dsh-eac/skin-loader-pack`——独立命名，与子包不重名。

### 3.2 入口路径

```text
<repo root>/                        ← github:DSH-EAC/EAC-skin-loader 安装的就是这一层
  package.json        name @dsh-eac/skin-loader-pack；dsh.bundle.patch → ./cordis.patch.yml；
                      files 白名单（见 3.3）；peerDependencies 参与兼容闸门
  cordis.patch.yml    - insert: [{ id: dsh-ui-skin-loader, name: "./packages/loader/lib/index.js" }]
  packages/loader/    真加载器源码包（name 保留 @dsh-eac/ui-skin-loader）；
                      lib/ 构建产物**提交进 git**（.gitignore 反豁免）
```

安装后 `dsh.profile.bundles` 追加 `@dsh-eac/skin-loader-pack`；boot 组合时根 patch 插入行
`id: dsh-ui-skin-loader`，client-modules 以相对路径解析到 `packages/loader/package.json`
（name `@dsh-eac/ui-skin-loader`）→ boot graph 行 id 与浏览器 bundle id 一致（实测一致）。

### 3.3 制品来源

- **加载器**：`packages/loader/lib/` 由 `pnpm build` 产出并提交进 git；根包 `files` 白名单
  `packages/loader/lib`、`packages/loader/cordis.patch.yml`、`packages/loader/package.json`。
  安装零构建、零 prepare。
- **皮肤（自动补齐用）**：13 款皮肤**不进** git 安装包（否则 clone 体积不可接受），由补齐器按
  固定清单下载安装。清单由发布管线从真实构建产物生成（Phase 4），字段：
  `name / version / url / sha256 / bytes / dshPeerRange`。首版锁定一个发布集合，不运行时追最新。

### 3.4 安装接口

加载器 host 半（Node 侧）复用宿主 `pluginManager` 服务（dsh-base 已挂 `plugin-manager` 行，
`super(ctx, "pluginManager")`）：

- `listBundles()` → `{name, version, enabled, installed, removable, rows, error?}`——判定缺失；
- `installBundle(spec, options)` → spec 支持 tarball URL / 绝对路径；安装成功自动 select；
- 不自行执行 `pnpm add`，不直写 profile 清单（计划 §一 约束）。

### 3.5 状态存储位置

- 补齐任务状态（待装/装中/成功/失败/已排除）持久化在加载器自有 settings 命名空间
  `dsh-ui-skin-loader` 的新增 volatile 字段（host Config schema 扩展，client 半经
  `configForms.set` 写）——与 `activeSkin`/`faultLog` 同一保留面，不新建命名空间。
- 下载缓存：OS 临时目录下的 `dsh-ui-skin-loader-cache/`（不写 pnpm 包目录、不写 profile）。

## 4. 遗留风险（需用户/团队决策，不在本轮擅自处理）

1. **git fetch 可靠性**：`git fetch --depth 1 origin main` 在本机网络稳定失败
   （`fetch-pack: invalid index-pack output`），而 `--filter=tree:0`、tag fetch、12MB codeload tarball
   均成功。仓内提交的 40MB `.verify/pkgs-v1.1.0-final/*.tgz`（`.gitignore` 列了 `.verify/` 但被
   force-add）是主要体积来源。pnpm 安装器恰用这条失败路径 → **公共 Git 地址在同类网络可能拉不动**。
   建议：把发布产物从 git 树移出（改走 Release 资产）；属仓库历史/流程变更，需授权。
2. **皮肤制品的公共下载地址不存在**：Release 仅 v1.0.0（6 资产）；v1.1.0/v1.2.0 未发布。
   固定清单的 URL 需新发布——**未获许可不发布**，本轮只交付清单生成管线与候选产物。
3. 未发布前不声称公共 Git 地址已修复（计划 §四.4）。

## 5. 验证记录（隔离 DSH_HOME，dsh 0.2.0-rc.2）

| 结构 | git 安装 | bundle 登记 | boot | client bundle | 浏览器 console |
| --- | --- | --- | --- | --- | --- |
| 基线（根=开发清单） | ✓ | ✗ plain dependency | — | — | — |
| A：根包=loader，lib 提交根目录 | ✓ | ✓ | ✓ | 200 / 73562 B | ✓ footer action 渲染 |
| C：根包=`@dsh-eac/ui-skin-loader`，exports→`packages/loader/lib` | ✓ | ✓ | ✓ | 200 / 73562 B | ✓ |
| **D（选定）：根包=`@dsh-eac/skin-loader-pack`，patch 相对路径挂载** | ✓ | ✓ | ✓ 0 error | ✓ | ✓ footer action 渲染 + runtime 启动日志 |
| 组合包 + file/URL 子依赖 | ✗ | — | — | — | — |
