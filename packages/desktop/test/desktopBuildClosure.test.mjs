import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

test("root and package manifests expose only Desktop product builds", async () => {
  const { scripts } = await json("package.json");
  assert.equal(scripts.build, "pnpm --filter @zcode/desktop build");
  assert.equal(scripts["build:bootstrap"], "pnpm build");
  for (const name of [
    "dev:web",
    "dev:server",
    "dev:desktop:remote-prod",
    "build:zcode",
    "prepare:remote-assets",
    "bootstrap:with-remote",
  ])
    assert.equal(scripts[name], undefined, name);
  const desktop = await json("packages/desktop/package.json");
  assert.equal(desktop.scripts["prepare:remote-assets"], undefined);
  for (const path of [
    "packages/web/package.json",
    "packages/server/package.json",
    "packages/zcode-server-cli/package.json",
  ]) {
    const manifest = await json(path);
    for (const name of ["dev", "build", "build:remote", "stage"])
      assert.equal(manifest.scripts[name], undefined, `${path}:${name}`);
  }
});

test("runtime preparation defaults to local resources even with old remote env", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "desktop-build-plan-"));
  try {
    const log = resolve(directory, "commands");
    await writeFile(
      resolve(directory, "pnpm"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BUILD_TEST_LOG"\n',
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      ["packages/desktop/scripts/prepare-runtime-assets.mjs"],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH}`,
          BUILD_TEST_LOG: log,
          ZCODE_TARGET_OS: "linux",
          ZCODE_TARGET_ARCH: "x64",
          ZCODE_SKIP_REMOTE_ASSETS: "0",
          ZCODE_BOOTSTRAP_WITH_REMOTE: "1",
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const commands = (await readFile(log, "utf8")).trim().split("\n");
    assert.ok(commands.includes("prepare:agent-bundle"));
    assert.ok(commands.includes("prepare:native-search"));
    assert.ok(
      commands.every((command) => !command.includes("remote")),
      commands.join("\n"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("retired direct distribution scripts reject before preparing assets", () => {
  for (const script of [
    "scripts/build-zcode.mjs",
    "scripts/prepare-prebuilds.mjs",
    "scripts/dev-desktop-remote-prod.mjs",
  ]) {
    const result = spawnSync(process.execPath, [script, "--help"], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0, script);
    assert.match(result.stderr, /Desktop-only/, script);
  }
  const bootstrap = spawnSync(process.execPath, ["scripts/bootstrap.mjs", "--with-remote"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(bootstrap.status, 0);
  assert.match(bootstrap.stderr, /Desktop-only/);
});

test("legacy runner rejects only product --web and delegates other Agent text unchanged", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "desktop-cli-runner-"));
  try {
    await mkdir(resolve(directory, "bin"));
    await mkdir(resolve(directory, "agent"));
    await writeFile(resolve(directory, "package.json"), JSON.stringify({ version: "test" }));
    await writeFile(
      resolve(directory, "bin/zcode.mjs"),
      await readFile(resolve(root, "scripts/zcode-distribution/runner.mjs")),
    );
    await writeFile(
      resolve(directory, "agent/zcode.cjs"),
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));",
    );
    for (const args of [["--web"], ["--web", "--help"]]) {
      const result = spawnSync(process.execPath, [resolve(directory, "bin/zcode.mjs"), ...args], {
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Desktop-only/);
    }
    for (const args of [["--", "--web"], ["prompt containing --web"], ["--help"]]) {
      const result = spawnSync(process.execPath, [resolve(directory, "bin/zcode.mjs"), ...args], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), args);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Agent build cannot reuse stale outputs through old bootstrap env", async () => {
  const source = await readFile(resolve(root, "scripts/build-desktop-agent-cli.mjs"), "utf8");
  assert.ok(!source.includes("ZCODE_BOOTSTRAP_WITH_REMOTE"));
  for (const dependency of [
    "@zcode/core",
    "@zcode/bootstrap",
    "@zcode/adapters",
    "@zcode/contracts",
    "@zcode/shared-types",
    "@zcode/dynamic-workflow-runtime",
    "@zcode/node-repl-host",
    "@zcode/browser-use-plugin",
  ])
    assert.ok(source.includes(dependency), dependency);
  const prepare = await readFile(
    resolve(root, "packages/desktop/scripts/prepare-agent-node-bundle.mjs"),
    "utf8",
  );
  assert.ok(!prepare.includes("ZCODE_BOOTSTRAP_WITH_REMOTE"));
  for (const resource of [
    "stageAgentBundle",
    "bundled-skills",
    "docs/recording.md",
    "dist/mcp/server.js",
  ])
    assert.ok(prepare.includes(resource), resource);
});

test("retired server remote builder and server-cli stage reject direct execution", () => {
  for (const script of [
    "packages/server/build-remote.ts",
    "packages/zcode-server-cli/src/packaging/stageCli.ts",
  ]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", script, "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Desktop-only/, script);
  }
});

test("bootstrap installs and delegates to the single Desktop build without remote assets", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "desktop-bootstrap-plan-"));
  try {
    const log = resolve(directory, "commands");
    await writeFile(
      resolve(directory, "pnpm"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BUILD_TEST_LOG"\n',
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, ["scripts/bootstrap.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        BUILD_TEST_LOG: log,
        ZCODE_BOOTSTRAP_WITH_REMOTE: "1",
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readFile(log, "utf8")).trim().split("\n"), [
      "install",
      "run build:bootstrap",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("same-source Agent staging replaces stale remote binaries and metadata", async () => {
  const { stageAgentBundle, resolveAgentBundlePaths } =
    await import("../scripts/stage-agent-bundle.mjs");
  const directory = await mkdtemp(resolve(tmpdir(), "desktop-agent-stage-"));
  try {
    const paths = resolveAgentBundlePaths({ repoRoot: directory, platformKey: "linux-x64" });
    await mkdir(resolve(directory, "apps/zcode-cli/packages/cli/dist"), { recursive: true });
    await mkdir(paths.glmDir, { recursive: true });
    await writeFile(paths.cliBundlePath, "CURRENT_SOURCE_BUNDLE");
    await writeFile(resolve(paths.glmDir, "zcode-agent"), "OLD_REMOTE_BINARY");
    await writeFile(paths.stagedMetaPath, "OLD_META");
    stageAgentBundle({ repoRoot: directory, platformKey: "linux-x64", log: () => {} });
    assert.equal(await readFile(paths.stagedBundlePath, "utf8"), "CURRENT_SOURCE_BUNDLE");
    assert.deepEqual(JSON.parse(await readFile(paths.stagedMetaPath, "utf8")), {
      runtime: "electron-node",
      entry: "zcode.cjs",
      platform: "linux-x64",
      source: "apps/zcode-cli/packages/cli/dist/zcode.cjs",
    });
    await assert.rejects(readFile(resolve(paths.glmDir, "zcode-agent")), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dynamic external runtime closure keeps dependencies and skips absent optional packages", async () => {
  const { collectRuntimeModuleClosureEntries } =
    await import("../scripts/runtime-dependency-closure.mjs");
  const directory = await mkdtemp(resolve(tmpdir(), "desktop-runtime-closure-"));
  try {
    for (const [name, dependencies] of [
      ["root-package", { leaf: "1.0.0" }],
      ["leaf", {}],
    ]) {
      const packageRoot = resolve(directory, "node_modules", name);
      await mkdir(packageRoot, { recursive: true });
      await writeFile(resolve(packageRoot, "index.js"), "");
      await writeFile(
        resolve(packageRoot, "package.json"),
        JSON.stringify({
          name,
          main: "index.js",
          dependencies,
          optionalDependencies: { "missing-optional": "1.0.0" },
        }),
      );
    }
    const closure = collectRuntimeModuleClosureEntries(["root-package"], [directory]);
    assert.deepEqual(
      closure.map((entry) => entry.moduleName),
      ["root-package", "leaf"],
    );
    assert(closure.every((entry) => entry.sourceModulePath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
