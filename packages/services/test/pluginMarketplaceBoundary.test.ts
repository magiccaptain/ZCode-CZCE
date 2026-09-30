import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginManagementService } from "../src/plugins/pluginManagementService.js";
import { createPluginsService } from "../src/plugins/pluginsService.js";
import { createPluginSyncService } from "../src/plugin-sync/pluginSyncService.js";
import { createMcpSyncService } from "../src/mcp-sync/mcpSyncService.js";

const productCapabilities = Object.freeze({ pluginMarketplace: false });
const params = { workspacePath: "/unused", pluginName: "old", marketplace: "old" };

test("market admission rejects every old request before calling Agent; local management survives", async () => {
  const calls: string[] = [];
  const agent = new Proxy(
    {},
    {
      get: (_target, name) => async () => {
        calls.push(String(name));
        return { fixture: true };
      },
    },
  );
  const service = createPluginManagementService({
    productCapabilities,
    zcodeAgentService: agent as never,
  });
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
  ] as const) {
    await assert.rejects(
      () => service[name](params as never),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
      name,
    );
  }
  assert.deepEqual(calls, []);
  for (const name of [
    "listPlugins",
    "getPluginReferenceCatalog",
    "configurePlugin",
    "resetPluginConfig",
    "setPluginEnabled",
    "uninstallPlugin",
    "restoreBuiltinPlugin",
    "cancelPluginOperation",
  ] as const) {
    assert.deepEqual(await service[name](params as never), { fixture: true });
  }
  assert.equal(calls.length, 8);
  const legacy = createPluginsService({ productCapabilities });
  for (const name of [
    "getOverview",
    "addMarketplace",
    "removeMarketplace",
    "updateMarketplace",
    "installPlugin",
  ] as const)
    await assert.rejects(() => legacy[name](params as never), /PLUGIN_MARKETPLACE_UNAVAILABLE/);
});

test("source archive refuses before reading/unpacking; installed manifest, user/workspace MCP are preserved", async () => {
  const home = await mkdtemp(join(tmpdir(), "zcode-market-service-"));
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    const plugin = join(home, "installed");
    await mkdir(join(plugin, ".zcode-plugin"), { recursive: true });
    await writeFile(
      join(plugin, ".zcode-plugin", "plugin.json"),
      JSON.stringify({ name: "local", skills: ["skills"] }),
    );
    await mkdir(join(home, ".zcode", "cli"), { recursive: true });
    const config = join(home, ".zcode", "cli", "config.json");
    const oldData = JSON.stringify({
      plugins: {
        dirs: [plugin],
        extraKnownMarketplaces: {
          old: { source: { source: "url", url: "https://example.invalid/market.json" } },
        },
      },
    });
    await writeFile(config, oldData);
    const sync = createPluginSyncService({ productCapabilities });
    await assert.rejects(
      () =>
        sync.exportMarketplaceSourceArchive({
          marketplaceId: "old",
          pluginNames: ["old"],
          source: { source: "file", path: "/missing" },
        }),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
    );
    await assert.rejects(
      () => sync.importMarketplaceSourceArchive({ archive: new Uint8Array([0]), overwrite: false }),
      /PLUGIN_MARKETPLACE_UNAVAILABLE/,
    );
    assert.equal(await readFile(config, "utf8"), oldData);
    assert.equal(
      (await sync.listLocalUserPluginCandidates()).candidates[0]?.pluginId,
      "local@inline",
    );
    const mcp = createMcpSyncService();
    await mcp.saveMcpToUserDirectory({
      action: "upsert",
      name: "stdio-local",
      config: { type: "stdio", command: "node", args: ["fixture.mjs"] },
    });
    await mcp.saveMcpToUserDirectory({
      action: "upsert",
      name: "http-local",
      projectPath: join(home, "workspace"),
      config: { type: "http", url: "http://127.0.0.1:1/mcp" },
    });
    const loaded = await mcp.loadMcpFromUserDirectory({ workspacePath: join(home, "workspace") });
    assert.deepEqual(
      loaded.servers.map((server) => [server.name, server.scope]),
      [
        ["http-local", "workspace"],
        ["stdio-local", "user"],
      ],
    );
    assert.equal(
      JSON.parse(await readFile(config, "utf8")).plugins.extraKnownMarketplaces.old.source.source,
      "url",
    );
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
