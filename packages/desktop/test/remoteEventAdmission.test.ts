import assert from "node:assert/strict";
import test from "node:test";
import { BufferWriter, ChannelServer, Emitter, serialize, Event } from "@zcode/rpc";
import { REMOTE_WORKSPACES_UNAVAILABLE } from "@zcode/shared";
import { createRemoteEventAdmissionHandler } from "../src/host/remoteEventAdmission.js";

function serverFixture(handler?: (error: unknown) => boolean) {
  const input = new Emitter<any>();
  const server = new ChannelServer(
    { onMessage: input.event, send() {} },
    "host",
    1000,
    false,
    handler,
  );
  return {
    server,
    listen() {
      const writer = new BufferWriter();
      serialize(writer, [102, 1, "fixture", "onDynamicEvent"]);
      serialize(writer, {});
      input.fire(writer.buffer);
    },
    dispose() {
      server.dispose();
      input.dispose();
    },
  };
}

test("RPC EventListen isolates expected event lookup and registration refusal only when handled", () => {
  for (const phase of ["lookup", "registration"] as const) {
    let disposals = 0;
    const fixture = serverFixture(createRemoteEventAdmissionHandler(() => disposals++));
    const error = new Error(REMOTE_WORKSPACES_UNAVAILABLE);
    fixture.server.registerChannel("fixture", {
      call: async () => undefined as any,
      listen: () => {
        if (phase === "lookup") throw error;
        return () => {
          throw error;
        };
      },
    });
    try {
      assert.doesNotThrow(() => fixture.listen());
      assert.equal(disposals, 1);
    } finally {
      fixture.dispose();
    }
  }
});

test("RPC default, false handler, plain objects and near-match errors retain original EventListen exceptions", () => {
  for (const [error, handler] of [
    [new Error(REMOTE_WORKSPACES_UNAVAILABLE), undefined],
    [new Error(REMOTE_WORKSPACES_UNAVAILABLE), () => false],
    [
      { message: REMOTE_WORKSPACES_UNAVAILABLE },
      createRemoteEventAdmissionHandler(() => assert.fail("not expected")),
    ],
    [
      new Error(`${REMOTE_WORKSPACES_UNAVAILABLE}: detail`),
      createRemoteEventAdmissionHandler(() => assert.fail("not expected")),
    ],
    [new Error("unexpected"), createRemoteEventAdmissionHandler(() => assert.fail("not expected"))],
  ] as const) {
    const fixture = serverFixture(handler);
    fixture.server.registerChannel("fixture", {
      call: async () => undefined as any,
      listen: () => {
        throw error;
      },
    });
    try {
      assert.throws(
        () => fixture.listen(),
        (thrown) => thrown === error,
      );
    } finally {
      fixture.dispose();
    }
  }
});

test("RPC event delivery errors stay outside the EventListen admission handler", () => {
  const events = new Emitter<unknown>();
  let handled = 0;
  const fixture = serverFixture(() => {
    handled++;
    return true;
  });
  const error = new Error("event delivery bug");
  fixture.server.registerChannel("fixture", {
    call: async () => undefined as any,
    listen: () => events.event as Event<any>,
  });
  try {
    fixture.listen();
    assert.throws(
      () =>
        events.fire({
          toJSON() {
            throw error;
          },
        }),
      (thrown) => thrown === error,
    );
    assert.equal(handled, 0);
  } finally {
    fixture.dispose();
    events.dispose();
  }
});
