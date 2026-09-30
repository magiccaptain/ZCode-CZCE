import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 装配接线契约：实际启动由 E2E 覆盖；AST 检查避免把另一个 false 常量误当同源输入。
test("Host local and legacy remote assemblies receive the Desktop capability owner without copying product facts", async () => {
  const source = ts.createSourceFile(
    "host/index.ts",
    await readFile(new URL("../src/host/index.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const calls = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ["createLocalServices", "createRemoteWorkspaceServiceCollection"].includes(
        node.expression.getText(source),
      )
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(calls.length, 2, "one local and one legacy remote assembly path");
  for (const call of calls) {
    const options = call.arguments[0];
    assert(ts.isObjectLiteralExpression(options));
    const property = options.properties.find(
      (entry) => entry.name?.getText(source) === "productCapabilities",
    );
    assert(property, "Host must pass the readonly capability view into both service assemblies");
    assert(ts.isPropertyAssignment(property));
    assert.equal(property.initializer.getText(source), "DESKTOP_PRODUCT_CAPABILITIES");
  }
  assert(
    source.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        statement.moduleSpecifier.text === "../main/productCapabilities.js" &&
        statement.importClause?.namedBindings
          ?.getText(source)
          .includes("DESKTOP_PRODUCT_CAPABILITIES"),
    ),
    "read the existing owner rather than a copied configuration",
  );
});
