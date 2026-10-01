#!/usr/bin/env node

import process from "node:process";
import { resolve } from "node:path";
import { runCommand } from "./spawn-command.mjs";

// 本地 Fork 不再提供远端资源初始化；旧参数必须在 install/构建副作用之前拒绝。
if (process.argv.slice(2).length > 0) {
  throw new Error("Desktop-only: bootstrap accepts no remote deployment options");
}

const rootDir = resolve(import.meta.dirname, "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
for (const args of [["install"], ["run", "build:bootstrap"]]) {
  runCommand(pnpmCommand, args, { cwd: rootDir, env: process.env });
}
