# Issue #1 实施前核心基线结果

2026-09-30 已通过完整重建后的真实 Desktop E2E。可以进入 Issue #1 第一阶段（产品能力接口与更新关闭）的实施；完成行为修改后仍需复跑本基线，并执行更新关闭的专项验收。

## 实测环境

| 项目            | 值                                                                   |
| --------------- | -------------------------------------------------------------------- |
| 源码基线        | `29628c9acdb81b703bbd4080c207a0e7ce5e276e`，main 与 origin/main 同步 |
| 本地变更        | 新增 E2E 入口、测试脚本与规格；未修改生产业务实现                    |
| Node / pnpm     | `24.14.0` / `10.33.2`，使用本机 nvm 对齐                             |
| 平台 / UI       | Linux x64 / 英文                                                     |
| 版本 / 构建环境 | `3.14.3` / `ZCODE_ENV=test`（Preview）                               |
| 模型            | 内置 DeepSeek 模板，`deepseek-flash`，真实 API 请求                  |
| 运行时间        | 2026-09-30 22:37:25 至 22:39:08（Asia/Shanghai），包含重建           |
| 报告 ID         | `3c2cb0cb-e5ab-4f43-a941-b24bddde8a8f`                               |

执行方式与数据隔离规则见 [E2E 说明](../../packages/desktop/e2e/README.md) 和 [规格](e2e-baseline.md)。报告记录运行时的本地变更列表及 Main、Host、preload、renderer、Agent 构建产物 hash。

## 实际通过的场景

| 场景           | 观察到的结果                                                                               |
| -------------- | ------------------------------------------------------------------------------------------ |
| 重建与启动     | 重建本地 Agent 和 Desktop，干净测试目录启动，跳过引导与产品登录                            |
| 模型配置与对话 | 设置 UI 保存凭据，选择 DeepSeek，收到精确回复                                              |
| 工具执行       | Bash 写入并读回测试文件；持久化工具输出与标记一致                                          |
| 权限拒绝       | 实际拒绝操作，目标文件不存在，工具记录为 error                                             |
| 权限允许       | 再次请求并允许，目标文件内容正确，工具记录为 completed                                     |
| 运行中追加     | 前台工具仍被门闩阻塞时收到 accepted ACK，UI 展示队列；释放后工具及追加操作各执行一次       |
| 停止           | 真实工具运行时停止，释放门闩后无迟到完成文件；后续对话正常，停止工具记录为 error           |
| 正常重启       | Electron 正常退出码为 0，复用隔离数据后恢复同一会话和历史，再次对话成功                    |
| 持久化核验     | 9 条唯一输入，admission/promotion 顺序均为 0–8；其中 1 条 queue 输入；预期回复各持久化一次 |

结构化报告共有 12 个通过阶段，包括最终关闭和只读持久化检查。权限拒绝与主动停止的工具 error 属于预期结果。

机器本地证据：[report.json](../../packages/desktop/.e2e-artifacts/3c2cb0cb-e5ab-4f43-a941-b24bddde8a8f/report.json)、同目录 10 张截图和脱敏 `runtime.log`。这些产物已忽略，不提交。凭据编辑期间不截图、不录 trace/HAR。

## 调试发现与范围

- Desktop 包没有 version 字段，直接以该目录启动 Electron 会触发 updater 的 `0.0` semver 校验错误。测试启动器使用根版本的临时 manifest，并显式指定内置 Provider 配置文件，不修改 updater 实现。
- 首次引导异步出现，初版测试等待条件不足；首发输入可由 `createSession(firstInput)` admission，初版测试只等待 `sendText` ACK 会误报。两处均已按当前契约修正测试，再完成全流程复跑。
- 早期探索时漏配 Agent 数据库路径，在默认 Agent 库留下了一条合成测试会话（`sess_37b4ee44-5d7c-4025-b3f8-c4258222428e`）。未清空或直接修改默认数据库。正式入口显式隔离 Desktop、Electron、Agent storage 与 session DB，上述最终运行仅使用独立测试库。
- 本次不证明生产更新关闭、旧配置恢复、网络请求绕过、遥测关闭、跨 Host owner/lease、手机链路、Skills/MCP、发行安装包或 Windows/macOS 通过。Issue #1 的这些范围仍需各自的验证。

## 静态验证

| 检查                                 | 真实结果                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| workspace freshness                  | main 与 origin/main 同步，ahead 0 / behind 0                                        |
| `pnpm typecheck`                     | 退出码 0，通过                                                                      |
| `pnpm lint`                          | 退出码 0，0 errors / 70 条已有 warnings；新增 E2E 文件无警告                        |
| `pnpm architecture:check --changed`  | 退出码 0，baseline 0 / new 0 / violations 0                                         |
| 新增 E2E、结果文档及修改文件格式检查 | `oxfmt --check` 通过；未执行全仓库格式检查                                          |
| `git diff --check`                   | 通过                                                                                |
| 凭据扫描                             | 44 个源码/规格/诊断产物中未检出 API key；key 文件权限 600，正式运行私有目录权限 700 |

Desktop E2E 归属现有 Desktop 测试层；当前架构策略将该模块列为 unmanaged，本任务未改变业务状态所有者或依赖方向，也未更新架构 baseline。根类型检查不直接覆盖完整 CLI workspace；本次未修改 CLI 源码，实际重建并执行了 CLI。
