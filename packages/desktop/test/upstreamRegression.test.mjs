import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { parseRegressionArgs, regressionCommands } from "../../../scripts/upstream-regression.mjs";

const root = resolve(import.meta.dirname, "../../..");
const baseline = [
  "--baseline-review",
  "--upstream",
  "a".repeat(40),
  "--branch",
  "integration/parser-test",
  "--worktree",
  resolve(root, "../parser-worktree"),
  "--report",
  resolve(root, "../parser-report.json"),
];

test("upstream-regression documentation limits integration to ancestry-preserving Git merge", async () => {
  const guide = await readFile(
    resolve(root, "specs/desktop-local-fork/upstream-regression.md"),
    "utf8",
  );
  // 普通 cherry-pick 复制提交却不保留来源 ancestry，不能宣传为现有门禁可执行的流程。
  assert.ok(guide.includes("门禁仅支持保留上游历史的 Git merge"));
  assert.ok(guide.includes("普通 cherry-pick 不属于本门禁支持流程"));
  assert.ok(guide.includes("固定上游 SHA 必须是本地 HEAD 的 ancestor"));
  assert.ok(!guide.includes("或逐提交 cherry-pick"));
});

test("regression rejects floating refs, missing isolated branch and missing runtime evidence", () => {
  assert.throws(() => parseRegressionArgs(["--upstream", "upstream/main"]), /40-character/);
  assert.throws(() => parseRegressionArgs(["--upstream", "a".repeat(40)]), /mode/);
  assert.throws(() => parseRegressionArgs(["--verify", "--upstream", "a".repeat(40)]), /key-file/);
  assert.throws(
    () => parseRegressionArgs(["--baseline-review", "--upstream", "a".repeat(40)]),
    /worktree/,
  );
});

test("parser rejects missing values, unknown/duplicate flags and conflicting modes before IO", () => {
  for (const flag of [
    "--upstream",
    "--branch",
    "--worktree",
    "--report",
    "--key-file",
    "--executable",
  ]) {
    assert.throws(() => parseRegressionArgs([flag]), /requires a value/, flag);
    assert.throws(() => parseRegressionArgs([flag, "--reviewed"]), /requires a value/, flag);
  }
  assert.throws(() => parseRegressionArgs([...baseline, "--typo"]), /unknown/);
  assert.throws(() => parseRegressionArgs([...baseline, "--branch", "other"]), /duplicate/);
  assert.throws(() => parseRegressionArgs([...baseline, "--verify"]), /mode/);
  assert.throws(() => parseRegressionArgs([...baseline, "--reviewed"]), /verify-only/);
  assert.throws(
    () =>
      parseRegressionArgs([
        "--verify",
        "--upstream",
        "a".repeat(40),
        "--reviewed",
        "--key-file",
        resolve(root, "../private-key"),
        "--executable",
        resolve(root, "../app"),
        "--report",
        resolve(root, "../report"),
        "--branch",
        "integration/wrong-mode",
      ]),
    /baseline-only/,
  );
});

test("external evidence paths use native path boundaries, including dot-prefixed directories", () => {
  for (const flag of ["--report", "--worktree"]) {
    for (const path of [root, resolve(root, "internal"), resolve(root, "..internal/evidence")]) {
      const args = [...baseline];
      args[args.indexOf(flag) + 1] = path;
      assert.throws(() => parseRegressionArgs(args), /outside this checkout/, path);
    }
  }
  const args = [...baseline];
  args[args.indexOf("--report") + 1] = resolve(dirname(root), "..sibling/report.json");
  assert.equal(parseRegressionArgs(args).report, resolve(dirname(root), "..sibling/report.json"));
});

test("full regression uses real core, execution guards, product and packaged runners rather than grep", () => {
  const commands = regressionCommands({ keyFile: "/private/key", executable: "/build/app" });
  const text = commands.map((args) => args.join(" ")).join("\n");
  for (const entry of [
    "typecheck",
    "lint",
    "architecture:check",
    "fmt:check",
    "e2e:baseline",
    "--extensions",
    "--telemetry",
    "run-account.mjs",
    "run-remote-backend.mjs",
    "productMarketplaceSharing.e2e.mjs",
    "run-build.mjs",
    "--executable /build/app",
    "--key-file /private/key",
    "--tsconfig packages/ui/tsconfig.json --test packages/ui/test/*.test.* packages/services/test/*.test.ts packages/desktop/test/*.test.*",
    "--test apps/zcode-cli/test/productTelemetry.test.mjs",
  ])
    assert.ok(text.includes(entry), entry);
  const guardIndex = commands.findIndex((args) => args.includes("packages/ui/test/*.test.*"));
  assert.ok(guardIndex > commands.findIndex((args) => args[0] === "build"));
  assert.ok(guardIndex < commands.findIndex((args) => args.includes("e2e:baseline")));
  assert.ok(!text.includes("grep"));
});
