import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkspaceTargetAvailable, buildRemoteWorkspaceIdentity } from "@zcode/shared";
import { createBotRemoteWorkspaceService } from "../src/bots/botRemoteWorkspaceBridge.js";
import { createBotsService } from "../src/bots/botsService.js";
import { createZCodeAgentConnectionScope } from "../src/zcode-agent/zcodeAgentConnectionScope.js";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";
import type { ISettingService } from "../src/setting/setting.js";
import type { ICredentialService } from "../src/credential/credential.js";

const productCapabilities = Object.freeze({ remoteWorkspaces: false, mobileRemoteControl: false });
const noEffect = () => assert.fail("disabled remote effect");
const workspacePath = "/same";
const workspaceIdentity = buildRemoteWorkspaceIdentity(workspacePath, {
  kind: "docker",
  container: "fixture",
});

test("disabled Bot bridge neither reads old remote config/credentials nor registers/messages parentPort", async () => {
  const bridge = createBotRemoteWorkspaceService({
    productCapabilities,
    parentPort: { on: noEffect, postMessage: noEffect, off: noEffect },
    settingService: { get: noEffect } as unknown as ISettingService,
    credentialService: { load: noEffect } as unknown as ICredentialService,
  });
  assert(bridge);
  const target = { workspacePath, workspaceIdentity };
  assert.equal(await bridge.isConnected(target), false);
  assert.match((await bridge.ensureConnected(target)).message!, /REMOTE_WORKSPACES_UNAVAILABLE/);
  await assert.rejects(bridge.getZCodeTaskService(target), /REMOTE_WORKSPACES_UNAVAILABLE/);
  await assert.rejects(bridge.getModelSelectionService(target), /REMOTE_WORKSPACES_UNAVAILABLE/);
  await bridge.syncAppRuntimePreferences({
    askUserQuestionAutoResolutionEnabled: true,
    modelIoFullRetentionEnabled: false,
  });
  bridge.dispose();
});

test("local Bot workspace candidates remain usable; old remote history and new remote bind codes cannot restore remote scope", async () => {
  const history = [
    { kind: "local", workspacePath },
    {
      kind: "remote",
      workspacePath,
      workspaceIdentity,
      target: { kind: "docker", container: "fixture" },
    },
  ];
  const saved = JSON.stringify(history);
  const service = createBotsService({
    productCapabilities,
    credentialService: {} as ICredentialService,
    zcodeTaskService: {} as never,
    modelSelectionService: { getView: noEffect },
    settingService: {
      get: async () => ({ lastWorkspaceSession: history }),
    } as unknown as ISettingService,
    runStartupBackgroundTasks: false,
  });
  try {
    for (const identity of [`  ${workspaceIdentity}  `, workspaceIdentity]) {
      const workspaces = await service.listWorkspaceRefs({
        currentWorkspace: {
          id: identity,
          label: "old",
          workspacePath,
          workspaceIdentity: identity,
        },
      });
      assert.deepEqual(
        workspaces.map((item) => item.id),
        [workspacePath],
      );
      assert.equal(JSON.stringify(history), saved);
      await assert.rejects(
        service.createBindCode({ botId: "fixture", allowedWorkspaces: [identity] }),
        /REMOTE_WORKSPACES_UNAVAILABLE/,
      );
    }
  } finally {
    await service.disposeAllAndWait();
  }
});

test("disabled target guard uses the same trimmed identity key as Runtime without mutating input", () => {
  const target = { workspacePath, workspaceIdentity: `  ${workspaceIdentity}  ` };
  assert.throws(
    () => assertWorkspaceTargetAvailable(productCapabilities, target),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  assert.equal(target.workspaceIdentity, `  ${workspaceIdentity}  `);
});

test("absent remote product view leaves target validation to the original owner", () => {
  assert.doesNotThrow(() =>
    assertWorkspaceTargetAvailable(undefined, {
      get workspaceIdentity(): string {
        return noEffect();
      },
    }),
  );
});

test("non-Desktop replay scope retains remote identity and existing protocol when no product view is supplied", async () => {
  const calls: unknown[] = [];
  const base = {
    queryConversationCommandsV4: async (params: unknown) => {
      calls.push(params);
      return {};
    },
  } as unknown as IZCodeAgentService;
  const scope = createZCodeAgentConnectionScope(base, {
    connectionId: "upstream-phone",
    clientMode: "web-remote-replayable",
  });
  try {
    await scope.service.helloConversationV4();
    await scope.service.initializeConversationV4({
      kind: "clientHello",
      protocolVersion: 3,
      appVersion: "fixture",
      clientId: "fixture",
    });
    await scope.service.queryConversationCommandsV4({
      workspacePath,
      workspaceIdentity,
      remoteSessionId: "remote",
    } as never);
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { workspaceIdentity: string }).workspaceIdentity, workspaceIdentity);
    assert.equal((calls[0] as { remoteSessionId: string }).remoteSessionId, "remote");
  } finally {
    await scope.dispose();
  }
});

test("Desktop scope rejects replay initialization and remote identity without stripping scope, local handshake remains usable", async () => {
  let localCalls = 0;
  const base = {
    queryConversationCommandsV4: async () => {
      localCalls++;
      return {};
    },
  } as unknown as IZCodeAgentService;
  assert.throws(
    () =>
      createZCodeAgentConnectionScope(
        base,
        { connectionId: "phone", clientMode: "web-remote-replayable" },
        productCapabilities,
      ),
    /MOBILE_REMOTE_CONTROL_UNAVAILABLE/,
  );
  const scope = createZCodeAgentConnectionScope(
    base,
    { connectionId: "desktop", clientMode: "desktop-continuous" },
    productCapabilities,
  );
  await scope.service.helloConversationV4();
  await scope.service.initializeConversationV4({
    kind: "clientHello",
    protocolVersion: 3,
    appVersion: "fixture",
    clientId: "fixture",
  });
  await assert.rejects(
    async () =>
      scope.service.queryConversationCommandsV4({ workspacePath, workspaceIdentity } as never),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  await assert.rejects(
    async () =>
      scope.service.queryConversationCommandsV4({ workspacePath, remoteSessionId: "old" } as never),
    /REMOTE_WORKSPACES_UNAVAILABLE/,
  );
  assert.equal(localCalls, 0);
  await scope.service.queryConversationCommandsV4({ workspacePath } as never);
  assert.equal(localCalls, 1);
  await scope.dispose();
});
