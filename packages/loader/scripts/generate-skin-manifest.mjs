/**
 * 固定版本皮肤制品清单生成器（docs/git-distribution.md §3.3，计划 §四「构建与发布管线」）。
 *
 * 从工作区真实构建产物生成 `packages/loader/skin-manifest.json`：
 * 1. 对 packages/skins/<each> 执行 `npm pack`（产物进 <repo>/dist/，gitignored）；
 * 2. 逐个 tarball 计算 SHA256 与字节数（**不得使用零 hash 或占位资产**）；
 * 3. 生成清单：包名 / 版本 / 下载地址 / SHA256 / 字节数 / 宿主兼容范围。
 *
 * 用法：
 *   node scripts/generate-skin-manifest.mjs [--base-url <url>] [--insecure]
 *
 * - --base-url：制品下载地址前缀。缺省 = GitHub Release v<版本> 资产地址
 *   （发布前清单里的 URL 指向未来 Release——**未发布前公共地址不会命中**，属计划 §四.4 的
 *   「本地实现/验证完成 ≠ 发布完成」边界，须在发布后重新生成一次以核对真实 URL）。
 * - --insecure：允许 http/file 下载地址（**仅供隔离验证**；发布清单禁止）。
 *
 * 清单提交进 git 并随包分发（根包 files 白名单）；补齐器运行期只读它。
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const skinsRoot = path.join(repoRoot, "packages", "skins");
const distDir = path.join(repoRoot, "dist");

const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
const hasFlag = (name) => args.includes(name);

const baseUrl = argValue("--base-url");
const insecure = hasFlag("--insecure");

/** GitHub Release 资产缺省前缀（与 dist/ 内 npm pack 产物同名）。 */
function defaultBaseUrl(version) {
  return `https://github.com/DSH-EAC/EAC-skin-loader/releases/download/v${version}/`;
}

async function listSkinDirs() {
  const entries = await readdir(skinsRoot, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
}

/** 从 skin 包 package.json 提取公约 id（dsh.skin.id）；与 src/identity.ts 同源。 */
async function readSkinPackage(dir) {
  const pkgPath = path.join(skinsRoot, dir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const skin = pkg.dsh?.skin ?? {};
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    throw new Error(`${dir}: package.json must declare name/version`);
  }
  if (typeof skin.id !== "string" || skin.id !== `dsh-eac.skin.${dir}`) {
    throw new Error(`${dir}: dsh.skin.id must be "dsh-eac.skin.${dir}" (公约稳定 id)`);
  }
  return { name: pkg.name, version: pkg.version, skinId: skin.id, peer: pkg.peerDependencies?.["@deepseek-ai/dsh"] };
}

async function main() {
  const dirs = await listSkinDirs();
  if (dirs.length === 0) throw new Error("no skin packages found under packages/skins/");
  await mkdir(distDir, { recursive: true });

  const skins = [];
  for (const dir of dirs) {
    const meta = await readSkinPackage(dir);
    process.stdout.write(`packing ${meta.name}@${meta.version} … `);
    execFileSync("npm", ["pack", "--pack-destination", distDir, "--silent"], {
      cwd: path.join(skinsRoot, dir),
      stdio: ["ignore", "ignore", "inherit"],
      shell: process.platform === "win32",
    });
    const tarball = path.join(distDir, `${meta.name.replace(/^@/, "").replace("/", "-")}-${meta.version}.tgz`);
    const info = await stat(tarball);
    if (!info.isFile()) throw new Error(`expected tarball missing: ${tarball}`);
    const { sha256, bytes } = await sha256File(tarball);
    const base = baseUrl ?? defaultBaseUrl(meta.version);
    const url = new URL(tarball.split(/[\\/]/).pop(), base).href;
    skins.push({
      name: meta.name,
      version: meta.version,
      skinId: meta.skinId,
      url,
      sha256,
      bytes,
      dshPeerRange: meta.peer,
    });
    process.stdout.write(`${bytes} B ${sha256.slice(0, 12)}…\n`);
  }

  const loaderPkg = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
  const manifest = {
    manifestVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseSet: `v${loaderPkg.version}`,
    skins,
    ...(insecure ? { allowInsecureUrl: true } : {}),
  };
  const outPath = path.join(packageDir, "skin-manifest.json");
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`\nwrote ${outPath} (${skins.length} skins, releaseSet ${manifest.releaseSet})\n`);
  if (insecure) {
    process.stdout.write("WARNING: allowInsecureUrl=true — 验证用清单，禁止作为发布清单提交。\n");
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
