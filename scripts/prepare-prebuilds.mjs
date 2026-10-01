#!/usr/bin/env node

// 根因：旧远程资源实现即使被入口 guard 拦截，仍保留可导入的下载/打包闭包。
// 本地 Desktop 无消费者；只保留明确拒绝的旧命令，不能重新准备远端资产。
throw new Error("Desktop-only: remote deployment assets are unavailable");
