import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BufferWriter, serialize } from "@zcode/rpc";
import { assertTaskRpcAdmission } from "./task-rpc-admission.mjs";
import { IZCodeAgentService, IZCodeTaskService } from "@zcode/services";
import {
  PlatformChannels,
  HostMessageTypes,
  HostResponseTypes,
  buildRemoteWorkspaceIdentity,
  appSettingsSchema,
} from "@zcode/shared";
import {
  buildBaseline,
  launchBaseline,
  closeBaseline,
  enterBaselineUI,
  prepareBaselineLocale,
  waitFor,
  desktopRoot,
  repositoryRoot,
} from "./runtime.mjs";

// 实际 Main/preload/Host 请求；不配置模型，不修改业务状态或 Runtime 协议。
const root = await mkdtemp(join(tmpdir(), "zcode-remote-backend-"));
const artifacts = join(desktopRoot, ".e2e-artifacts", `remote-backend-${Date.now()}`);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const log = [];
const environment = process.env.ZCODE_REMOTE_E2E_ENV ?? "test";
assert(["test", "production"].includes(environment));
const report = {
  environment,
  passed: false,
  platform: `${process.platform}-${process.arch}`,
  cases: [],
  limitations: [
    "No model/Skills/MCP invocation",
    "No packaged app or Windows/macOS",
    "Multiple local owners covered by component test, not simultaneous GUI windows",
  ],
};
const version = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).version;
const targets = [
  { kind: "ssh", host: "fixture.invalid", username: "fixture" },
  { kind: "wsl", distro: "fixture" },
  { kind: "docker", container: "fixture" },
];
let app;
try {
  await buildBaseline(environment);
  report.build = JSON.parse(
    await readFile(join(desktopRoot, ".e2e-cache/baseline-build.json"), "utf8"),
  );
  await prepareBaselineLocale(root);
  const workspacePath = join(root, "local-workspace");
  await mkdir(workspacePath);
  const oldHistory = targets.map((target) => ({
    kind: "remote",
    workspacePath,
    workspaceIdentity: buildRemoteWorkspaceIdentity(workspacePath, target),
    target,
    lastOpenedAt: 1,
    lastConnectionStatus: "connected",
  }));
  const settingPath = join(root, ".zcode/v2/setting.json");
  await writeFile(
    settingPath,
    JSON.stringify(
      appSettingsSchema.parse({
        locale: "en-US",
        localePreference: "en-US",
        lastWorkspaceSession: [{ kind: "local", workspacePath }, ...oldHistory],
        lastActiveTabIndex: 1,
      }),
    ),
  );
  const oldPairingPath = join(root, ".zcode/v2/legacy-mobile-pairing.fixture.json");
  const oldPairing = JSON.stringify({
    relayUrl: "http://127.0.0.1:9",
    pairingId: "legacy-fixture",
  });
  await writeFile(oldPairingPath, oldPairing);
  // 该 pairing fixture 只证明未知旧数据不被改写，不冒充当前仓库存在 pairing owner。
  const bootstrap = join(desktopRoot, ".e2e-cache/remote-backend-bootstrap.mjs");
  await writeFile(
    bootstrap,
    `
import { ipcMain, utilityProcess } from 'electron';
const handlers = new Map();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => { handlers.set(channel, fn); return handle(channel, fn); };
const fork = utilityProcess.fork.bind(utilityProcess);
const hosts = [];
utilityProcess.fork = (...args) => {
  const child = fork(...args);
  if (String(args[0]).includes('/host/')) {
    const entry = { child, sent: [], responses: [], closedPorts: 0 };
    const post = child.postMessage.bind(child);
    child.postMessage = (message, ports) => { entry.sent.push(message.type); return post(message, ports); };
    child.on('message', message => entry.responses.push(message));
    hosts.push(entry);
  }
  return child;
};
globalThis.__remoteBackendProbe = { handlers, hosts };
await import(${JSON.stringify(pathToFileURL(join(desktopRoot, "out/main/index.js")).href)});
`,
  );
  for (let run = 0; run < 2; run++) {
    const started = await launchBaseline({
      runRoot: root,
      key: "non-credential-fixture",
      log,
      version,
      main: bootstrap,
    });
    app = started.app;
    const page = started.page;
    await enterBaselineUI(page);
    await waitFor(
      async () => await app.evaluate(() => globalThis.__remoteBackendProbe.hosts.length === 1),
      "window Local Host created",
    );
    const preload = await page.evaluate(async (targets) => {
      const results = [];
      for (const target of targets)
        results.push(
          await window.zcode.connectRemote(target, "old-restore", {
            workspacePath: "/same",
            workspaceIdentity: "old",
            connectTrigger: "restore",
          }),
        );
      let bindError;
      try {
        await window.zcode.bindRemoteWorkspaceSessionContext({
          remoteSessionId: "old",
          workspacePath: "/same",
          workspaceIdentity: "old",
        });
      } catch (error) {
        bindError = error.message;
      }
      return {
        results,
        bindError,
        docker: await window.zcode.isDockerAvailable(),
        wsl: await window.zcode.listWSLDistros(),
        containers: await window.zcode.listDockerContainers(),
        ssh: await window.zcode.listSSHConfigAliases(),
      };
    }, targets);
    assert(
      preload.results.every(
        (result) => result.success === false && /REMOTE_WORKSPACES_UNAVAILABLE/.test(result.error),
      ),
    );
    assert.match(preload.bindError, /REMOTE_WORKSPACES_UNAVAILABLE/);
    assert.equal(preload.docker, false);
    assert.deepEqual([preload.wsl, preload.containers, preload.ssh], [[], [], []]);
    const bypass = await app.evaluate(
      async ({ BrowserWindow }, { channels, targets }) => {
        const probe = globalThis.__remoteBackendProbe;
        const win = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().includes("index.html"),
        );
        const event = { sender: win.webContents };
        const results = [];
        for (const target of targets)
          results.push(
            await probe.handlers.get(channels.ConnectRemote)(event, {
              target,
              connectTrigger: "restore",
            }),
          );
        return {
          results,
          discovery: await Promise.all(
            [
              channels.ListWSLDistros,
              channels.ListDockerContainers,
              channels.ListSSHConfigAliases,
            ].map((channel) => probe.handlers.get(channel)()),
          ),
        };
      },
      { channels: PlatformChannels, targets },
    );
    assert(
      bypass.results.every(
        (result) => result.success === false && /REMOTE_WORKSPACES_UNAVAILABLE/.test(result.error),
      ),
    );
    assert.deepEqual(bypass.discovery, [[], [], []]);
    assert.equal(
      await app.evaluate(
        (_electron, type) =>
          globalThis.__remoteBackendProbe.hosts[0].sent.filter((value) => value === type).length,
        HostMessageTypes.ConnectRemoteWorkspace,
      ),
      0,
    );
    await app.evaluate(
      ({ MessageChannelMain }, { types, targets }) => {
        const host = globalThis.__remoteBackendProbe.hosts[0];
        targets.forEach((target, index) =>
          host.child.postMessage({
            type: types.ConnectRemoteWorkspace,
            requestId: `host-old-${index}`,
            target,
            remoteAssets: {},
          }),
        );
        for (const scope of [
          { kind: "local" },
          {
            kind: "remote",
            remoteSessionId: "old",
            workspacePath: "/same",
            workspaceIdentity: "old",
          },
        ]) {
          const { port1, port2 } = new MessageChannelMain();
          port2.on("close", () => {
            host.closedPorts++;
          });
          port2.start();
          host.child.postMessage(
            {
              type: types.AttachServicePort,
              requestId: `old-${scope.kind}`,
              attachmentId: `old-${scope.kind}`,
              scope,
              clientMode: scope.kind === "local" ? "web-remote-replayable" : "desktop-continuous",
            },
            [port1],
          );
        }
      },
      { types: HostMessageTypes, targets },
    );
    await waitFor(
      async () =>
        await app.evaluate(
          (_electron, type) =>
            globalThis.__remoteBackendProbe.hosts[0].responses.filter(
              (value) => value.type === type && value.requestId?.startsWith("host-old-"),
            ).length === 3,
          HostResponseTypes.RemoteWorkspaceConnectFailed,
        ),
      "Host rejected all legacy remote targets",
      10_000,
    );
    assert(
      await app.evaluate(
        (_electron, type) =>
          globalThis.__remoteBackendProbe.hosts[0].responses
            .filter((value) => value.type === type)
            .every((value) => value.error === "REMOTE_WORKSPACES_UNAVAILABLE"),
        HostResponseTypes.RemoteWorkspaceConnectFailed,
      ),
    );
    await waitFor(
      async () =>
        await app.evaluate(() => globalThis.__remoteBackendProbe.hosts[0].closedPorts === 2),
      "Host closed both disabled attachment ports",
    );
    const rpcMessage = (type, id, channel, name, arg) => {
      const writer = new BufferWriter();
      serialize(writer, [type, id, channel, name]);
      serialize(writer, arg);
      return Array.from(writer.buffer.buffer);
    };
    const eventMessages = [
      [
        IZCodeAgentService.channelName,
        "onDynamicConversationFrame",
        { workspaceIdentity: oldHistory[0].workspaceIdentity },
      ],
      [
        IZCodeAgentService.channelName,
        "onDynamicConversationFrame",
        { workspaceIdentity: ` ${oldHistory[1].workspaceIdentity} ` },
      ],
      [
        IZCodeAgentService.channelName,
        "onDynamicConversationFrame",
        { remoteSessionId: "legacy-remote" },
      ],
      [
        IZCodeTaskService.channelName,
        "onDynamicTaskEvent",
        { workspaceIdentity: oldHistory[2].workspaceIdentity },
      ],
    ].map(([channel, name, target], index) =>
      rpcMessage(102, index + 1, channel, name, { workspacePath, taskId: "fixture", ...target }),
    );
    await app.evaluate(
      ({ MessageChannelMain }, { types, eventMessages }) => {
        const host = globalThis.__remoteBackendProbe.hosts[0];
        host.eventRejectedPorts = 0;
        eventMessages.forEach((bytes, index) => {
          const { port1, port2 } = new MessageChannelMain();
          let sent = false;
          port2.on("message", () => {
            if (sent) return;
            sent = true;
            port2.postMessage(Uint8Array.from(bytes));
          });
          port2.on("close", () => host.eventRejectedPorts++);
          port2.start();
          host.child.postMessage(
            {
              type: types.AttachServicePort,
              requestId: `event-${index}`,
              attachmentId: `event-${index}`,
              scope: { kind: "local" },
              clientMode: "desktop-continuous",
            },
            [port1],
          );
        });
      },
      { types: HostMessageTypes, eventMessages },
    );
    await waitFor(
      async () =>
        await app.evaluate(() => globalThis.__remoteBackendProbe.hosts[0].eventRejectedPorts === 4),
      "only offending EventListen attachments close",
    );
    await assertTaskRpcAdmission(app, {
      workspacePath,
      workspaceIdentity: oldHistory[0].workspaceIdentity,
    });
    report.cases.push(
      `run ${run + 1}: preload/Main/Host bypass rejected discovery/connect/remote/replay; four Agent/Task EventListen ports closed; four Task Promise refusals keep same attachment open for local Task/Agent RPC; same Host/UI still live`,
    );
    report[`exit${run}`] = await closeBaseline(app);
    app = undefined;
    const settings = JSON.parse(await readFile(settingPath, "utf8"));
    for (const old of oldHistory)
      assert(
        settings.lastWorkspaceSession.some(
          (entry) => entry.kind === "remote" && entry.workspaceIdentity === old.workspaceIdentity,
        ),
      );
    assert.equal(await readFile(oldPairingPath, "utf8"), oldPairing);
  }
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  if (app)
    report.hostResponses = await app.evaluate(() =>
      globalThis.__remoteBackendProbe.hosts.map((host) =>
        host.responses.map((message) => ({
          type: message.type,
          requestId: message.requestId,
          error: message.error,
        })),
      ),
    );
  throw error;
} finally {
  if (app) await app.close();
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(artifacts, "runtime.log"), log.join(""));
  console.log(JSON.stringify({ artifacts, passed: report.passed }));
}
