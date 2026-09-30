import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

// 模拟 Desktop 最终 spawn 的同源能力，必须早于实际 CLI 模块加载。
process.env.ZCODE_PRODUCT_PLUGIN_MARKETPLACE_ENABLED = "false";
const adapters =
  await import("../../../apps/zcode-cli/packages/adapters/src/plugins/marketplace.js");
const zip = await import("../../../apps/zcode-cli/packages/adapters/src/plugins/zip-source.js");
const github =
  await import("../../../apps/zcode-cli/packages/adapters/src/plugins/github-archive-source.js");
const partitions =
  await import("../../../apps/zcode-cli/packages/adapters/src/plugins/official-marketplace.js");
const cli = await import("../../../apps/zcode-cli/packages/bootstrap/src/plugins.js");
const protocol =
  await import("../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/plugins.js");
const references =
  await import("../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol/plugin-reference-catalog.js");
const { withPluginStorageLock } =
  await import("../../../apps/zcode-cli/packages/bootstrap/src/lib/plugin-storage-lock.js");

test("CLI startup captures disabled capability; direct and queued old operations never fetch/git/install", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-market-cli-"));
  const home = process.env.HOME;
  const previousPath = process.env.PATH;
  process.env.HOME = root;
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end(JSON.stringify({ name: "old", plugins: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/market.json`;
  try {
    const bin = join(root, "bin");
    const gitMarker = join(root, "git-called");
    await mkdir(bin);
    await writeFile(
      join(bin, "git"),
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(gitMarker)}, 'called'); process.exit(1);\n`,
      { mode: 0o700 },
    );
    process.env.PATH = `${bin}:${previousPath}`;
    const storageRoot = join(root, "storage");
    await mkdir(storageRoot);
    const old = JSON.stringify([
      {
        id: "old",
        name: "old",
        source: { source: "url", url },
        addedAt: "2024-01-01T00:00:00.000Z",
        pluginCount: 0,
      },
    ]);
    await writeFile(join(storageRoot, "known_marketplaces.json"), old);
    // 修改继承 env 不得把已启动的 CLI 重新启用。
    process.env.ZCODE_PRODUCT_PLUGIN_MARKETPLACE_ENABLED = "true";
    const input = {
      storageRoot,
      source: { source: "url" as const, url },
      marketplace: "old",
      name: "old",
    };
    for (const operation of [
      () => adapters.addMarketplace(input),
      () => adapters.addMarketplace({ ...input, source: { source: "git", url } }),
      () => adapters.updateMarketplace(input),
      () => adapters.removeMarketplace(input),
      () => adapters.ensureMarketplaceManifestAvailable(input),
      () => adapters.installMarketplacePlugin(input),
      () => adapters.validateMarketplacePlugin(input),
      () => adapters.describeMarketplacePlugin(input),
      () => adapters.validateMarketplaceSource(input),
      () => zip.resolveHttpZipSource({ url }),
      () => github.resolveGitHubArchiveSource({ url }),
    ])
      await assert.rejects(operation, /PLUGIN_MARKETPLACE_UNAVAILABLE/);
    assert.throws(
      () =>
        partitions.writeCdnOfficialMarketplacePartitionSync({
          storageRoot,
          manifest: { name: "zcode-plugins-official", plugins: [] },
        }),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
    );
    let release!: () => void;
    const hold = withPluginStorageLock(
      storageRoot,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const queued = withPluginStorageLock(storageRoot, () =>
      adapters.installMarketplacePlugin(input),
    );
    const rejected = assert.rejects(queued, /PLUGIN_MARKETPLACE_UNAVAILABLE/);
    release();
    await hold;
    await rejected;
    const options = {
      pluginStorageRoot: storageRoot,
      workingDirectory: root,
      source: url,
      marketplace: "old",
      pluginName: "old",
      pluginId: "old@old",
      dryRun: true,
    };
    assert.throws(() => cli.getZCodePluginsOverview(options), /PLUGIN_MARKETPLACE_UNAVAILABLE/);
    for (const operation of [
      () => cli.addZCodePluginMarketplace(options),
      () => cli.removeZCodePluginMarketplace(options),
      () => cli.updateZCodePluginMarketplace(options),
      () => cli.installZCodeMarketplacePlugin(options),
      () => cli.updateZCodeMarketplacePlugin(options),
      () => cli.validateZCodePlugin(options),
      () => cli.describeZCodePlugin(options),
      () => references.resolveSuggestedPluginReference({} as never, {}),
      () => protocol.getPluginsOverview({} as never, {}),
    ])
      await assert.rejects(operation, /PLUGIN_MARKETPLACE_UNAVAILABLE/);
    assert.equal(requests, 0);
    await assert.rejects(() => readFile(gitMarker), { code: "ENOENT" });
    assert.equal(await readFile(join(storageRoot, "known_marketplaces.json"), "utf8"), old);
    assert.deepEqual(await readdir(storageRoot), ["known_marketplaces.json"]);
    // 已安装目录的 manifest/skills/MCP 由 loader 原样读取，不依赖 marketplace overview。
    const local = join(root, "local-plugin");
    await mkdir(join(local, ".zcode-plugin"), { recursive: true });
    await mkdir(join(local, "skills", "local-skill"), { recursive: true });
    await writeFile(
      join(local, ".zcode-plugin", "plugin.json"),
      JSON.stringify({
        name: "local",
        skills: ["skills"],
        mcpServers: { fixture: { command: "node", args: ["fixture.mjs"] } },
      }),
    );
    await writeFile(
      join(local, "skills", "local-skill", "SKILL.md"),
      "---\nname: local-skill\ndescription: local fixture\n---\nlocal\n",
    );
    await mkdir(join(root, ".zcode", "cli"), { recursive: true });
    await writeFile(
      join(root, ".zcode", "cli", "config.json"),
      JSON.stringify({
        plugins: {
          dirs: [local],
          extraKnownMarketplaces: { old: { source: { source: "url", url } } },
        },
      }),
    );
    const loaded = cli.resolveZCodePlugins({
      workingDirectory: root,
      pluginStorageRoot: storageRoot,
      officialPluginRoots: [],
    });
    const installed = loaded.plugins.find((plugin) => plugin.id === "local@inline");
    assert.ok(installed, JSON.stringify(loaded.diagnostics));
    assert.equal(installed.skillCount, 1);
    assert.ok(installed.mcpServerNames.includes("plugin:local:fixture"));
    const localOptions = {
      workingDirectory: root,
      pluginStorageRoot: storageRoot,
      officialPluginRoots: [],
      pluginId: "local@inline",
    };
    await cli.configureZCodePlugin({ ...localOptions, options: { fixture: "local-value" } });
    assert.equal(
      JSON.parse(await readFile(join(root, ".zcode", "cli", "config.json"), "utf8")).plugins
        .options["local@inline"].fixture,
      "local-value",
    );
    await cli.resetZCodePluginConfig(localOptions);
    await cli.setZCodePluginEnabled({ ...localOptions, plugin: "local@inline", enabled: false });
    assert.equal(
      cli.listZCodePlugins(localOptions).plugins.find((plugin) => plugin.id === "local@inline")
        ?.enabled,
      false,
    );
    await cli.setZCodePluginEnabled({ ...localOptions, plugin: "local@inline", enabled: true });
    assert.equal(
      cli.listZCodePlugins(localOptions).plugins.find((plugin) => plugin.id === "local@inline")
        ?.enabled,
      true,
    );
    const { createSkillsService } = await import("../src/skills/skillsService.js");
    for (const [path, name] of [
      [join(root, ".zcode", "skills", "user-skill"), "user-skill"],
      [join(root, "workspace", ".zcode", "skills", "workspace-skill"), "workspace-skill"],
    ]) {
      await mkdir(path!, { recursive: true });
      await writeFile(
        join(path!, "SKILL.md"),
        `---\nname: ${name}\ndescription: local fixture\n---\nlocal\n`,
      );
    }
    const skills = await createSkillsService({ isDesktopRuntime: true }).list({
      workspacePath: join(root, "workspace"),
    });
    assert.ok(skills.skills.some((skill) => skill.name === "user-skill" && skill.scope === "user"));
    assert.ok(
      skills.skills.some(
        (skill) => skill.name === "workspace-skill" && skill.scope === "workspace",
      ),
    );
    assert.equal(requests, 0);
  } finally {
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    delete process.env.ZCODE_PRODUCT_PLUGIN_MARKETPLACE_ENABLED;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
