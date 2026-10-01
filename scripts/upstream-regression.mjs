#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { quoteArgsForWindowsShell, resolveSpawnRuntimeOptions } from "./spawn-command.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");

export function parseRegressionArgs(args) {
  const flags = new Set(["--baseline-review", "--verify", "--reviewed"]);
  const values = new Set([
    "--upstream",
    "--worktree",
    "--branch",
    "--report",
    "--key-file",
    "--executable",
  ]);
  const parsed = new Map();
  // 根因：按 indexOf 取下一项会把缺值的后续 flag 当路径，甚至绕过 checkout 边界。
  // 先严格解析全部参数，非法输入不得进入 Git 或文件副作用。
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (!flags.has(name) && !values.has(name)) throw new Error(`unknown option: ${name}`);
    if (parsed.has(name)) throw new Error(`duplicate option: ${name}`);
    if (flags.has(name)) parsed.set(name, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
      parsed.set(name, value);
    }
  }
  const value = (name) => parsed.get(name);
  const upstream = value("--upstream");
  if (!args.includes("--upstream") || !/^[a-f0-9]{40}$/.test(upstream))
    throw new Error("--upstream requires a fixed 40-character commit SHA (resolve tags first)");
  const baseline = args.includes("--baseline-review");
  if (baseline === args.includes("--verify"))
    throw new Error("select one mode: --baseline-review or --verify");
  if (baseline && ["--key-file", "--executable", "--reviewed"].some((name) => parsed.has(name)))
    throw new Error("key-file/executable/reviewed are verify-only options");
  if (!baseline && ["--worktree", "--branch"].some((name) => parsed.has(name)))
    throw new Error("worktree/branch are baseline-only options");
  const options = {
    upstream,
    baseline,
    worktree: args.includes("--worktree") ? resolve(value("--worktree")) : null,
    branch: args.includes("--branch") ? value("--branch") : null,
    report: args.includes("--report") ? resolve(value("--report")) : null,
    keyFile: args.includes("--key-file") ? resolve(value("--key-file")) : null,
    executable: args.includes("--executable") ? resolve(value("--executable")) : null,
    reviewed: args.includes("--reviewed"),
  };
  if (baseline && (!options.worktree || !options.branch))
    throw new Error("baseline review requires --worktree and --branch");
  if (!baseline && (!options.keyFile || !options.executable || !options.reviewed))
    throw new Error(
      "verify requires --key-file, --executable and --reviewed after paired-change/conflict review",
    );
  if (!options.report) throw new Error("--report requires an external evidence path");
  for (const path of [options.worktree, options.report, options.keyFile].filter(Boolean)) {
    const rel = relative(root, path);
    if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
      throw new Error("worktree/report/key-file must be outside this checkout");
  }
  return options;
}

export function regressionCommands({ keyFile, executable }) {
  return [
    ["install", "--frozen-lockfile"],
    ["typecheck"],
    ["lint"],
    ["architecture:check"],
    ["fmt:check"],
    [
      "exec",
      "tsx",
      "--test",
      "packages/desktop/test/dependencyCleanup.test.mjs",
      "packages/desktop/test/desktopBuildClosure.test.mjs",
      "packages/desktop/test/upstreamRegression.test.mjs",
    ],
    ["build"],
    ["--dir", "apps/zcode-cli", "typecheck", "--force"],
    // 闭包存在性不证明执行关闭；同时运行既有 guard/装配与 Agent telemetry 行为测试。
    [
      "exec",
      "tsx",
      "--tsconfig",
      "packages/ui/tsconfig.json",
      "--test",
      "packages/ui/test/*.test.*",
      "packages/services/test/*.test.ts",
      "packages/desktop/test/*.test.*",
    ],
    ["exec", "tsx", "--test", "apps/zcode-cli/test/productTelemetry.test.mjs"],
    [
      "--filter",
      "@zcode/desktop",
      "e2e:baseline",
      "--key-file",
      keyFile,
      "--extensions",
      "--telemetry",
    ],
    ["--filter", "@zcode/desktop", "e2e:updates"],
    ["--filter", "@zcode/desktop", "exec", "tsx", "e2e/run-account.mjs"],
    ["exec", "tsx", "packages/ui/test/productMarketplaceSharing.e2e.mjs"],
    ["--filter", "@zcode/desktop", "exec", "tsx", "e2e/run-remote-backend.mjs"],
    ["exec", "tsx", "packages/ui/test/productRemoteWorkspace.e2e.mjs"],
    ["--filter", "@zcode/desktop", "exec", "tsx", "e2e/run-build.mjs", "--executable", executable],
    [
      "--filter",
      "@zcode/desktop",
      "exec",
      "tsx",
      "e2e/run-telemetry.mjs",
      "--executable",
      executable,
      "--key-file",
      keyFile,
    ],
  ];
}

async function run(command, args, cwd, input) {
  const runtime = resolveSpawnRuntimeOptions(command);
  const child = spawn(command, runtime.shell ? quoteArgsForWindowsShell(args) : args, {
    cwd,
    // nested pnpm 不保证将根 workspace 的 turbo shim 放入 PATH，显式使用同一已安装工具链。
    env: {
      ...process.env,
      PATH: `${resolve(cwd, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
      LANG: "en_US.UTF-8",
      ZCODE_ENV: "production",
      ZCODE_ACCOUNT_E2E_ENV: "production",
      ZCODE_MARKET_SHARE_E2E_ENV: "production",
      ZCODE_REMOTE_E2E_ENV: "production",
      ZCODE_REMOTE_UI_E2E_ENV: "production",
    },
    stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    ...runtime,
  });
  if (input !== undefined) child.stdin.end(input);
  await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? done() : reject(new Error(`${command} failed: ${code}`)),
    );
  });
}

async function main(options) {
  const git = async (...args) =>
    (await exec("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
  const upstream = await git("rev-parse", `${options.upstream}^{commit}`);
  const before = await git("rev-parse", "HEAD");
  await git("merge-base", "--is-ancestor", upstream, before);
  let cwd = root;
  if (options.baseline) {
    // 基线演练在独立分支复制当前完整差异，不覆盖 CLI、不提交、不更改源工作区索引。
    await git("worktree", "add", "-b", options.branch, options.worktree, before);
    cwd = options.worktree;
    const { stdout: patch } = await exec("git", ["diff", "--binary", "HEAD"], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (patch) await run("git", ["apply", "--binary", "-"], cwd, patch);
    for (const file of (await git("ls-files", "--others", "--exclude-standard", "-z"))
      .split("\0")
      .filter(Boolean)) {
      await mkdir(dirname(resolve(cwd, file)), { recursive: true });
      await copyFile(resolve(root, file), resolve(cwd, file));
    }
  } else {
    const branch = await git("branch", "--show-current");
    if (!branch || branch === "main" || branch === "master")
      throw new Error("verify must run on an independent integration branch");
    if (await git("status", "--porcelain"))
      throw new Error("commit reviewed integration changes before full verification");
    // 凭据内容只交给已有 runner 读取；流程工具仅检查外部文件和安装包存在。
    await access(options.keyFile);
    await access(options.executable);
  }
  const report = {
    mode: options.baseline ? "baseline-review-only" : "full-regression",
    upstream,
    localBefore: before,
    localAfter: before,
    branch: options.branch ?? (await git("branch", "--show-current")),
    trackedDifferences: await git("diff", "--name-status", upstream, "HEAD"),
    workingDifferences: await git("diff", "--stat", "HEAD"),
    reviewRequired: [
      "Agent core/bootstrap/adapters/contracts",
      "shared protocol and owner/lease/identity",
      "Provider and generic/MCP OAuth",
      "persistence and client",
      "build/dynamic assets/lockfile",
      "new disabled entrypoints/background tasks",
    ],
    conflictHandling: options.baseline
      ? "No merge: pinned existing ancestor; current complete working delta copied for audit"
      : "Operator supplied --reviewed; retain manual paired-change/conflict review with this report",
    commands: [],
    limitations: options.baseline
      ? [
          "No future version fetched/merged; no full runtime or clean-install proof in baseline-review mode",
        ]
      : [
          "Packaged executable must be built from this reviewed commit separately; inspect existing runner build/hash reports",
          "Platform and true MCP OAuth gaps require separate evidence",
        ],
  };
  try {
    const commands = options.baseline
      ? [["node", "--test", "packages/desktop/test/dependencyCleanup.test.mjs"]]
      : regressionCommands(options).map((args) => ["pnpm", ...args]);
    for (const [command, ...args] of commands) {
      const entry = {
        command: [command, ...args]
          .map((arg) => (arg === options.keyFile ? "<private-key-file>" : arg))
          .join(" "),
        result: "failed",
      };
      report.commands.push(entry);
      await run(command, args, cwd);
      entry.result = "passed";
    }
  } finally {
    await mkdir(dirname(options.report), { recursive: true });
    await writeFile(options.report, JSON.stringify(report, null, 2) + "\n");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(parseRegressionArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
