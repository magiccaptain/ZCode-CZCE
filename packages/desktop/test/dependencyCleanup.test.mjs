import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("disabled product packages leave no manifest/typecheck/policy closure", async () => {
  for (const path of ["packages/web/package.json", "packages/zcode-server-cli/package.json"]) {
    await assert.rejects(access(resolve(root, path)), { code: "ENOENT" }, path);
    for (const config of ["package.json", "pnpm-lock.yaml", "architecture-policy.yaml"])
      assert.ok(!(await read(config)).includes(path.replace("/package.json", "")), config);
  }
  const desktop = JSON.parse(await read("packages/desktop/package.json"));
  assert.equal(desktop.dependencies["@zcode/server"], "workspace:*");
  await access(resolve(root, "packages/server/src/remote/index.ts"));
});

test("unused server product executables are removed while stdio and remote contracts remain", async () => {
  for (const path of [
    "packages/server/src/http.ts",
    "packages/server/src/entry-http.ts",
    "packages/server/src/entry-stdio.ts",
    "packages/server/src/index.ts",
    "packages/server/tsup.config.ts",
    "packages/server/buildRemoteValidation.ts",
  ])
    await assert.rejects(access(resolve(root, path)), { code: "ENOENT" }, path);
  const server = JSON.parse(await read("packages/server/package.json"));
  assert.equal(server.exports["."], undefined);
  assert.equal(server.exports["./stdio"], "./src/stdio.ts");
  for (const dependency of ["@hono/node-server", "@hono/node-ws", "hono"])
    assert.equal(server.dependencies[dependency], undefined);
  await access(resolve(root, "packages/server/src/stdioServices.ts"));
});

test("remote-only packaging helpers and archives have no remaining local asset owner", async () => {
  for (const path of [
    "scripts/remote-native-search-tools-config.mjs",
    "scripts/zcode-distribution/assets.mjs",
    "scripts/zcode-distribution/installer.mjs",
    "scripts/zcode-distribution-smoke.mjs",
    "apps/zcode-cli/dependencies/native-search/ripgrep-v13.0.0-10",
  ])
    await assert.rejects(access(resolve(root, path)), { code: "ENOENT" }, path);
  assert.ok(!(await read("apps/zcode-cli/dependencies/native-search/SHA256SUMS")).includes("v13"));
  const retired = await read("scripts/prepare-prebuilds.mjs");
  assert.match(retired, /Desktop-only/);
  assert.ok(!retired.includes("import "));
});

test("no-op Agent telemetry keeps only its public type/API dependencies", async () => {
  const telemetry = JSON.parse(await read("apps/zcode-cli/packages/telemetry/package.json"));
  assert.deepEqual(Object.keys(telemetry.dependencies).sort(), [
    "@opentelemetry/api",
    "@zcode/contracts",
  ]);
  for (const resource of [
    "apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts",
    "apps/zcode-cli/packages/core/src",
    "packages/shared/src/zcode-protocol/index.ts",
    "packages/desktop/scripts/runtime-dependency-closure.mjs",
    "packages/desktop/scripts/prepare-agent-node-bundle.mjs",
  ])
    await access(resolve(root, resource));
});
