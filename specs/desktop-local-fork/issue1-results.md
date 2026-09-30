# Issue #1 实施结果

2026-09-30；基于 `29628c9acdb81b703bbd4080c207a0e7ce5e276e`，版本 3.14.3。Node 24.14.0、pnpm 10.33.2、Electron 41.0.3，Linux x64。代码与本机验收完成，本次未发布。

## 已完成范围

Desktop Main 组装层拥有唯一冻结的 `DESKTOP_PRODUCT_CAPABILITIES`，共享包提供严格 schema、只读类型与固定错误。Main/preload 同源读取，平台适配验证后供 UI hooks 读取，没有新增可变状态、持久化或 Agent 协议。所有者与事件顺序见 [更新关闭规格](issue1-updates.md)。

本次完整落实 `appUpdates=false`：隐藏原生菜单、设置、状态入口和弹窗；拒绝旧命令、IPC、偏好写入与版本说明确认；禁止更新轮询、强制升级、下载、退出安装和历史恢复。production/preview、打包状态、开发更新开关和旧设置均不能重新开启。旧文件保留，更新状态为 idle/false，关闭发布 feed 配置，保留正常打包及运行资源。

本地 Agent、Provider/API key、Skills、MCP 保留。其他 false 字段仅声明后续产品目标，账号、商店、分享、遥测、远程工作区、手机远控和 Web 的执行关闭尚未完成，不能按本次结果宣称这些服务停止联网。

## 实际验证

| 验证                                                     | 真实结果                                                                                                                                                          | 本地证据（均不提交）                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 固定配置、严格 schema、更新副作用 guard、UI 发布身份规则 | 4 个单元测试通过                                                                                                                                                  | Desktop `test:product` 3 个；UI `productUpdateVisibility.test.ts` 1 个                             |
| production / preview 更新专项                            | 4 个场景通过：各自重新构建后分别用干净目录和旧配置启动；旧目录正常重启；每场景 8 类请求明确拒绝；更新器调用、强制更新请求及陷阱 feed 请求均为 0                   | `packages/desktop/.e2e-artifacts/updates-1790782576405/report.json`                                |
| 真实核心与扩展回归                                       | 14 个阶段通过：真实 DeepSeek 配置、对话、Bash、权限拒绝/允许、busy 追加、停止、正常重启恢复、SQLite；用户级/工作区级 Skill、stdio MCP、带鉴权头的 HTTP MCP 均完成 | `packages/desktop/.e2e-artifacts/4b1f3b4b-1675-4542-81fe-3158aace9013/report.json`、截图及脱敏日志 |
| 实际 AppImage 更新专项                                   | 干净与旧目录 2 个场景通过，旧目录重启通过；实际 electron-updater 缓存路径中的待安装文件保留；Chromium netlog 有真实事件且无更新 manifest / 陷阱 feed 请求         | `packages/desktop/.e2e-artifacts/updates-1790782546948/report.json`                                |
| 包内 Agent 冒烟                                          | 使用包内 Agent 与 Provider 资源完成真实 DeepSeek 对话；退出码 0；SQLite 中 1 条输入、精确回复仅持久化一次                                                         | `packages/desktop/.e2e-artifacts/updates-1790782383505/report.json`                                |

核心会话有 9 条唯一已接受输入，按序 promotion，1 条运行中追加输入；停止工具没有迟到完成，权限拒绝和停止的工具 error 为预期结果。扩展会话独立，两个 Skill 和两个 MCP 工具均完成，stdio/HTTP 各执行一次。已打包冒烟只验证一次对话与持久化，完整核心/Skills/MCP 回归在未打包 Desktop 上执行。

旧目录专项覆盖开启自动安装/预览、未来版本的待展示版本说明和真实 SDK 缓存位置；不借助清理用户数据来实现关闭。未打包专项在启动前观察真实更新器调用和强制升级请求来源；已打包专项使用真实 Chromium 网络记录，无生产 spy 注入。

## 本机产物与复现

本机先重新构建 Agent、准备现有运行资源，再清理重建 production Desktop 输出。沿用已安装的锁文件依赖和版本匹配的本机 Electron，不声称是全新操作系统或重新安装全部依赖。实际生成并启动 AppImage，`app.isPackaged=true`；未做系统级安装。

```sh
ZCODE_ENV=production pnpm --filter @zcode/desktop build:no-runtime-assets
# 以下从 packages/desktop 执行；本机 Electron 路径按环境调整。
ZCODE_ENV=production ZCODE_TARGET_OS=linux ZCODE_TARGET_ARCH=x64 pnpm exec electron-builder --config electron-builder.config.js --linux AppImage --x64 --publish never --config.electronDist=/home/sc/projects/ZCode-CZCE/node_modules/electron/dist --config.directories.output=.e2e-artifacts/issue1-package
```

产物：`packages/desktop/.e2e-artifacts/issue1-package/ZCode-3.14.3-linux-x86_64.AppImage`，190,699,797 字节（约 182 MiB）。SHA-256：`739fcf4e91ad6c32c0658252749ed1ed3fa631d186f6ef41567f634a0664a42a`。

包内 Agent、内置 Provider 配置、rg 和本机运行资源已核验，现有 afterPack 原生资源检查通过；未生成 `app-update.yml` 或更新 feed 元数据。Linux 使用 `APPIMAGE_EXTRACT_AND_RUN=1` 实际启动。测试命令、私有 key 文件与可选扩展/打包冒烟见 [E2E README](../../packages/desktop/e2e/README.md)。

## 静态检查与边界

- `node scripts/check-workspace-freshness.mjs`：main 与 origin/main 同步，ahead/behind 0。
- `pnpm typecheck`：通过。当前根入口包含 Desktop Host，不覆盖全部 Main/preload/renderer。
- `pnpm lint`：0 errors、70 条已有 warnings。
- `pnpm architecture:check --changed`：0 violations、0 baseline、0 new。涉及 Desktop、shared、UI；这些目标在当前架构策略中没有受管模块契约，不新增架构 baseline 或策略例外。配置归属 Desktop Main，更新状态仍归原更新模块，Host/Agent 业务状态不迁移。
- 额外 Main/preload/renderer `tsc --noEmit`：仍失败。与原 HEAD 在隔离 worktree 的 Desktop 文件诊断比较，Main 87→87，preload 3→3，renderer 126→125；按文件及错误码比较没有新增诊断。已有缺失类型导出、`Window.zcode` 声明等问题未在本次扩展修复；这不等于全部 Desktop 类型检查通过。
- 功能索引新增 3 个核实节点和 2 条边；YAML、节点唯一性、边端点、种子文件及符号验证通过（总计 40 节点、54 边）。41 个变更文件格式检查及 `git diff --check` 通过；相对 HEAD 净增 2,169 行，包含此前授权建立的 E2E 基线与规格，不全是本次生产改动。2,885 个源码/产物文本/报告/日志文件扫描真实 key 精确匹配为 0，仓库外 key 文件权限仍为 600。

Windows/macOS 本次只审查共用更新 guard、IPC、菜单和打包边界，没有实际打包、签名或运行验证；不能用 Linux 结果替代。跨 Host、远程 identity、手机恢复语义没有本次运行覆盖，相关实现未修改。未运行全仓 knip 或完整 CLI 独立类型检查，本次没有删除导出或改动 CLI 生产实现。

扩展测试最初发现 `.agents/mcp.json` 未进入当前 v4 会话，随后使用当前原生 `.zcode/cli/config.json` / 工作区 `.zcode/config.json` 才完成真实 MCP 执行。本次未改动生产 MCP 加载逻辑，不能据此宣称 `.agents/mcp.json` 路径已经修复。

凭据读取和保存均在仓库外私有目录，key 配置阶段不截图。报告与日志脱敏，原始应用配置、数据库和 netlog 仅保留在权限 700 的测试临时目录；不提交或上传。此前基线试跑的隔离问题继续按 [基线结果](baseline-results.md) 记录，未删除真实用户数据库。
