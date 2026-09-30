import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationShareArtifactDescriptorSchema } from "@zcode/shared";
import { ConversationShareHttpClient } from "../src/conversation-share/conversationShareHttpClient.js";
import {
  ConversationShareService,
  conversationShareConnectionScopeFactory,
} from "../src/conversation-share/conversationShareService.js";

const productCapabilities = Object.freeze({ sharing: false });
const unavailable = {
  kind: "feature_disabled",
  message: "Conversation sharing is unavailable in this product",
};
const descriptor = conversationShareArtifactDescriptorSchema.parse({
  artifact_id: "artifact1",
  logical_artifact_key: "fixture-logical-key",
  producer_product_turn_id: "fixture-turn",
  artifact_version: 1,
  state: "current",
  ref: "zcode-artifact://share/artifact1",
  artifact_type: "text",
  display_name: "fixture.txt",
  extension: "txt",
  mime_type: "text/plain",
  size_bytes: 4,
  sha256: "a".repeat(64),
});

test("share HTTP upload, permissions and old remote reads reject before token lookup or network", async () => {
  let requests = 0;
  let tokens = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(503);
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const client = new ConversationShareHttpClient({
    productCapabilities,
    apiClient: { request: (url, init) => fetch(url, init) },
    baseUrl: `http://127.0.0.1:${address.port}`,
    tokenProvider: async () => {
      tokens += 1;
      return "fixture-token-not-a-credential";
    },
  });
  try {
    for (const run of [
      () => client.getCapabilities(),
      () =>
        client.createPreparation({
          client_request_id: "old-request",
          title: "Fixture",
          schema_version: 1,
          access_mode: "public_importable",
          payload_sha256: "a".repeat(64),
          artifact_count: 1,
        }),
      () => client.uploadArtifact("old-preparation", descriptor, new Blob(["data"])),
      () => client.uploadArtifact("old-preparation", {} as never, new Blob(["data"])),
      () => client.confirm("old-preparation", {} as never),
      () => client.getPreview("old-share"),
      () =>
        client.getContinuation("old-share", {
          schema_version: 1,
          client_request_id: "old-request",
        }),
    ])
      await assert.rejects(async () => run(), unavailable);
    assert.equal(tokens, 0);
    assert.equal(requests, 0);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("share service and connection facade refuse old imports without recovery cleanup; offline copy remains readable", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-share-boundary-"));
  const calls: string[] = [];
  const dependency = new Proxy(
    {},
    {
      get: (_target, name) => async () => {
        calls.push(String(name));
        throw new Error("unexpected dependency");
      },
    },
  );
  const shareRoot = join(root, ".zcode-share", "old-share");
  const marker = JSON.stringify({ sessionId: "share-import-old", shareCode: "old-share" });
  const rows = [
    {
      rowId: 1,
      kind: "assistantText",
      entityId: "text1",
      turnId: "turn1",
      productTurnId: "turn1",
      createdAt: 1,
      createdAtSeq: 1,
      text: "Offline fixture",
      state: "complete",
    },
  ];
  const stored = JSON.stringify({
    formatVersion: 1,
    shareId: "old-share",
    contextId: "old-context",
    title: "Fixture",
    rows,
    artifacts: [
      {
        artifactId: "artifact1",
        displayName: "fixture.txt",
        workspaceRelativePath: ".zcode-share/old-share/fixture.txt",
      },
    ],
  });
  const index = JSON.stringify({
    [`old-share\u0000${root}\u0000old-request`]: {
      workspacePath: root,
      sessionId: "share-import-old",
      title: "Fixture",
      contextId: "old-context",
      shareUrl: "https://example.invalid/cn/share/old-share",
    },
  });
  try {
    await mkdir(shareRoot, { recursive: true });
    await writeFile(join(shareRoot, ".zcode-share-import.json"), marker);
    await writeFile(join(shareRoot, "shared-conversation.json"), stored);
    await writeFile(join(shareRoot, "fixture.txt"), "local attachment");
    await writeFile(join(root, ".zcode-share-imports.json"), index);
    const service = new ConversationShareService({
      productCapabilities,
      zcodeAgentService: dependency as never,
      zcodeSessionService: dependency as never,
      client: dependency as never,
      artifactSource: dependency as never,
      conversationWorkspaceRoot: root,
      download: async () => {
        calls.push("download");
        throw new Error("unexpected download");
      },
    });
    const scoped = service[conversationShareConnectionScopeFactory](dependency as never);
    for (const current of [service, scoped]) {
      for (const run of [
        () => current.getCapabilities(),
        () =>
          current.preflight({
            workspacePath: root,
            sessionId: "old-session",
            selection: { kind: "all" },
          }),
        () =>
          current.publish(
            {
              workspacePath: root,
              sessionId: "old-session",
              title: "Fixture",
              accessMode: "public_importable",
              selection: { kind: "all" },
              clientRequestId: "old-request",
              disclosureAcceptedAt: 1,
            },
            "old-operation",
          ),
        () => current.getPreview("old-share"),
        () => current.getContinuation({ shareCode: "old-share", clientRequestId: "old-request" }),
        () =>
          current.importShare(
            { shareCode: "old-share", clientRequestId: "old-request", targetWorkspacePath: root },
            "old-operation",
          ),
      ])
        await assert.rejects(async () => run(), unavailable);
      const local = await current.getImportedConversation({
        workspacePath: root,
        contextId: "old-context",
      });
      assert(local);
      assert.deepEqual(local.rows, rows);
      assert.equal(local.artifacts[0]?.displayName, "fixture.txt");
    }
    assert.deepEqual(calls, []);
    assert.equal(await readFile(join(shareRoot, ".zcode-share-import.json"), "utf8"), marker);
    assert.equal(await readFile(join(root, ".zcode-share-imports.json"), "utf8"), index);
    assert.equal(await readFile(join(shareRoot, "shared-conversation.json"), "utf8"), stored);
    assert.equal(await readFile(join(shareRoot, "fixture.txt"), "utf8"), "local attachment");
    assert.deepEqual((await readdir(root)).sort(), [".zcode-share", ".zcode-share-imports.json"]);
    assert.deepEqual((await readdir(shareRoot)).sort(), [
      ".zcode-share-import.json",
      "fixture.txt",
      "shared-conversation.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
