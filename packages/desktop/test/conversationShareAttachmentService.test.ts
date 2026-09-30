import assert from "node:assert/strict";
import test from "node:test";
import { Event as RpcEvent } from "@zcode/rpc";
import { scopeConversationShareServiceForAttachment } from "../src/host/conversationShareAttachmentService.js";
import { conversationShareConnectionScopeFactory } from "@zcode/services/node";
import { DESKTOP_PRODUCT_CAPABILITIES } from "../src/main/productCapabilities.js";
import { readFile } from "node:fs/promises";
import ts from "typescript";

test("attachment product guard blocks legacy service in both delivery modes, regardless of connection readiness", async () => {
  const calls: string[] = [];
  const service = new Proxy(
    {},
    {
      has: (_target, name) => name === conversationShareConnectionScopeFactory,
      get: (_target, name) => {
        if (name === "getImportedConversation")
          return async () => {
            calls.push("localRead");
            return { title: "offline" };
          };
        return () => {
          calls.push(String(name));
          throw new Error("legacy sharing bypass");
        };
      },
    },
  );
  for (const mode of ["desktop-continuous", "web-remote-replayable"] as const) {
    for (const agent of [undefined, {}]) {
      const scoped = scopeConversationShareServiceForAttachment(
        service as never,
        mode,
        agent as never,
        DESKTOP_PRODUCT_CAPABILITIES,
      );
      for (const name of [
        "getCapabilities",
        "preflight",
        "publish",
        "importShare",
        "getPreview",
        "getContinuation",
      ] as const)
        await assert.rejects(async () => scoped[name]({} as never, "old-operation"), {
          kind: "feature_disabled",
          message: "Conversation sharing is unavailable in this product",
        });
      assert.equal(scoped.onDynamicPublishProgress("old-operation"), RpcEvent.None);
      assert.equal(scoped.onDynamicImportProgress("old-operation"), RpcEvent.None);
      assert.deepEqual(
        await scoped.getImportedConversation({ workspacePath: "/fixture", contextId: "offline" }),
        mode === "desktop-continuous" ? { title: "offline" } : null,
      );
    }
  }
  assert.deepEqual(calls, ["localRead", "localRead"]);
});

test("attachment keeps the previous Desktop facade when no disabling product is supplied", () => {
  const service = {};
  assert.equal(
    scopeConversationShareServiceForAttachment(service as never, "desktop-continuous"),
    service,
  );
  assert.equal(
    scopeConversationShareServiceForAttachment(service as never, "desktop-continuous", undefined, {
      sharing: true,
    }),
    service,
  );
});

// 接线检查只证明同源注入；实际执行拒绝由上面的行为测试断言，不冒充 Desktop E2E。
test("local, legacy remote and attachment boundaries consume the same Desktop sharing capability", async () => {
  for (const [path, expected, functions] of [
    [
      "../src/host/index.ts",
      "DESKTOP_PRODUCT_CAPABILITIES",
      ["scopeConversationShareServiceForAttachment"],
    ],
    [
      "../../services/src/node.ts",
      "options.productCapabilities",
      ["ConversationShareService", "ConversationShareHttpClient"],
    ],
    [
      "../src/host/remoteWorkspaceServiceCollection.ts",
      "params.productCapabilities",
      ["ConversationShareService", "ConversationShareHttpClient"],
    ],
  ] as const) {
    const source = ts.createSourceFile(
      path,
      await readFile(new URL(path, import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const found = new Set<string>();
    function visit(node: ts.Node) {
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        functions.some((name) => name === node.expression.getText(source))
      ) {
        const name = node.expression.getText(source);
        found.add(name);
        if (name === "scopeConversationShareServiceForAttachment")
          assert.equal(node.arguments?.[3]?.getText(source), expected);
        else {
          const options = node.arguments?.[0];
          assert(options && ts.isObjectLiteralExpression(options));
          const property = options.properties.find(
            (entry) => entry.name?.getText(source) === "productCapabilities",
          );
          assert(property && ts.isPropertyAssignment(property));
          assert.equal(property.initializer.getText(source), expected);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.deepEqual([...found].sort(), [...functions].sort());
  }
});
