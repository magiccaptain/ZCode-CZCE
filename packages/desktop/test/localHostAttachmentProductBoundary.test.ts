import assert from "node:assert/strict";
import test from "node:test";
import { createWindowHostAttachmentRegistry } from "../src/host/windowHostAttachmentRegistry.js";
const productCapabilities = Object.freeze({ remoteWorkspaces: false, mobileRemoteControl: false });

test("two local window registries keep independent attachment/teardown; remote and phone scopes have no exposure", () => {
  const exposed: string[] = [];
  const disposed: string[] = [];
  const registries = ["window1", "window2"].map((name) =>
    createWindowHostAttachmentRegistry({
      productCapabilities,
      resolveScope: () => ({ services: name, generation: 1 }),
      expose: ({ services }) => {
        exposed.push(services);
        return {
          dispose: () => {
            disposed.push(services);
          },
        };
      },
    }),
  );
  for (const registry of registries) {
    const port = { once() {} };
    assert.throws(
      () =>
        registry.attach({
          requestId: "old",
          attachmentId: "same",
          clientMode: "web-remote-replayable",
          scope: { kind: "local" },
          port,
        }),
      /MOBILE_REMOTE_CONTROL_UNAVAILABLE/,
    );
    assert.throws(
      () =>
        registry.attach({
          requestId: "old",
          attachmentId: "same",
          clientMode: "desktop-continuous",
          scope: {
            kind: "remote",
            remoteSessionId: "old",
            workspacePath: "/same",
            workspaceIdentity: "old",
          },
          port,
        }),
      /REMOTE_WORKSPACES_UNAVAILABLE/,
    );
    assert.deepEqual(exposed, []);
  }
  for (const registry of registries)
    registry.attach({
      requestId: "local",
      attachmentId: "same",
      clientMode: "desktop-continuous",
      scope: { kind: "local" },
      port: { once() {} },
    });
  assert.deepEqual(exposed, ["window1", "window2"]);
  registries[0]!.detach("same");
  assert.deepEqual(disposed, ["window1"]);
  registries[1]!.detach("same");
  registries[1]!.detach("same");
  assert.deepEqual(disposed, ["window1", "window2"]);
});
