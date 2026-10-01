import assert from "node:assert/strict";
import test from "node:test";
import { Emitter, Event } from "@zcode/rpc";
import { REMOTE_WORKSPACES_UNAVAILABLE } from "@zcode/shared";
import { createZCodeTaskServiceAdapter } from "../src/zcode-agent/zcodeTaskServiceAdapter.js";

test("Task EventListen acquires upstream before local effects, registers local first, and releases local on registration failure", () => {
  type Options = Parameters<typeof createZCodeTaskServiceAdapter>[0];
  let upstreamDisposals = 0;
  const refusal = new Error(REMOTE_WORKSPACES_UNAVAILABLE);
  const order: string[] = [];
  const service = createZCodeTaskServiceAdapter({
    zcodeAgentService: {
      onDynamicSessionEvent: (params: { workspaceIdentity?: string }) => {
        order.push("lookup");
        return () => {
          order.push("upstream-listener");
          if (params.workspaceIdentity) throw refusal;
          return {
            dispose() {
              upstreamDisposals++;
            },
          };
        };
      },
      disposeAll() {},
    } as unknown as Options["zcodeAgentService"],
    taskIndexSyncer: {
      onSessionTerminalEvent: Event.None,
      onSessionReadyEvent: Event.None,
      disposeAll() {},
    } as unknown as Options["taskIndexSyncer"],
  });
  const descriptor = Object.getOwnPropertyDescriptor(Emitter.prototype, "event")!;
  const registrations: { disposed: number }[] = [];
  Object.defineProperty(Emitter.prototype, "event", {
    ...descriptor,
    get() {
      const event = descriptor.get!.call(this);
      return (listener: (value: unknown) => void) => {
        order.push("local-listener");
        const entry = { disposed: 0 };
        registrations.push(entry);
        const disposable = event(listener);
        return {
          dispose() {
            entry.disposed++;
            disposable.dispose();
          },
        };
      };
    },
  });
  let normal: { dispose(): void } | undefined;
  try {
    const event = service.onDynamicTaskEvent({ workspacePath: "/fixture", taskId: "local" });
    assert.deepEqual(order, ["lookup"], "upstream admission runs before any local registration");
    normal = event(() => {});
    assert.deepEqual(order, ["lookup", "local-listener", "upstream-listener"]);
    for (let index = 0; index < 3; index++) {
      order.length = 0;
      assert.throws(
        () =>
          service.onDynamicTaskEvent({
            workspacePath: "/fixture",
            taskId: "old",
            workspaceIdentity: "remote-fixture",
          })(() => {}),
        (error) => error === refusal,
      );
      assert.deepEqual(order, ["lookup", "local-listener", "upstream-listener"]);
      assert.equal(registrations[0]!.disposed, 0, "normal subscription stays live");
      assert.equal(registrations.filter((entry) => entry.disposed === 0).length, 1);
      assert(registrations.slice(1).every((entry) => entry.disposed === 1));
      assert.equal(upstreamDisposals, 0);
    }
    normal.dispose();
    normal = undefined;
    assert(registrations.every((entry) => entry.disposed === 1));
    assert.equal(upstreamDisposals, 1);
  } finally {
    normal?.dispose();
    Object.defineProperty(Emitter.prototype, "event", descriptor);
    service.disposeAll();
  }
});
