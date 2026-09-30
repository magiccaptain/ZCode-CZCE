import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 托管 Agent 的装配契约证据；非 Runtime 执行测试，不能替代 Desktop E2E。
test("managed protocol bootstrap never opts into standalone credential restore", async () => {
  const source = ts.createSourceFile(
    "zcode-protocol-entrypoint.ts",
    await readFile(
      new URL(
        "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-entrypoint.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "startProcessProviderRegistryRuntime"
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.arguments.length, 1, "only env; standalone option must remain absent");
  const runtime = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/app/process-provider-registry-runtime.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(runtime, /const credentialStore = options\.standalone\s*\?/);
  assert.match(runtime, /: undefined;/);
});

test("Host Agent wiring retains explicit account overlay rather than omitting the source", async () => {
  const assembly = await readFile(new URL("../src/node.ts", import.meta.url), "utf8");
  assert.match(
    assembly,
    /new EmptyAccountProviderConfigSource\(providerConfigRuntime\.configService\)/,
  );
  assert.match(assembly, /const agentAccountProviderConfigSource = accountProviderConfigSource/);
  assert.match(assembly, /accountProviderConfigSource: agentAccountProviderConfigSource/);
  const agent = await readFile(
    new URL("../src/zcode-agent/zcodeAgentService.ts", import.meta.url),
    "utf8",
  );
  assert.match(agent, /const snapshot = await accountProviderConfigSource\.read\(\)/);
  assert.match(agent, /zcodeProtocolMethods\.providerUpdateAccountConfig/);
});
