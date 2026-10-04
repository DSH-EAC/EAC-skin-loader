/**
 * 皮肤制品清单契约测试（docs/git-distribution.md §3.3）。
 *
 * 提交进 git 的 `packages/loader/skin-manifest.json` 是补齐器的唯一下载来源：
 * - 必须能被 parseSkinsManifest 通过（fail-closed 闸口的同一套校验）；
 * - 必须覆盖工作区全部 13 款公约皮肤（包名 + 稳定皮肤 id 一一对应）；
 * - 发布形态（allowInsecureUrl 未置位）必须全部是 https；
 * - 每条制品的版本必须与对应皮肤包 package.json 一致（清单与工作区不漂移）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseSkinsManifest } from "./skins-manifest.ts";

const packageDir = fileURLToPath(new URL("../../", import.meta.url));
const skinsRoot = fileURLToPath(new URL("../../../skins/", import.meta.url));

const manifestRaw = JSON.parse(readFileSync(`${packageDir}skin-manifest.json`, "utf8"));

test("committed skin manifest passes the fail-closed validator", () => {
  const parsed = parseSkinsManifest(manifestRaw);
  assert.equal(parsed.ok, true, `manifest rejected: ${parsed.ok ? "" : parsed.error}`);
});

test("committed skin manifest covers every workspace skin package with matching versions", () => {
  const parsed = parseSkinsManifest(manifestRaw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const manifest = parsed.manifest;

  const workspaceSkins = readdirSync(skinsRoot)
    .filter((name) => statSync(`${skinsRoot}/${name}`).isDirectory())
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(`${skinsRoot}/${dir}/package.json`, "utf8"));
      return { dir, name: pkg.name, version: pkg.version, skinId: pkg.dsh?.skin?.id };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));

  assert.equal(manifest.skins.length, workspaceSkins.length);
  const byName = new Map(manifest.skins.map((skin) => [skin.name, skin]));
  for (const workspaceSkin of workspaceSkins) {
    const entry = byName.get(workspaceSkin.name);
    assert.ok(entry, `manifest is missing ${workspaceSkin.name}`);
    assert.equal(entry.version, workspaceSkin.version, `${workspaceSkin.name}: manifest version drift`);
    assert.equal(entry.skinId, workspaceSkin.skinId, `${workspaceSkin.name}: covenant skin id drift`);
  }
});

test("committed skin manifest ships only https release URLs and real checksums", () => {
  const parsed = parseSkinsManifest(manifestRaw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  // 发布清单不得携带 allowInsecureUrl（验证用清单才允许 http/file）。
  assert.equal(manifestRaw.allowInsecureUrl, undefined, "release manifest must not allow insecure URLs");
  for (const skin of parsed.manifest.skins) {
    assert.match(skin.url, /^https:\/\//, `${skin.name}: release URL must be https`);
    assert.match(skin.sha256, /^[0-9a-f]{64}$/, `${skin.name}: sha256 must be 64 hex chars`);
    assert.ok(skin.bytes > 0, `${skin.name}: bytes must be positive`);
    assert.ok(skin.dshPeerRange.length > 0, `${skin.name}: host compat range must be declared`);
  }
});
