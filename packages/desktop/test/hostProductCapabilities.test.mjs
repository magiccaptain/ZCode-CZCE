import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// 装配接线契约：实际启动由 E2E 覆盖；AST 检查避免把另一个 false 常量误当同源输入。
test("Host createLocalServices receives the Desktop capability owner without copying product facts", async () => {
  const source = ts.createSourceFile(
    "host/index.ts",
    await readFile(new URL("../src/host/index.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "createLocalServices")
      calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(calls.length, 1, "one local services assembly path");
  const options = calls[0].arguments[0];
  assert(ts.isObjectLiteralExpression(options));
  const property = options.properties.find(
    (entry) => entry.name?.getText(source) === "productCapabilities",
  );
  assert(property, "Host must pass the readonly capability view into Agent services");
  assert(ts.isPropertyAssignment(property));
  assert.equal(property.initializer.getText(source), "DESKTOP_PRODUCT_CAPABILITIES");
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
