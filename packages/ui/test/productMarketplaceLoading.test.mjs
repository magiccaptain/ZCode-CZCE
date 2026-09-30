import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(
  createRequire(new URL("../../desktop/package.json", import.meta.url)).resolve("tsup"),
);
const { build } = await import(pathToFileURL(require.resolve("esbuild")).href);
const outfile = join(import.meta.dirname, "../../desktop/.e2e-cache/ui-market-loading-test.mjs");
await mkdir(join(import.meta.dirname, "../../desktop/.e2e-cache"), { recursive: true });
await build({
  entryPoints: [join(import.meta.dirname, "../src/store/pluginManagementStore.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "ui-alias",
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, (args) =>
          args.path === "@/logger.js"
            ? { path: args.path, namespace: "logger" }
            : {
                path: join(
                  import.meta.dirname,
                  "../src",
                  args.path.slice(2).replace(/\.js$/, ".ts"),
                ),
              },
        );
        builder.onLoad({ filter: /.*/, namespace: "logger" }, () => ({
          loader: "js",
          contents: "export const logger={debug(){},info(){},warn(){},error(){}};",
        }));
      },
    },
  ],
});
const { usePluginManagementStore: store } = await import(pathToFileURL(outfile).href);
test("actual local inventory initializes/config reloads without marketplace overview; legacy mutations reject", async () => {
  const calls = [];
  const service = new Proxy(
    {},
    {
      get(_, method) {
        return async (params) => {
          calls.push([method, params]);
          if (method === "listPlugins")
            return {
              plugins: [{ id: "fixture", name: "fixture", enabled: true }],
              diagnostics: [],
            };
          if (method === "configurePlugin") return {};
          throw Error(`market side effect: ${String(method)}`);
        };
      },
    },
  );
  await store.getState().initialize({
    workspacePath: "/fixture",
    workspaceIdentity: "identity",
    configScope: "user",
    pluginService: service,
    productCapabilities: { pluginMarketplace: false },
  });
  assert.deepEqual(
    calls.map(([method]) => method),
    ["listPlugins"],
  );
  assert.equal(store.getState().plugins[0].id, "fixture");
  assert.equal(store.getState().marketplaceAvailabilityKnown, false);
  assert.equal(
    await store.getState().configurePlugin("fixture", { local: "value" }, service),
    true,
  );
  assert.deepEqual(
    calls.map(([method]) => method),
    ["listPlugins", "configurePlugin", "listPlugins"],
  );
  assert(calls.every(([, params]) => params.workspaceIdentity === "identity"));
  const before = calls.length;
  await store.getState().addMarketplace("old", service);
  await store.getState().updateMarketplace(null, service);
  await store.getState().removeMarketplace("old", service);
  await store.getState().installPlugin("old", "old", service);
  await store.getState().updatePlugin("old", service);
  await store.getState().validateSource("old", service);
  await store.getState().describePlugin("old", "old", "old", service);
  assert.equal(calls.length, before);
  assert.match(store.getState().error, /PLUGIN_MARKETPLACE_UNAVAILABLE/);
});

test("list-only projection rejects stale same-path different-identity result", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const service = {
    async listPlugins(params) {
      if (params.workspaceIdentity === "old-identity") await pending;
      return { plugins: [{ id: params.workspaceIdentity }], diagnostics: [] };
    },
    getPluginsOverview() {
      throw Error("unexpected overview");
    },
  };
  const old = store.getState().initialize({
    workspacePath: "/same",
    workspaceIdentity: "old-identity",
    pluginService: service,
    productCapabilities: { pluginMarketplace: false },
  });
  await store.getState().initialize({
    workspacePath: "/same",
    workspaceIdentity: "new-identity",
    pluginService: service,
    productCapabilities: { pluginMarketplace: false },
  });
  release();
  await old;
  assert.equal(store.getState().plugins[0].id, "new-identity");
  assert.equal(store.getState().workspaceIdentity, "new-identity");
});
test("failed local inventory never retries through overview/fallback", async () => {
  let lists = 0;
  const service = {
    async listPlugins() {
      lists++;
      throw Error("local manifest error");
    },
    getPluginsOverview() {
      throw Error("market request");
    },
  };
  await store.getState().initialize({
    workspacePath: "/failed",
    pluginService: service,
    productCapabilities: { pluginMarketplace: false },
  });
  assert.equal(lists, 1);
  assert.equal(store.getState().error, "local manifest error");
  assert.equal(store.getState().loading, false);
});

test("disabled inventory immediately drops old market projection before async local list", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  store.setState({
    availablePlugins: [{ id: "old" }],
    installedPlugins: [{ id: "old", updateStatus: "update-available" }],
    marketplaceAvailabilityKnown: true,
    marketplaces: [{ id: "old" }],
  });
  const initialized = store.getState().initialize({
    workspacePath: "/old-cache",
    productCapabilities: { pluginMarketplace: false },
    pluginService: {
      async listPlugins() {
        await pending;
        return { plugins: [], diagnostics: [] };
      },
    },
  });
  try {
    assert.equal(store.getState().availablePlugins.length, 0);
    assert.equal(store.getState().installedPlugins.length, 0);
    assert.equal(store.getState().marketplaceAvailabilityKnown, false);
  } finally {
    release();
    await initialized;
  }
});

test("list-only inventory survives reload and restores offline through existing owner without overview", async () => {
  const builtin = {
    id: "builtin@zcode-plugins-official",
    name: "builtin",
    marketplace: "zcode-plugins-official",
    installed: false,
  };
  let suppressed = true;
  const calls = [];
  const service = {
    async listPlugins() {
      calls.push("list");
      return { plugins: [], diagnostics: [], restorableBuiltins: suppressed ? [builtin] : [] };
    },
    async restoreBuiltinPlugin(params) {
      calls.push("restore");
      assert.equal(params.workspaceIdentity, "offline-identity");
      suppressed = false;
    },
    async getPluginsOverview() {
      throw Error("no market overview");
    },
  };
  await store.getState().initialize({
    workspacePath: "/offline",
    workspaceIdentity: "offline-identity",
    configScope: "user",
    pluginService: service,
    productCapabilities: { pluginMarketplace: false },
  });
  assert.deepEqual(store.getState().restorableBuiltins, [builtin]);
  await store.getState().refresh(service);
  assert.deepEqual(store.getState().restorableBuiltins, [builtin]);
  await store.getState().restoreBuiltin(builtin.id, service);
  assert.deepEqual(store.getState().restorableBuiltins, []);
  assert.deepEqual(calls, ["list", "list", "restore", "list"]);
});
