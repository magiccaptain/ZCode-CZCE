# 固定上游集成与可执行回归

## 固定版本与审查

本轮已有 upstream remote 的固定基线为 `29628c9acdb81b703bbd4080c207a0e7ce5e276e`（v3.14.3 源码提交；不宣称存在对应 tag）。Issue #1–#6 本地提交为 `dfd3961`、`c0762ce`、`fc61610`、`142f06f`、`77fba4e`、`831b355`。#7 的基线演练在最终本地提交前执行，演练报告分别记录当时 HEAD 与完整工作区差异；最终提交结果见 `issue7-results.md`。

未来集成：维护者选定 SHA/tag，先 `git rev-parse <tag>^{commit}` 得到固定 40 位 SHA；单独 fetch 明确选定对象，不自动追踪移动的 main。创建独立 integration 分支/worktree，通过 Git merge 集成选定提交，绝不覆盖 `apps/zcode-cli`。门禁仅支持保留上游历史的 Git merge：固定上游 SHA 必须是本地 HEAD 的 ancestor。普通 cherry-pick 不属于本门禁支持流程，因为复制出的本地提交不会使来源 SHA 成为 ancestor；脚本会在回归及报告创建前拒绝，不得取消来源检查来绕过。审查全部 diff，不只 Agent 目录：

- core/bootstrap/adapters/contracts/shared-types 的配套类型与运行改变；CommandInbox admission 和停止/恢复语义。
- shared 协议、owner/lease、workspace identity、stale run、continuous/replay 保留边界。
- Provider 本地配置/凭据、通用及 MCP OAuth（不恢复产品账号源）。
- 持久化/client/RPC 与公开 exports；不迁移/清空旧用户数据。
- build、watch、aliases、TS refs、workspace/lockfile、动态资产和必需插件资源。
- 新入口/深链/后台任务是否绕过 Desktop 固定能力；冲突逐项记录处理与理由，禁止简单选择整目录 theirs。

## 可行基线演练（不会合入未来版本）

```sh
export PATH=/home/sc/.nvm/versions/node/v24.14.0/bin:$PATH
node scripts/upstream-regression.mjs --baseline-review \
  --upstream 29628c9acdb81b703bbd4080c207a0e7ce5e276e \
  --branch integration/issue7-baseline --worktree /absolute/path/outside/repository/issue7-baseline \
  --report /absolute/path/outside/repository/issue7-upstream-review.json
```

脚本解析固定提交、确认已有 ancestor、从本地 HEAD 建立独立分支/worktree；复制完整 tracked binary diff 与非忽略新增文件（不分路径覆盖 CLI），执行独立工作树中的闭包检查，写上游/本地 SHA、完整差异列表与未测范围。无网络 fetch、merge、commit、push、PR 或 issue 修改。工作树保留供审查；审查后维护者可执行 `git worktree remove <path>` 和 `git branch -D integration/issue7-baseline`。该模式不安装依赖，也不构成干净安装或 E2E 证明。

## 集成提交后的完整验证

在已审查且干净的独立 integration 分支，先从该提交构建本机安装包（Linux 示例：`ZCODE_ENV=production pnpm build`，然后 `ZCODE_ENV=production pnpm --filter @zcode/desktop exec electron-builder --config electron-builder.config.js --linux AppImage --x64`）；保存包 hash 与构建日志。不得复用其他提交的旧包。

```sh
LANG=en_US.UTF-8 APPIMAGE_EXTRACT_AND_RUN=1 node scripts/upstream-regression.mjs --verify \
  --upstream <fixed-40-character-SHA> --reviewed \
  --key-file /absolute/path/outside/repository/private-key-file \
  --executable /absolute/path/to/current/ZCode.AppImage \
  --report /absolute/path/outside/repository/upstream-regression.json
```

`--reviewed` 表示人工已完成上述配套及冲突审查，不替代审查材料。脚本在任何 IO 前拒绝未知/重复/缺值/模式冲突参数及 checkout 内 worktree/report/key-file；验证还拒绝 main/master、脏集成分支、未合入的 upstream、缺凭据/包参数。依次执行 frozen install、类型/lint/全量架构/格式、闭包测试、正常 `pnpm build`、Agent `typecheck --force`、UI/services/Desktop guard/同源装配聚合测试、Agent telemetry 行为测试、真实核心+Skills/MCP+遥测、更新、账号、市场/分享、远程 Backend/UI、安装包综合关闭与真实包内模型/遥测冒烟。默认流程不自动删除输出；本轮单独干净输出演练证据在结果文档中单列。现有 runner 会实际重建并生成 hash/运行报告，见 `packages/desktop/e2e/README.md`；不是 grep 验证。首个失败即退出非零并记录结果，不会自动合入。

聚合行为测试使用 `pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test 'packages/ui/test/*.test.*' 'packages/services/test/*.test.ts' 'packages/desktop/test/*.test.*'`；Agent telemetry 使用 `pnpm exec tsx --test apps/zcode-cli/test/productTelemetry.test.mjs`。glob 由 Node 测试入口处理，不依赖 shell 展开。

完整回归完成后，审查报告、runner 证据、安装包来源与平台缺口再由维护者合入。Linux 结果不能替代 Windows/macOS；真实 MCP OAuth 浏览器闭环、跨 Host/手机恢复及包内完整核心/Skills/MCP 需要单独证据。`--verify` 的可执行流程已建立，当前基线演练只运行明确标记的 review-only 模式；本轮各实际验证另见 Issue #7 结果。
