import assert from "node:assert/strict";
import { BufferReader, BufferWriter, VSBuffer, serialize, deserialize } from "@zcode/rpc";
import { IZCodeAgentService, IZCodeTaskService } from "@zcode/services";
import { HostMessageTypes } from "@zcode/shared";

/** 真实同一 Host attachment：Task Promise 拒绝后仍能处理本地 Task/Agent 请求。 */
export async function assertTaskRpcAdmission(app, { workspacePath, workspaceIdentity }) {
  const requests = [
    ...[
      { workspaceIdentity },
      { workspaceIdentity: ` ${workspaceIdentity} ` },
      { remoteSessionId: "legacy-remote" },
    ].map((target) => [
      IZCodeTaskService.channelName,
      "getTaskSnapshot",
      [{ workspacePath, taskId: "fixture", ...target }],
    ]),
    [
      IZCodeTaskService.channelName,
      "resumeTask",
      [
        {
          workspacePath,
          taskId: "fixture",
          workspaceIdentity,
          mcpServers: [{ name: "fixture", command: "fixture" }],
        },
      ],
    ],
    [IZCodeTaskService.channelName, "listTasks", [{ workspacePath }]],
    [IZCodeAgentService.channelName, "helloConversationV4", []],
  ].map(([channel, method, args], index) => {
    const writer = new BufferWriter();
    serialize(writer, [100, index + 1, channel, method]);
    serialize(writer, args);
    return Array.from(writer.buffer.buffer);
  });
  const responses = await app.evaluate(
    ({ MessageChannelMain }, { types, requests }) =>
      new Promise((resolve, reject) => {
        const host = globalThis.__remoteBackendProbe.hosts[0];
        const { port1, port2 } = new MessageChannelMain();
        const responses = [];
        let initialized = false,
          finished = false;
        port2.on("close", () => {
          if (!finished)
            reject(new Error("Task Promise refusal unexpectedly closed local attachment"));
        });
        port2.on("message", ({ data }) => {
          if (!(data instanceof Uint8Array)) return;
          if (!initialized) initialized = true;
          else responses.push(Array.from(data));
          if (responses.length < requests.length)
            port2.postMessage(Uint8Array.from(requests[responses.length]));
          else {
            finished = true;
            resolve(responses);
            port2.close();
          }
        });
        port2.start();
        host.child.postMessage(
          {
            type: types.AttachServicePort,
            requestId: "task-promise-control",
            attachmentId: "task-promise-control",
            scope: { kind: "local" },
            clientMode: "desktop-continuous",
          },
          [port1],
        );
      }),
    { types: HostMessageTypes, requests },
  );
  responses.forEach((bytes, index) => {
    const reader = new BufferReader(VSBuffer.wrap(Uint8Array.from(bytes)));
    const header = deserialize(reader),
      body = deserialize(reader);
    assert.equal(header[1], index + 1);
    assert.equal(header[0], index < 4 ? 202 : 201);
    if (index < 4) assert.equal(body.message, "REMOTE_WORKSPACES_UNAVAILABLE");
  });
}
