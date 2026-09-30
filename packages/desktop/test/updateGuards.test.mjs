import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// 复用 Desktop 已有 tsup 的 esbuild，隔离 Electron 原生依赖；测试真实 guard 实现。
const require = createRequire(import.meta.url);
const buildRequire = createRequire(require.resolve("tsup"));
const { build } = await import(pathToFileURL(buildRequire.resolve("esbuild")).href);
const cache = join(import.meta.dirname, "../.e2e-cache");
await mkdir(cache, { recursive: true });
const outfile = join(cache, "update-guards-test.mjs");
await build({
  stdin: {
    contents: `export * from '../src/main/autoUpdater.ts'; export * from '../src/main/forceUpdateGuard.ts';`,
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
      name: "native-test-ports",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(electron|electron-updater)$|\.\/(logger|manifestUpdateProvider|forceUpdatePrompt)\.js$/,
          },
          (args) => ({ path: args.path, namespace: "test-port" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "test-port" }, ({ path }) => {
          const ports = {
            electron: `export const app={isPackaged:true,commandLine:{hasSwitch:()=>true,getSwitchValue:()=> 'debug-update'}}; export const BrowserWindow={}; export const Menu={}; export const ipcMain=globalThis.__guardPorts.ipc;`,
            "electron-updater": `const updater=globalThis.__guardPorts.updater; export default {autoUpdater:updater}; export class CancellationToken {}`,
            "./logger.js": `export const logger={info(){},warn(){},error(){}};`,
            "./manifestUpdateProvider.js": `export class ManifestUpdateProvider {} export const getElectronReleasePlatform=()=> 'linux-x64';`,
            "./forceUpdatePrompt.js": `export function showForceUpdatePrompt(){throw Error('unexpected native prompt');}`,
          };
          return { contents: ports[path], loader: "js" };
        });
      },
    },
  ],
});
const handles = new Map();
const events = new Map();
const calls = [];
globalThis.__guardPorts = {
  ipc: {
    handle: (channel, handler) => handles.set(channel, handler),
    on: (channel, handler) => events.set(channel, handler),
  },
  updater: {
    autoInstallOnAppQuit: true,
    checkForUpdates() {
      calls.push("check");
    },
    downloadUpdate() {
      calls.push("download");
    },
    quitAndInstall() {
      calls.push("install");
    },
  },
};
const guards = await import(pathToFileURL(outfile).href);

test("disabled update rules precede settings, native calls, debug flags and force-update fetch", async () => {
  let settingsReads = 0;
  let settingsWrites = 0;
  const settings = {
    get: async () => {
      settingsReads++;
      return {
        autoDownloadAndInstallUpdates: true,
        pendingPostUpdateReleaseNotes: { version: "999.0.0" },
      };
    },
    update: async () => {
      settingsWrites++;
    },
  };
  assert.deepEqual(guards.getAutoUpdaterState(), { kind: "idle", enabled: false });
  await guards.hydratePendingPostUpdateReleaseNotes(settings);
  guards.syncReadyUpdateToWindow({
    isDestroyed: () => false,
    webContents: { send: () => assert.fail("ready update restored") },
  });
  guards.syncPostUpdateReleaseNotesToWindow({
    isDestroyed: () => false,
    webContents: { send: () => assert.fail("release notes restored") },
  });
  await guards.initAutoUpdater({
    enabled: true,
    settingService: settings,
    updateFeedSource: { url: "http://127.0.0.1/forbidden" },
  });
  assert.equal(handles.size, 4);
  for (const handler of handles.values()) assert.throws(handler, /APP_UPDATES_UNAVAILABLE/);
  for (const handler of events.values()) assert.doesNotThrow(handler);
  assert.throws(() => guards.checkForUpdateMenuClick(), /APP_UPDATES_UNAVAILABLE/);
  const forceStates = [];
  guards.requestForceAutoUpdate((state) => forceStates.push(state));
  assert.deepEqual(forceStates, [{ kind: "error", message: "APP_UPDATES_UNAVAILABLE" }]);
  guards.refreshAutoUpdaterReleaseChannel(true);
  let remoteReads = 0;
  const result = await guards.maybeBlockStartupForForceUpdate({
    locale: "en-US",
    logger: { info() {}, warn() {} },
    fetchRemoteConfig: async () => {
      remoteReads++;
      return { minimalVersion: "999.0.0" };
    },
  });
  assert.deepEqual(result, { blocked: false });
  assert.equal(remoteReads, 0);
  assert.equal(settingsReads, 0);
  assert.equal(settingsWrites, 0);
  assert.equal(globalThis.__guardPorts.updater.autoInstallOnAppQuit, false);
  assert.deepEqual(calls, []);
});

test.after(async () => {
  await rm(outfile, { force: true });
  delete globalThis.__guardPorts;
});
