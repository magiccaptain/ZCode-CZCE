import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  zcodeProtocolMethods,
  zcodePluginsListResultSchema,
  zcodePluginsMarketplaceMutationResultSchema,
  zcodePluginsReferenceCatalogResultSchema,
  zcodePluginsUninstallResultSchema,
  zcodePluginsRestoreBuiltinResultSchema,
} from "@zcode/shared";
import { createZCodeAgentService } from "../src/zcode-agent/zcodeAgentService.js";
import { ZCodeAgentProcessManager } from "../src/zcode-agent/zcodeAgentProcessManager.js";
import { setDataBaseDir } from "../src/paths.js";

const productCapabilities = Object.freeze({ pluginMarketplace: false });

test("direct IZCodeAgentService market RPC bypass refuses before resolving/spawning any command", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-market-agent-"));
  setDataBaseDir(root);
  let commands = 0;
  const service = createZCodeAgentService({
    productCapabilities,
    commandResolver: () => {
      commands++;
      throw new Error("must not start market agent");
    },
  });
  try {
    for (const name of [
      "getPluginsOverview",
      "addPluginMarketplace",
      "removePluginMarketplace",
      "updatePluginMarketplace",
      "installPlugin",
      "updatePlugin",
      "validatePlugin",
      "describePlugin",
      "resolveSuggestedPluginReference",
    ] as const)
      await assert.rejects(
        () => service[name]({ workspacePath: root } as never),
        /PLUGIN_MARKETPLACE_UNAVAILABLE/,
      );
    assert.equal(commands, 0);
  } finally {
    await service.disposeAllAndWait();
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});

test("real managed CLI final spawn wins over inherited/spawn/command env and keeps local list/catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-market-spawn-"));
  const bundle = fileURLToPath(
    new URL("../../../apps/zcode-cli/packages/cli/dist/zcode.cjs", import.meta.url),
  );
  const marker = "ZCODE_PRODUCT_PLUGIN_MARKETPLACE_ENABLED";
  const old = process.env[marker];
  process.env[marker] = "true";
  const manager = new ZCodeAgentProcessManager({
    productCapabilities,
    resolveSpawnEnv: () => ({ [marker]: "true" }),
    commandResolver: () => ({
      command: process.execPath,
      args: [bundle, "app-server", "--stdio"],
      env: { HOME: root, ZCODE_DATA_BASE_DIR: root, [marker]: "true" },
    }),
  });
  try {
    const configPath = join(root, ".zcode", "cli", "config.json");
    await mkdir(join(root, ".zcode", "cli"), { recursive: true });
    const sourceConfig = JSON.stringify({
      plugins: {
        extraKnownMarketplaces: {
          old: { source: { source: "url", url: "http://127.0.0.1:1/market.json" } },
        },
      },
    });
    await writeFile(configPath, sourceConfig);
    const client = await manager.getClient({ workspacePath: root });
    const workspace = { workspacePath: root, workspaceKey: root };
    const list = await client.request(
      zcodeProtocolMethods.pluginsList,
      { workspace },
      zcodePluginsListResultSchema,
    );
    assert.ok(
      list.plugins.some((plugin) => plugin.marketplace === "zcode-plugins-official"),
      "real startup seeds bundled resources",
    );
    const catalog = await client.request(
      zcodeProtocolMethods.pluginsReferenceCatalog,
      { workspace },
      zcodePluginsReferenceCatalogResultSchema,
    );
    assert.equal(catalog.authority, "workspace");
    assert.ok(catalog.plugins.length > 0);
    await assert.rejects(
      () =>
        client.request(
          zcodeProtocolMethods.pluginsMarketplaceAdd,
          { workspace, source: "http://127.0.0.1:1/market.json" },
          zcodePluginsMarketplaceMutationResultSchema,
        ),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
    );
    assert.equal(await readFile(configPath, "utf8"), sourceConfig);
    const builtin = list.plugins.find(
      (plugin) => plugin.source === "official" && !plugin.id.startsWith("computer-use@"),
    )!;
    const removed = await client.request(
      zcodeProtocolMethods.pluginsUninstall,
      { workspace, pluginId: builtin.id },
      zcodePluginsUninstallResultSchema,
    );
    assert.equal(removed.removedPlugin?.id, builtin.id);
    const uninstalled = await client.request(
      zcodeProtocolMethods.pluginsList,
      { workspace },
      zcodePluginsListResultSchema,
    );
    assert.ok(!uninstalled.plugins.some((plugin) => plugin.id === builtin.id));
    assert.ok(uninstalled.restorableBuiltins?.some((plugin) => plugin.id === builtin.id));
    await client.request(
      zcodeProtocolMethods.pluginsRestoreBuiltin,
      { workspace, pluginId: builtin.id },
      zcodePluginsRestoreBuiltinResultSchema,
    );
    const restored = await client.request(
      zcodeProtocolMethods.pluginsList,
      { workspace },
      zcodePluginsListResultSchema,
    );
    assert.ok(restored.plugins.some((plugin) => plugin.id === builtin.id));
    assert.deepEqual(
      JSON.parse(await readFile(configPath, "utf8")).plugins.extraKnownMarketplaces,
      JSON.parse(sourceConfig).plugins.extraKnownMarketplaces,
    );
  } finally {
    await manager.disposeAllAndWait();
    if (old === undefined) delete process.env[marker];
    else process.env[marker] = old;
    await rm(root, { recursive: true, force: true });
  }
});

test("plugins/list validates optional offline builtin inventory and accepts legacy absent field", () => {
  assert.deepEqual(zcodePluginsListResultSchema.parse({ plugins: [], diagnostics: [] }), {
    plugins: [],
    diagnostics: [],
  });
  const builtin = {
    id: "fixture@zcode-plugins-official",
    name: "fixture",
    marketplace: "zcode-plugins-official",
    installed: false,
  };
  assert.deepEqual(
    zcodePluginsListResultSchema.parse({
      plugins: [],
      diagnostics: [],
      restorableBuiltins: [builtin],
    }).restorableBuiltins,
    [builtin],
  );
  assert.equal(
    zcodePluginsListResultSchema.safeParse({
      plugins: [],
      diagnostics: [],
      restorableBuiltins: [{ ...builtin, installed: "bad" }],
    }).success,
    false,
  );
});
