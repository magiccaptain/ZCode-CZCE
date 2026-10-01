#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
  const argv = process.argv.slice(2);
  // 只拒绝原产品选择位置，不能误伤普通 prompt、-- 后文本或 Agent 浏览器工具。
  if (argv[0] === "--web") {
    throw new Error("Desktop-only: Web product is unavailable");
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0])) {
    const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    console.log(version);
  } else {
    const agentEntry = join(root, "agent", "zcode.cjs");
    // CLI 自启动子进程依赖 argv[1]；保持真正 Agent 入口、TTY 与所有原始参数。
    process.argv[1] = agentEntry;
    await import(pathToFileURL(agentEntry).href);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
