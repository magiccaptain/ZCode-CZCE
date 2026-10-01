import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appSettingsSchema,
  buildRemoteWorkspaceIdentity,
  ZCODE_AGENT_PROVIDER_NOT_READY_CODE,
} from "@zcode/shared";
import {
  IBotsService,
  IModelSelectionService,
  IZCodeAgentService,
  IZCodeSessionService,
  IZCodeTaskService,
  createZCodeAgentConnectionScope,
} from "@zcode/services";
import {
  createLocalServices,
  disposeServiceResourcesAndWait,
  setDataBaseDir,
} from "@zcode/services/node";
import { ChannelServer, ProxyChannel, Emitter, BufferWriter, serialize } from "@zcode/rpc";
import { DESKTOP_PRODUCT_CAPABILITIES } from "../src/main/productCapabilities.js";
import { createRemoteEventAdmissionHandler } from "../src/host/remoteEventAdmission.js";

test("Desktop same-owner assembly preserves local Bots and continuous handshake but rejects old remote targets and mobile scope", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-remote-assembly-"));
  setDataBaseDir(root);
  const workspaceIdentity = buildRemoteWorkspaceIdentity(root, {
    kind: "docker",
    container: "fixture",
  });
  const settings = appSettingsSchema.parse({
    lastWorkspaceSession: [
      { kind: "local", workspacePath: root },
      {
        kind: "remote",
        workspacePath: root,
        workspaceIdentity,
        target: { kind: "docker", container: "fixture" },
        lastOpenedAt: 1,
        lastConnectionStatus: "connected",
      },
    ],
  });
  const originalSettings = JSON.stringify(settings);
  let commands = 0;
  let spawns = 0;
  const localCommandReached = new Error("Local request reached the original command resolver");
  let services: ReturnType<typeof createLocalServices> | undefined;
  let scope: ReturnType<typeof createZCodeAgentConnectionScope> | undefined;
  try {
    services = createLocalServices({
      productCapabilities: DESKTOP_PRODUCT_CAPABILITIES,
      serviceAuthorityMode: "desktop-local",
      zcodeBuiltinProviderConfigFilePath: fileURLToPath(
        new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
      ),
      runtimeProcessEnvPatch: {},
      zcodeAgentCommandResolver: () => {
        commands++;
        throw localCommandReached;
      },
      processLifecycleReporter: {
        onSpawn: () => spawns++,
        onExit() {},
      },
      hostApiNetworkTransport: {
        fetch: async () => new Response("not found", { status: 404 }),
        dispose() {},
        disposeAndWait: async () => {},
      },
      settingService: {
        get: async () => settings,
        update: async () => assert.fail("must not mutate old history"),
        updateDataBaseDir: async () => {},
        ensureDefaultProject: async () => ({ path: root, created: false }),
      },
    });
    // 等待原 Provider owner 初始化再释放，避免测试清理与异步写文件竞争。
    await services.get(IModelSelectionService).getView();
    const bots = services.get(IBotsService);
    assert.deepEqual(
      (
        await bots.listWorkspaceRefs({
          currentWorkspace: {
            id: workspaceIdentity,
            label: "legacy",
            workspacePath: root,
            workspaceIdentity: `  ${workspaceIdentity}  `,
          },
        })
      ).map((workspace) => workspace.id),
      [root],
    );
    await assert.rejects(
      () => bots.createBindCode({ botId: "fixture", allowedWorkspaces: [workspaceIdentity] }),
      /REMOTE_WORKSPACES_UNAVAILABLE/,
    );
    const agent = services.get(IZCodeAgentService);
    const sessions = services.get(IZCodeSessionService);
    const tasks = services.get(IZCodeTaskService);
    for (const target of [
      { kind: "ssh", host: "fixture", port: 22, username: "fixture" } as const,
      { kind: "wsl", distro: "fixture" } as const,
      { kind: "docker", container: "fixture" } as const,
    ]) {
      const identity = buildRemoteWorkspaceIdentity(root, target);
      for (const legacyIdentity of [identity, `  ${identity}  `]) {
        for (const [name, request] of [
          [
            "Session",
            () =>
              sessions.readWorkspacePresentation({
                workspacePath: root,
                workspaceIdentity: legacyIdentity,
              }),
          ],
          [
            "Task",
            () => tasks.createTask({ workspacePath: root, workspaceIdentity: legacyIdentity }),
          ],
          [
            "Agent",
            () =>
              agent.readWorkspacePresentation({
                workspacePath: root,
                workspaceIdentity: legacyIdentity,
              }),
          ],
        ] as const) {
          await t.test(
            `${name} rejects ${target.kind} identity${legacyIdentity === identity ? "" : " with whitespace"} before runtime admission`,
            async () => {
              const commandsBefore = commands;
              await assert.rejects(async () => request(), /REMOTE_WORKSPACES_UNAVAILABLE/);
              assert.equal(commands, commandsBefore);
              assert.equal(spawns, 0);
            },
          );
        }
      }
    }
    await t.test(
      "public Session rejects legacy remoteSessionId before runtime admission",
      async () => {
        const commandsBefore = commands;
        await assert.rejects(
          async () =>
            sessions.readWorkspacePresentation({
              workspacePath: root,
              remoteSessionId: "legacy-remote",
            }),
          /REMOTE_WORKSPACES_UNAVAILABLE/,
        );
        assert.equal(commands, commandsBefore);
        assert.equal(spawns, 0);
      },
    );
    assert.throws(
      () =>
        createZCodeAgentConnectionScope(
          agent,
          { connectionId: "legacy-phone", clientMode: "web-remote-replayable" },
          DESKTOP_PRODUCT_CAPABILITIES,
        ),
      /MOBILE_REMOTE_CONTROL_UNAVAILABLE/,
    );
    scope = createZCodeAgentConnectionScope(
      agent,
      { connectionId: "local-window", clientMode: "desktop-continuous" },
      DESKTOP_PRODUCT_CAPABILITIES,
    );
    await scope.service.helloConversationV4();
    await scope.service.initializeConversationV4({
      kind: "clientHello",
      protocolVersion: 3,
      appVersion: "fixture",
      clientId: "fixture",
    });
    for (const target of [
      { workspaceIdentity },
      { workspaceIdentity: `  ${workspaceIdentity}  ` },
      { remoteSessionId: "legacy-remote" },
    ])
      await assert.rejects(
        async () => scope!.service.queryConversationCommandsV4({ workspacePath: root, ...target }),
        /REMOTE_WORKSPACES_UNAVAILABLE/,
      );
    await t.test(
      "real RPC EventListen rejects only the offending Agent/Task attachment",
      async () => {
        const liveEvents = new Emitter<string>();
        const open = () => {
          const incoming = new Emitter<any>();
          const responses: any[] = [];
          let closed = false;
          const server = new ChannelServer(
            { onMessage: incoming.event, send: (message) => responses.push(message) },
            "host",
            1000,
            false,
            createRemoteEventAdmissionHandler(() => {
              closed = true;
              server.dispose();
            }),
          );
          server.registerChannel("Agent", ProxyChannel.fromService(scope!.service));
          server.registerChannel("Task", ProxyChannel.fromService(tasks));
          server.registerChannel(
            "Local",
            ProxyChannel.fromService({ onDynamicLocal: () => liveEvents.event }),
          );
          return {
            server,
            responses,
            get closed() {
              return closed;
            },
            send(channel: string, name: string, arg: unknown, type = 102) {
              const writer = new BufferWriter();
              serialize(writer, [type, type === 102 ? 1 : 2, channel, name]);
              serialize(writer, arg);
              incoming.fire(writer.buffer);
            },
          };
        };
        const local = open();
        try {
          local.send("Local", "onDynamicLocal", {});
          for (const [channel, event, target] of [
            ["Agent", "onDynamicConversationFrame", { workspaceIdentity }],
            [
              "Agent",
              "onDynamicConversationFrame",
              { workspaceIdentity: ` ${workspaceIdentity} ` },
            ],
            ["Agent", "onDynamicConversationFrame", { remoteSessionId: "legacy-remote" }],
            ["Task", "onDynamicTaskEvent", { workspaceIdentity }],
            ["Task", "onDynamicTaskEvent", { workspaceIdentity: ` ${workspaceIdentity} ` }],
          ] as const) {
            const bad = open();
            try {
              assert.doesNotThrow(() =>
                bad.send(channel, event, { workspacePath: root, taskId: "fixture", ...target }),
              );
              assert.equal(bad.closed, true);
              assert.equal(bad.responses.length, 1, "only Initialize; no false EventFire success");
              const before = local.responses.length;
              liveEvents.fire("local still live");
              assert.equal(local.responses.length, before + 1);
              assert.equal(local.closed, false);
              const beforeRequest = local.responses.length;
              local.send("Agent", "helloConversationV4", [], 100);
              await new Promise<void>((resolve) => setImmediate(resolve));
              assert.equal(
                local.responses.length,
                beforeRequest + 1,
                "local Agent Promise request still responds",
              );
              assert.equal(commands, 0);
              assert.equal(spawns, 0);
            } finally {
              bad.server.dispose();
            }
          }
        } finally {
          local.server.dispose();
          liveEvents.dispose();
        }
      },
    );
    assert.equal(commands, 0);
    assert.equal(spawns, 0);
    await assert.rejects(
      async () => sessions.readWorkspacePresentation({ workspacePath: root }),
      (error: unknown) => error === localCommandReached,
    );
    assert.equal(commands, 1);
    await assert.rejects(
      () => tasks.createTask({ workspacePath: root }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === ZCODE_AGENT_PROVIDER_NOT_READY_CODE,
    );
    assert.equal(commands, 1);
    assert.equal(spawns, 0);
    assert.equal(JSON.stringify(settings), originalSettings);
  } finally {
    if (scope) await scope.dispose();
    if (services) await disposeServiceResourcesAndWait(services);
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});
