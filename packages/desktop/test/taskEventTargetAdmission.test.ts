import assert from "node:assert/strict";
import test from "node:test";
import {
  BufferReader,
  BufferWriter,
  ChannelServer,
  Emitter,
  Event,
  ProxyChannel,
  deserialize,
  serialize,
} from "@zcode/rpc";
import { assertWorkspaceTargetAvailable, buildRemoteWorkspaceIdentity } from "@zcode/shared";
import { createZCodeTaskServiceAdapter } from "@zcode/services/node";
import { DESKTOP_PRODUCT_CAPABILITIES } from "../src/main/productCapabilities.js";
import { createRemoteEventAdmissionHandler } from "../src/host/remoteEventAdmission.js";

test("rejected same-task remote EventListen cannot replace the local target used by taskId-only model and close RPCs", async (t) => {
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  const workspacePath = "/fixture/workspace";
  const taskId = "same-task-T";
  const model = { providerId: "fixture", modelId: "fixture-model" };
  const localTarget = { workspacePath, workspaceIdentity: undefined, sessionId: taskId };
  const admittedCalls: { name: string; target: typeof localTarget }[] = [];
  let localUpstreamDisposals = 0;
  const agent = {
    onDynamicSessionEvent: () => () => ({
      dispose() {
        localUpstreamDisposals++;
      },
    }),
    async readSession(target: typeof localTarget) {
      admittedCalls.push({ name: "read", target });
      return { settings: { model: { current: model } } };
    },
    async closeSession(target: typeof localTarget) {
      admittedCalls.push({ name: "close", target });
      return true;
    },
    disposeAll() {},
  };
  const guardedAgent = new Proxy(agent, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: any[]) => {
        if (args[0]) assertWorkspaceTargetAvailable(DESKTOP_PRODUCT_CAPABILITIES, args[0]);
        return value.apply(target, args);
      };
    },
  });
  const service = createZCodeTaskServiceAdapter({
    zcodeAgentService: guardedAgent as unknown as Options["zcodeAgentService"],
    taskIndexRepo: {
      updateTaskState: async () => ({}),
      close() {},
    } as unknown as Options["taskIndexRepo"],
    taskIndexSyncer: {
      onSessionTerminalEvent: Event.None,
      onSessionReadyEvent: Event.None,
      emitWorkspaceTaskListChanged() {},
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
  });
  const open = () => {
    const incoming = new Emitter<any>();
    const responses: any[] = [];
    let closed = false;
    let id = 0;
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
    server.registerChannel("Task", ProxyChannel.fromService(service));
    const send = (type: number, name: string, arg: unknown) => {
      const writer = new BufferWriter();
      serialize(writer, [type, ++id, "Task", name]);
      serialize(writer, arg);
      incoming.fire(writer.buffer);
    };
    return {
      get closed() {
        return closed;
      },
      listen: (target: object) => send(102, "onDynamicTaskEvent", target),
      async call(name: string) {
        send(100, name, [{ taskId }]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const reader = new BufferReader(responses.at(-1));
        const header = deserialize(reader);
        const result = deserialize(reader);
        assert.equal(header[0], 201, `local ${name} must succeed: ${JSON.stringify(result)}`);
        return result;
      },
      dispose() {
        server.dispose();
        incoming.dispose();
      },
    };
  };
  const local = open();
  try {
    local.listen({ workspacePath, taskId });
    assert.deepEqual(await local.call("getTaskModelSelection"), model);
    for (const target of [
      { kind: "ssh", host: "fixture", username: "fixture" } as const,
      { kind: "wsl", distro: "fixture" } as const,
      { kind: "docker", container: "fixture" } as const,
    ]) {
      const identity = buildRemoteWorkspaceIdentity(workspacePath, target);
      for (const workspaceIdentity of [identity, ` ${identity} `]) {
        const bad = open();
        try {
          assert.doesNotThrow(() => bad.listen({ workspacePath, taskId, workspaceIdentity }));
          assert.equal(bad.closed, true);
          assert.equal(local.closed, false);
          assert.equal(localUpstreamDisposals, 0, "normal same-task listener must stay live");
          const suffix = workspaceIdentity === identity ? "" : " with whitespace";
          await t.test(`same T local model survives rejected ${target.kind}${suffix}`, async () => {
            assert.deepEqual(await local.call("getTaskModelSelection"), model);
          });
          await t.test(`same T local close survives rejected ${target.kind}${suffix}`, async () => {
            await local.call("closeTask");
          });
          for (const call of admittedCalls) assert.deepEqual(call.target, localTarget);
        } finally {
          bad.dispose();
        }
      }
    }
  } finally {
    local.dispose();
    assert.equal(localUpstreamDisposals, 1);
    service.disposeAll();
  }
});
