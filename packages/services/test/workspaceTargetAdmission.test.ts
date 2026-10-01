import assert from "node:assert/strict";
import test from "node:test";
import { buildRemoteWorkspaceIdentity } from "@zcode/shared";
import {
  withWorkspaceTargetAdmission,
  taskWorkspaceTargets,
} from "../src/workspaceTargetAdmission.js";

test("workspace admission preserves other products when capability is absent or enabled", () => {
  const service = { call: (input: unknown) => input };
  for (const capabilities of [undefined, { remoteWorkspaces: true }]) {
    const wrapped = withWorkspaceTargetAdmission(service, capabilities, () =>
      assert.fail("no disabled-product target parsing"),
    );
    assert.equal(wrapped, service);
    const input = { remoteSessionId: "legacy" };
    assert.equal(wrapped.call(input), input);
  }
});

test("typed Task collection admission accepts original local refs and rejects mixed refs before calling service", () => {
  let calls = 0;
  const service = {
    applyGroupedTaskViewOrder(input: object) {
      calls++;
      return input;
    },
  };
  const wrapped = withWorkspaceTargetAdmission(
    service,
    { remoteWorkspaces: false },
    taskWorkspaceTargets,
  );
  const local = { workspacePath: "/fixture", taskId: "local-T" };
  const input = {
    workspaceScopes: [local],
    topLevelNodes: [{ type: "task", task: local }],
    groups: [{ groupId: "fixture", taskRefs: [local] }],
  };
  assert.equal(wrapped.applyGroupedTaskViewOrder(input), input);
  assert.equal(calls, 1);
  const remote = {
    ...local,
    workspaceIdentity: buildRemoteWorkspaceIdentity(local.workspacePath, {
      kind: "docker",
      container: "fixture",
    }),
  };
  assert.throws(
    () =>
      wrapped.applyGroupedTaskViewOrder({
        ...input,
        groups: [{ groupId: "fixture", taskRefs: [local, remote] }],
      }),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  assert.equal(calls, 1);
});
