import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  BufferReader,
  BufferWriter,
  ChannelServer,
  Emitter,
  serialize,
  deserialize,
} from "@zcode/rpc";
import {
  IZCodeAgentService,
  IZCodeTaskService,
  IModelSelectionService,
  collectServiceMemoryDiagnostics,
} from "@zcode/services";
import {
  createLocalServices,
  disposeServiceResourcesAndWait,
  setDataBaseDir,
} from "@zcode/services/node";
import {
  appSettingsSchema,
  buildRemoteWorkspaceIdentity,
  ZCODE_PROTOCOL_NAME,
  ZCODE_PROTOCOL_VERSION,
  zcodeSessionStateSnapshotSchema,
} from "@zcode/shared";
import { DESKTOP_PRODUCT_CAPABILITIES } from "../src/main/productCapabilities.js";
import { createRemoteEventAdmissionHandler } from "../src/host/remoteEventAdmission.js";

test("public Task admission rejects snapshot/cache and nested batch targets before any Task business effects", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-task-admission-"));
  setDataBaseDir(root);
  let commands = 0,
    spawns = 0,
    mcpPreparations = 0;
  const services = createLocalServices({
    productCapabilities: DESKTOP_PRODUCT_CAPABILITIES,
    serviceAuthorityMode: "desktop-local",
    zcodeBuiltinProviderConfigFilePath: fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    ),
    runtimeProcessEnvPatch: {},
    zcodeAgentCommandResolver: () => {
      commands++;
      throw Error("unexpected resolver");
    },
    processLifecycleReporter: {
      onSpawn() {
        spawns++;
      },
      onExit() {},
    },
    cuaProductMcpServerResolver: {
      resolveMcpServers: async (servers: any) => {
        mcpPreparations++;
        return servers;
      },
    } as any,
    hostApiNetworkTransport: {
      fetch: async () => new Response("not found", { status: 404 }),
      dispose() {},
      disposeAndWait: async () => {},
    },
    settingService: {
      get: async () => appSettingsSchema.parse({}),
      update: async () => assert.fail("settings write"),
      updateDataBaseDir: async () => {},
      ensureDefaultProject: async () => ({ path: root, created: false }),
    },
  });
  const taskId = "same-local-T";
  const model = { providerId: "fixture", modelId: "fixture-model" };
  const snapshot = zcodeSessionStateSnapshotSchema.parse({
    protocol: { name: ZCODE_PROTOCOL_NAME, version: ZCODE_PROTOCOL_VERSION },
    session: {
      sessionId: taskId,
      workspace: { workspacePath: root, workspaceKey: root },
      sessionKind: "interactive",
      title: "Fixture local T",
      mode: "build",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
    },
    settings: {
      model: { available: [], current: model },
      thoughtLevel: { enabled: false, available: [] },
      mode: { current: "build" },
    },
    projection: {
      sessionId: taskId,
      status: "idle",
      mode: "build",
      turnCount: 0,
      totalTokenCount: 0,
      contextUsed: 0,
      contextWindow: 200000,
      pendingPermissions: [],
      activeToolCalls: [],
      backgroundJobs: [],
    },
    runtime: { eventSeq: 0, stateRevision: 0, pendingRequestIds: [] },
    messages: [],
  });
  const agent = services.get(IZCodeAgentService);
  const originals = new Map<string, unknown>();
  const admittedTargets: any[] = [];
  // 只替换进程/协议端口的成功结果；实际装配的 Agent proxy guard 保留，Task 不手工包 guard。
  for (const [name, value] of Object.entries({
    onDynamicSessionEvent: () => () => ({ dispose() {} }),
    resumeSession: async (target: unknown) => {
      admittedTargets.push(target);
      return snapshot;
    },
    readSession: async (target: unknown) => {
      admittedTargets.push(target);
      return snapshot;
    },
    closeSession: async (target: unknown) => {
      admittedTargets.push(target);
      return true;
    },
  })) {
    originals.set(name, Reflect.get(agent, name));
    Reflect.set(agent, name, value);
  }
  const open = () => {
    const incoming = new Emitter<any>();
    const pending = new Map<number, (response: { type: number; body: any }) => void>();
    let closed = false,
      id = 0;
    const server = new ChannelServer(
      {
        onMessage: incoming.event,
        send: (message) => {
          const reader = new BufferReader(message);
          const header = deserialize(reader),
            body = deserialize(reader);
          const resolve = pending.get(header[1]);
          if (resolve) {
            pending.delete(header[1]);
            resolve({ type: header[0], body });
          }
        },
      },
      "host",
      1000,
      false,
      createRemoteEventAdmissionHandler(() => {
        closed = true;
        server.dispose();
      }),
    );
    services.exposeOnChannelServer(server);
    const send = (type: number, name: string, arg: unknown) => {
      const writer = new BufferWriter();
      serialize(writer, [type, ++id, IZCodeTaskService.channelName, name]);
      serialize(writer, arg);
      incoming.fire(writer.buffer);
    };
    return {
      get closed() {
        return closed;
      },
      listen: () => send(102, "onDynamicTaskEvent", { workspacePath: root, taskId }),
      async call(name: string, params: unknown) {
        const response = new Promise<{ type: number; body: any }>((resolve) =>
          pending.set(id + 1, resolve),
        );
        send(100, name, [params]);
        return response;
      },
      dispose() {
        server.dispose();
        incoming.dispose();
      },
    };
  };
  let local: ReturnType<typeof open> | undefined,
    bad: ReturnType<typeof open> | undefined,
    database: DatabaseSync | undefined;
  try {
    await services.get(IModelSelectionService).getView();
    local = open();
    bad = open();
    assert.equal((await local.call("getTaskSnapshot", { workspacePath: root, taskId })).type, 201);
    local.listen();
    const assertLocalTask = async () => {
      await t.test("same T local model survives snapshot refusal", async () => {
        const result = await local!.call("getTaskModelSelection", { taskId });
        assert.equal(result.type, 201, JSON.stringify(result.body));
        assert.deepEqual(result.body, model);
      });
      assert.equal(local!.closed, false);
      assert.equal(bad!.closed, false, "Promise refusal does not dispose either port");
    };
    const identity = buildRemoteWorkspaceIdentity(root, { kind: "docker", container: "fixture" });
    for (const target of [
      { remoteSessionId: "legacy-remote" },
      { workspaceIdentity: identity },
      { workspaceIdentity: ` ${identity} ` },
    ]) {
      await t.test(`snapshot refusal preserves same T for ${JSON.stringify(target)}`, async () => {
        const result = await bad!.call("getTaskSnapshot", {
          workspacePath: root,
          taskId,
          ...target,
        });
        assert.equal(result.type, 202);
        assert.equal(result.body.message, "REMOTE_WORKSPACES_UNAVAILABLE");
      });
      await assertLocalTask();
    }
    await t.test("same T local close survives all snapshot refusals", async () => {
      const closed = await local!.call("closeTask", { taskId });
      assert.equal(closed.type, 201, JSON.stringify(closed.body));
    });
    const mcpServers = [{ name: "fixture", command: "fixture", args: [] }];
    for (const name of ["createTask", "resumeTask"])
      await t.test(`${name} refuses before MCP preparation`, async () => {
        const before = mcpPreparations;
        const result = await bad!.call(name, {
          workspacePath: root,
          taskId,
          workspaceIdentity: ` ${identity} `,
          mcpServers,
        });
        assert.equal(result.type, 202);
        assert.equal(result.body.message, "REMOTE_WORKSPACES_UNAVAILABLE");
        assert.equal(mcpPreparations, before);
      });
    const localScope = { workspacePath: root },
      remoteScope = { workspacePath: root, workspaceIdentity: ` ${identity} ` };
    const group = (await local.call("createTaskGroup", { title: "local group" })).body;
    database = new DatabaseSync(join(root, ".zcode/v2/tasks-index.sqlite"));
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'",
      )
      .all()
      .map((row) => String(row.name));
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    // 在真实 Repo 的数据库安装拒绝写入 trap：若先写后 guard，返回的将是该 SQL 错误而非产品拒绝。
    for (const [index, name] of tables.entries())
      for (const operation of ["INSERT", "UPDATE", "DELETE"])
        database.exec(
          `CREATE TRIGGER ${quote(`admission_${index}_${operation}`)} BEFORE ${operation} ON ${quote(name)} BEGIN SELECT RAISE(ABORT, 'MUTATION_BEFORE_ADMISSION'); END`,
        );
    const state = () =>
      JSON.stringify(tables.map((name) => database!.prepare(`SELECT * FROM ${quote(name)}`).all()));
    const beforeState = state();
    const beforeMemory = Object.fromEntries(
      Object.entries(collectServiceMemoryDiagnostics()).filter(([key]) => key.startsWith("task.")),
    );
    assert("task.overlays" in beforeMemory && "task.taskEmitters" in beforeMemory);
    const batch = { workspaceScopes: [localScope, remoteScope] };
    for (const [name, params] of [
      ["listTasks", remoteScope],
      ["getTaskMeta", { ...remoteScope, taskId }],
      ["deleteTask", { ...remoteScope, taskId }],
      [
        "sendPrompt",
        { taskId, remoteSessionId: "legacy-remote", traceId: "fixture", content: "not submitted" },
      ],
      ["listTaskList", { ...batch, kind: "timeline", sortBy: "updated" }],
      ["listGroupedTaskViewStructure", batch],
      ["renameTaskGroup", { ...batch, groupId: group.id, title: "must not change" }],
      ["updateTaskGroupColor", { ...batch, groupId: group.id, color: "red" }],
      ["deleteTaskGroup", { ...batch, groupId: group.id }],
      ["applyGroupedTaskViewOrder", { ...batch, topLevelNodes: [], groups: [] }],
      [
        "applyGroupedTaskViewOrder",
        {
          workspaceScopes: [localScope],
          topLevelNodes: [{ type: "task", task: { ...remoteScope, taskId } }],
          groups: [],
        },
      ],
      [
        "applyGroupedTaskViewOrder",
        {
          workspaceScopes: [localScope],
          topLevelNodes: [],
          groups: [
            {
              groupId: group.id,
              taskRefs: [
                { ...localScope, taskId },
                { ...remoteScope, taskId },
              ],
            },
          ],
        },
      ],
    ] as const)
      await t.test(
        `public ${name} mixed/remote target rejected before repo/overlay mutation`,
        async () => {
          const result = await bad!.call(name, params);
          assert.equal(result.type, 202);
          assert.equal(result.body.message, "REMOTE_WORKSPACES_UNAVAILABLE");
          assert.equal(state(), beforeState);
          assert.deepEqual(
            Object.fromEntries(
              Object.entries(collectServiceMemoryDiagnostics()).filter(([key]) =>
                key.startsWith("task."),
              ),
            ),
            beforeMemory,
          );
        },
      );
    for (const [index] of tables.entries())
      for (const operation of ["INSERT", "UPDATE", "DELETE"])
        database.exec(`DROP TRIGGER ${quote(`admission_${index}_${operation}`)}`);
    assert.equal(
      (
        await local.call("renameTaskGroup", {
          workspaceScopes: [localScope],
          groupId: group.id,
          title: "local allowed",
        })
      ).type,
      201,
    );
    assert.equal(
      (
        await local.call("listTaskList", {
          workspaceScopes: [localScope],
          kind: "timeline",
          sortBy: "updated",
        })
      ).type,
      201,
    );
    assert.equal(
      (
        await local.call("applyGroupedTaskViewOrder", {
          workspaceScopes: [localScope],
          topLevelNodes: [{ type: "group", groupId: group.id }],
          groups: [{ groupId: group.id, taskRefs: [] }],
        })
      ).type,
      201,
    );
    assert.equal(commands, 0);
    assert.equal(spawns, 0);
    assert.equal(mcpPreparations, 0, "all refused requests have no MCP effects");
    assert.equal(
      (await local.call("resumeTask", { workspacePath: root, taskId, mcpServers })).type,
      201,
    );
    assert.equal(mcpPreparations, 1, "normal local MCP preparation preserved");
    await t.test(
      "local blank identity and string workspace subscription keep existing parameter semantics",
      async () => {
        assert.equal(
          (
            await local!.call("getTaskSnapshot", {
              workspacePath: root,
              workspaceIdentity: "   ",
              taskId,
            })
          ).type,
          201,
        );
        assert(
          admittedTargets.some((target) => target.workspaceIdentity === "   "),
          "admission must not rewrite local parameters",
        );
        const disposable = services.get(IZCodeTaskService).onDynamicWorkspaceEvent(root)(() => {});
        disposable.dispose();
      },
    );
    assert(
      admittedTargets.every(
        (target) =>
          target.workspacePath === root &&
          !target.workspaceIdentity?.trim() &&
          !target.remoteSessionId,
      ),
    );
  } finally {
    database?.close();
    local?.dispose();
    bad?.dispose();
    for (const [name, value] of originals) Reflect.set(agent, name, value);
    await disposeServiceResourcesAndWait(services);
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});
