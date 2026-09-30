import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(
  createRequire(new URL("../../desktop/package.json", import.meta.url)).resolve("tsup"),
);
const { build } = await import(pathToFileURL(require.resolve("esbuild")).href);
const source = await readFile(
  join(import.meta.dirname, "../src/settings/RemotePluginSyncDialog.tsx"),
  "utf8",
);
const names = new Map();
for (const match of source.matchAll(
  /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
)) {
  names.set(
    match[2],
    match[1]
      .split(",")
      .map(
        (raw) =>
          raw
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0],
      )
      .filter(Boolean),
  );
}
const outfile = join(
  import.meta.dirname,
  "../../desktop/.e2e-cache/ui-market-remote-sync-test.mjs",
);
await mkdir(join(import.meta.dirname, "../../desktop/.e2e-cache"), { recursive: true });
await build({
  stdin: {
    contents: `${source}\nexport { loadRemotePluginSyncCandidates, syncSelectedRemotePlugins, prepareRemoteMarketplaceSource };`,
    resolveDir: join(import.meta.dirname, "../src/settings"),
    loader: "tsx",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
  plugins: [
    {
      name: "ui-ports",
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: args.path, namespace: "ports" }));
        builder.onLoad({ filter: /.*/, namespace: "ports" }, (args) => ({
          loader: "js",
          contents: (names.get(args.path) ?? [])
            .map((name) => `export const ${name}=()=>{throw Error('unexpected UI port')};`)
            .join("\n"),
        }));
      },
    },
  ],
});
const {
  loadRemotePluginSyncCandidates,
  syncSelectedRemotePlugins,
  prepareRemoteMarketplaceSource,
} = await import(pathToFileURL(outfile).href);
test("disabled remote-sync market view skips overview but existing inline/archive path works; stale market rows/source preparation reject", async () => {
  const calls = [];
  const inline = {
    id: "fixture",
    pluginId: "fixture@inline",
    name: "fixture",
    directoryName: "fixture",
    path: "/fixture",
    enabled: true,
    componentTypes: ["skill"],
  };
  const resultItem = {
    name: "fixture",
    pluginId: inline.pluginId,
    directoryName: "fixture",
    status: "synced",
  };
  const agent = new Proxy(
    {},
    {
      get(_, method) {
        return async () => {
          calls.push(method);
          throw Error(`market side effect: ${String(method)}`);
        };
      },
    },
  );
  const local = {
    async listLocalUserPluginCandidates() {
      return { candidates: [inline] };
    },
    async exportPluginsArchive() {
      calls.push("exportPluginsArchive");
      return { archive: {} };
    },
  };
  const remote = {
    async listRemoteUserPluginStatuses() {
      return { statuses: [] };
    },
    async importPluginsArchive() {
      calls.push("importPluginsArchive");
      return { results: [resultItem] };
    },
  };
  const params = {
    productCapabilities: { pluginMarketplace: false },
    localPluginSyncService: local,
    remotePluginSyncService: remote,
    localWorkspacePath: "/fixture",
    remoteWorkspacePath: "/remote",
    localZCodeAgentService: agent,
    remoteZCodeAgentService: agent,
  };
  const loaded = await loadRemotePluginSyncCandidates(params);
  assert.equal(loaded.candidates.length, 1);
  assert.deepEqual(calls, []);
  const inlineRow = { candidate: loaded.candidates[0], exists: false };
  assert.deepEqual((await syncSelectedRemotePlugins({ ...params, rows: [inlineRow] })).results, [
    resultItem,
  ]);
  assert.deepEqual(calls, ["exportPluginsArchive", "importPluginsArchive"]);
  const row = {
    candidate: {
      id: "market:old",
      kind: "marketplace",
      pluginId: "old@fixture",
      name: "old",
      marketplace: "fixture",
      marketplacePlugin: { pluginName: "old", marketplaceSourceInput: "fixture" },
    },
    exists: false,
    remoteMarketplaceExists: false,
  };
  const before = calls.length;
  const result = await syncSelectedRemotePlugins({ ...params, rows: [row] });
  assert.equal(result.results[0].status, "failed");
  assert.match(result.results[0].error, /PLUGIN_MARKETPLACE_UNAVAILABLE/);
  await assert.rejects(
    prepareRemoteMarketplaceSource(params, row, { workspacePath: "/remote" }),
    /PLUGIN_MARKETPLACE_UNAVAILABLE/,
  );
  assert.equal(calls.length, before);
});
