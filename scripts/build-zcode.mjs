#!/usr/bin/env node

// 本地 Fork 已停止统一 Web/server 发行；旧直接入口不得读取配置或准备产物。
throw new Error(
  "Desktop-only: unified Web/server distribution is unavailable; use pnpm bundle:desktop",
);
