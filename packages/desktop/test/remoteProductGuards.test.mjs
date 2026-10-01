import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PlatformChannels } from "@zcode/shared";

const require = createRequire(import.meta.url);
const buildRequire = createRequire(require.resolve("tsup"));
const { build } = await import(pathToFileURL(buildRequire.resolve("esbuild")).href);
const cache = join(import.meta.dirname, "../.e2e-cache");
await mkdir(cache, { recursive: true });
const outfile = join(cache, "remote-product-guards-test.mjs");
const handlers = new Map();
const noEffect = () => assert.fail("disabled remote side effect");
globalThis.__remoteProductPorts = {
  ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
  app: { on() {} },
  shell: {},
  BrowserWindow: { fromWebContents: noEffect, getAllWindows: noEffect },
  MessageChannelMain: noEffect,
};
await build({
  stdin: {
    contents:
      "export * from '../src/main/desktopMainIpcRemote.ts'; export * from '../src/main/desktopRemoteSessions.ts';",
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "native-ports",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^electron$|\.\/(desktopArmsRum|desktopNotifications|desktopArmsCustomEvent|desktopRemoteUsageArmsTelemetry|desktopMainIpcHelpers)\.js$/,
          },
          (args) => ({ path: args.path, namespace: "port" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "port" }, ({ path }) => ({
          loader: "js",
          contents:
            path === "electron"
              ? "export const {ipcMain,app,shell,BrowserWindow,MessageChannelMain,dialog}=globalThis.__remoteProductPorts;"
              : "export const configureRemoteUsageArmsTelemetry=()=>{}; export const getDesktopArmsRum=()=>{throw Error('SDK')}; export const dispatchTaskNotification=()=>{}; export const dispatchFinalArmsCustomEvent=()=>{}; export const enableSharedFinalArmsCustomEventE2EController=()=>{}; export const reportRemoteConnectResultToArms=()=>{}; export const openPathInDefaultApp=()=>{};",
        }));
      },
    },
  ],
});
const main = await import(pathToFileURL(outfile).href);
const capabilities = Object.freeze({ remoteWorkspaces: false, mobileRemoteControl: false });
const logger = { info() {}, warn() {}, error() {} };
main.registerRemoteIpcHandlers({
  logger,
  appTelemetryRuntime: {},
  armsCustomContext: {},
  createRemoteWorkspaceSession: noEffect,
  bindRemoteWorkspaceSessionContext: noEffect,
  isDockerDaemonAvailable: noEffect,
  listAvailableWSLDistros: noEffect,
  listAvailableDockerContainers: noEffect,
  listSSHConfigAliases: noEffect,
});
const targets = [
  { kind: "ssh", host: "fixture.invalid", username: "fixture" },
  { kind: "wsl", distro: "fixture" },
  { kind: "docker", container: "fixture" },
  { kind: "server", url: "http://127.0.0.1:1" },
];
test("Main rejects old new/restore/reconnect IPC before any discovery or connection effect", async () => {
  for (const target of targets)
    for (const connectTrigger of ["new", "restore", "reconnect"]) {
      const result = await handlers.get(PlatformChannels.ConnectRemote)(
        { sender: { id: 1 } },
        { target, connectTrigger, workspacePath: "/same", workspaceIdentity: "old-identity" },
      );
      assert.equal(result.success, false);
      assert.match(result.error, /REMOTE_WORKSPACES_UNAVAILABLE/);
    }
  await assert.rejects(
    async () => handlers.get(PlatformChannels.BindRemoteWorkspaceSessionContext)({}, {}),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  for (const channel of [
    PlatformChannels.ListWSLDistros,
    PlatformChannels.ListDockerContainers,
    PlatformChannels.ListSSHConfigAliases,
  ])
    assert.deepEqual(await handlers.get(channel)(), []);
  assert.equal(await handlers.get(PlatformChannels.IsDockerAvailable)(), false);
});
test("Main manager refuses remote/Bot/replay creation and binding before Host lookup, WSL resolution, assets and ports", async () => {
  const manager = main.createRemoteWorkspaceSessionManager({
    productCapabilities: capabilities,
    logger,
    windowHostProcessMap: { get: noEffect },
    resolveRemoteAssetDirs: noEffect,
    resolveWslTarget: noEffect,
    createMessageChannel: noEffect,
  });
  for (const target of targets)
    await assert.rejects(
      manager.createRemoteWorkspaceSession({}, target),
      /REMOTE_WORKSPACES_UNAVAILABLE/,
    );
  await assert.rejects(
    manager.bindRemoteWorkspaceSessionContext("old", { workspacePath: "/same" }),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  await assert.rejects(
    async () =>
      manager.reconnectBotRemoteWorkspaceSession(
        {},
        { target: targets[0], workspacePath: "/same", workspaceIdentity: "old" },
      ),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  await assert.rejects(
    manager.createBotRemoteWorkspaceRuntimePort({}, {}),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  assert.throws(
    () => manager.attachRemoteWorkspaceSessionHost({}),
    /REMOTE_WORKSPACES_UNAVAILABLE|MOBILE_REMOTE_CONTROL_UNAVAILABLE/,
  );
  manager.reattachRemoteWorkspaceSessionsForWindow({}, "reload");
  await manager.disposeAllAndWaitForAppShutdown("test");
});
