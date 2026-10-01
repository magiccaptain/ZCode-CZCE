import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildRemoteWorkspaceIdentity } from "@zcode/shared";

const require = createRequire(
  createRequire(new URL("../../desktop/package.json", import.meta.url)).resolve("tsup"),
);
const { build } = await import(pathToFileURL(require.resolve("esbuild")).href);
const files = [
  "hooks/useRemoteConnectionEntryVisibility.ts",
  "hooks/useRemoteConnectionForm.ts",
  "lib/remoteConnectionDockerOptions.ts",
  "lib/workspaceServiceResolver.ts",
  "hooks/usePlatform.tsx",
  "hooks/useRemoteConnectionLogs.ts",
  "root/useReconnectingRemoteWorkspaceLogs.ts",
  "root/useRemoteWorkspaceTabLifecycle.ts",
  "root/reconnectRemoteWorkspaceHistoryEntry.ts",
  "root/remoteWorkspaceSessionPersistence.ts",
  "SSHDialog.tsx",
  "WorkspaceWebRemoteControlTrigger.tsx",
  "WebRemoteControlDialog.tsx",
];
const names = new Map();
for (const file of files) {
  const source = await readFile(join(import.meta.dirname, "../src", file), "utf8");
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
  )) {
    const list = names.get(match[2]) ?? new Set();
    for (const raw of match[1].split(",")) {
      const name = raw
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if (name) list.add(name);
    }
    names.set(match[2], list);
  }
}
const outfile = join(import.meta.dirname, "../../desktop/.e2e-cache/ui-remote-tests.mjs");
await mkdir(join(import.meta.dirname, "../../desktop/.e2e-cache"), { recursive: true });
await build({
  stdin: {
    contents: files.map((file) => `export * from '../src/${file}';`).join("\n"),
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
  plugins: [
    {
      name: "remote-ports",
      setup(builder) {
        builder.onResolve({ filter: /^react$|^@\// }, (args) => {
          if (
            [
              "@/lib/remoteWorkspaceHistory.js",
              "@/lib/remoteConnectionDockerOptions.js",
              "@/hooks/useRemoteConnectionLogs.js",
              "@/hooks/useRemoteConnectionEntryVisibility.js",
            ].includes(args.path)
          )
            return {
              path: join(import.meta.dirname, "../src", args.path.slice(2).replace(/\.js$/, ".ts")),
            };
          return { path: args.path, namespace: "ports" };
        });
        builder.onLoad({ filter: /.*/, namespace: "ports" }, (args) => ({
          loader: "js",
          contents:
            {
              react:
                "export const memo=f=>f; export const createContext=()=>({}); export const useContext=()=>globalThis.__remotePlatform; export const useEffect=f=>globalThis.__remoteEffects.push(f); export const useRef=v=>({current:globalThis.__remoteRefs.length?globalThis.__remoteRefs.shift():v}); export const useState=v=>[globalThis.__remoteStates.length?globalThis.__remoteStates.shift():(typeof v==='function'?v():v),()=>{}]; export const useCallback=f=>f; export const useMemo=f=>f();",
              "@/hooks/usePlatform.js":
                "export const usePlatform=()=>globalThis.__remotePlatform; export const useOptionalPlatform=usePlatform;",
              "@/hooks/useRemoteConnectionEntryVisibility.js":
                "export const useRemoteConnectionEntryVisibility=()=>globalThis.__remotePlatform.productCapabilities.remoteWorkspaces !== false;",
              "@/store/tabStore.js": "export const isWorkspaceTab=t=>t.kind==='workspace';",
              "@/store/remoteWorkspaceSessionStore.js":
                "export const useRemoteWorkspaceSessionStore=()=>{throw Error('session read')}; export const bindRemoteWorkspacePath=()=>globalThis.__remoteBinds++; export const bindRemoteWorkspaceIdentity=()=>globalThis.__remoteBinds++; export const unbindRemoteWorkspacePath=()=>{}; export const unbindRemoteWorkspaceIdentity=()=>{}; export const unregisterRemoteWorkspaceSession=()=>{};",
              "@/logger.js": "export const logger={debug(){},info(){},warn(){},error(){}};",
            }[args.path] ??
            [...(names.get(args.path) ?? [])]
              .map((name) => `export const ${name}=()=>{throw Error('unexpected port: ${name}')};`)
              .join("\n"),
        }));
      },
    },
  ],
});
const ui = await import(pathToFileURL(outfile).href);
function reset() {
  globalThis.__remoteEffects = [];
  globalThis.__remoteRefs = [];
  globalThis.__remoteStates = [];
  globalThis.__remoteBinds = 0;
  globalThis.__remoteCalls = 0;
  globalThis.__remotePlatform = new Proxy(
    { productCapabilities: { remoteWorkspaces: false, mobileRemoteControl: false } },
    {
      get(target, key) {
        if (key in target) return target[key];
        return () => {
          globalThis.__remoteCalls++;
          throw Error(`unexpected platform call: ${String(key)}`);
        };
      },
    },
  );
}
test("disabled direct wizard and old mobile dialog mounts stop before effect-bearing child hooks", () => {
  reset();
  assert.equal(ui.RemoteConnectionDialog({ open: true }), null);
  assert.equal(ui.WorkspaceWebRemoteControlTrigger({ workspacePath: "/fixture" }), null);
  assert.equal(ui.WebRemoteControlDialog({ open: true, workspacePath: "/fixture" }), null);
  assert.equal(globalThis.__remoteEffects.length, 0);
  assert.equal(ui.useRemoteConnectionEntryVisibility(), false);
});
test("capabilities absent preserves other platform wrappers and discovery choices", () => {
  reset();
  globalThis.__remotePlatform = {};
  assert.equal(ui.useRemoteConnectionEntryVisibility(), true);
  assert(ui.RemoteConnectionDialog({ open: true }));
  assert(ui.WebRemoteControlDialog({ open: true, workspacePath: "/fixture" }));
  assert(ui.WorkspaceWebRemoteControlTrigger({ workspacePath: "/fixture" }));
  assert.deepEqual(
    ui.useRemoteConnectionForm({ open: false, isWindowsDesktop: true }).availableKinds,
    ["ssh", "wsl", "docker"],
  );
});
test("disabled connection and history log hooks do not register remote listeners", () => {
  reset();
  ui.useRemoteConnectionLogs("old-request");
  ui.useReconnectingRemoteWorkspaceLogs({
    platform: globalThis.__remotePlatform,
    reconnectingWorkspaceKeys: ["old"],
    resolveWorkspaceTargetByKey: () => {
      throw Error("old target read");
    },
  });
  for (const effect of globalThis.__remoteEffects) effect();
  assert.equal(globalThis.__remoteCalls, 0);
});
test("disabled discovery hook effects and explicit Docker refresh do not call platform for any old kind", async () => {
  for (const kind of ["ssh", "wsl", "docker"]) {
    reset();
    globalThis.__remoteStates = [kind];
    const form = ui.useRemoteConnectionForm({
      open: true,
      isWindowsDesktop: true,
      preferredKind: kind,
    });
    for (const effect of globalThis.__remoteEffects) effect();
    form.refreshDockerContainers();
    assert.deepEqual(form.availableKinds, []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.__remoteCalls, 0);
  }
});
test("direct Docker discovery helper returns unavailable before invoking platform", async () => {
  reset();
  const result = await ui.loadRemoteConnectionDockerOptions(globalThis.__remotePlatform);
  assert.match(result.error, /REMOTE_WORKSPACES_UNAVAILABLE/);
  assert.equal(globalThis.__remoteCalls, 0);
  assert.deepEqual(result.dockerContainers, []);
});
test("old programmatic connect rejects before invoking platform", async () => {
  reset();
  await assert.rejects(
    ui.useConnectRemote()({ kind: "docker", container: "fixture" }),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
});
test("direct history reconnect rejects before credential reads, state mutation or identity downgrade", async () => {
  reset();
  let calls = 0;
  const params = new Proxy(
    {
      productCapabilities: globalThis.__remotePlatform.productCapabilities,
      sessionEntry: {
        workspacePath: "/same",
        workspaceIdentity: "remote-old",
        target: { kind: "ssh", host: "fixture.invalid", username: "fixture" },
      },
    },
    {
      get(target, key) {
        return key in target
          ? target[key]
          : () => {
              calls++;
              throw Error("side effect");
            };
      },
    },
  );
  await assert.rejects(
    ui.reconnectRemoteWorkspaceHistoryEntry(params),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  assert.equal(calls, 0);
});
test("product guard overrides restore=true; same-path local and remote history remain separate and preserved", () => {
  reset();
  const path = "/same";
  const tabs = [];
  const remote = [
    { kind: "ssh", host: "fixture.invalid", username: "fixture" },
    { kind: "wsl", distro: "fixture" },
    { kind: "docker", container: "fixture" },
  ].map((target) => ({
    kind: "remote",
    workspacePath: path,
    workspaceIdentity: buildRemoteWorkspaceIdentity(path, target),
    target,
    lastOpenedAt: 1,
    lastConnectionStatus: "connected",
  }));
  const settings = {
    lastWorkspaceSession: [{ kind: "local", workspacePath: path }, ...remote],
    lastActiveTabIndex: 1,
  };
  const previous = structuredClone(settings);
  const store = { getState: () => ({ restoreTabs: (values) => tabs.push(...values) }) };
  ui.restorePersistedRemoteWorkspaceSessions({
    settings,
    tabStoreApi: store,
    allowRemoteWorkspaceRestore: true,
    productCapabilities: globalThis.__remotePlatform.productCapabilities,
  });
  assert.deepEqual(tabs, [path]);
  assert.deepEqual(settings, previous);
  const patch = ui.buildRemoteWorkspacePersistPatch(
    { tabs: [{ kind: "workspace", workspacePath: path }], activeWorkspacePath: path },
    remote,
  );
  assert.deepEqual(
    patch.lastWorkspaceSession.filter((entry) => entry.kind === "remote"),
    remote,
  );
});
test("same-path remote identity cannot borrow another old session or fall back to local services", () => {
  reset();
  const local = { owner: "local" };
  const remote = { owner: "remote-a" };
  const state = {
    sessionsById: { "old-a": { services: remote } },
    sessionIdByWorkspaceIdentity: { "remote-a": "old-a" },
    sessionIdByWorkspacePath: { "/same": "old-a" },
  };
  assert.equal(
    ui.resolveWorkspaceServices(
      { workspacePath: "/same", workspaceIdentity: "remote-b", remoteSessionId: "stale-b" },
      local,
      state,
    ),
    null,
  );
  assert.equal(
    ui.resolveWorkspaceServices({ workspacePath: "/same" }, local, state).services,
    local,
  );
  assert.equal(
    ui.resolveWorkspaceServices(
      { workspacePath: "/same", workspaceIdentity: "remote-a", remoteSessionId: "old-a" },
      local,
      state,
    ).services,
    remote,
  );
});
test("disabled old live tabs do not rebind same-path identities or remove retained history", () => {
  reset();
  let removed = 0;
  const old = {
    kind: "workspace",
    id: "old",
    workspacePath: "/same",
    workspaceIdentity: "remote-old",
    remoteSessionId: "old",
  };
  const other = {
    ...old,
    id: "other",
    workspaceIdentity: "remote-other",
    remoteSessionId: "other",
  };
  globalThis.__remoteRefs = [[old, other]];
  const platform = {
    productCapabilities: globalThis.__remotePlatform.productCapabilities,
    disposeRemoteSession: async () => {},
  };
  ui.useRemoteWorkspaceTabLifecycle({
    tabs: [other],
    activeWorkspaceTab: other,
    platform,
    onRemoteWorkspaceTabsClosed: () => removed++,
  });
  for (const effect of globalThis.__remoteEffects) effect();
  assert.equal(globalThis.__remoteBinds, 0);
  assert.equal(removed, 0);
});
