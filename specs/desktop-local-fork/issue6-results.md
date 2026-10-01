# Issue #6 实施结果：Desktop 专用开发与发行闭包

2026-10-01；基于 Issue #5 `77fba4e23b589c6d8bde68c3c592adefe216fffa`，版本 3.14.3。Linux x64，Node 24.14.0、pnpm 10.33.2。只作一个本地 Issue #6 提交，不推送、不创建 PR、不修改 GitHub issue。

## 已完成范围与交接接口

- 根 `build` 明确调用 Desktop，`build:bootstrap` 复用同一入口。bootstrap 只 install → build:bootstrap；旧参数在 install 前拒绝，无 submodule 初始化、递归 Web/server 产品 build 或远程准备分支。
- 根、Desktop、Web/server/server-cli manifest 不再提供旧产品 dev/build/stage/远程资产入口；旧直接发行/准备脚本明确非零拒绝。旧 runner 只拒绝首参数 `--web`，保留普通 Agent prompt、`--` 后文本及其余参数。
- 默认 runtime preparation 只构建本地 Agent、搜索工具和目标平台 helper，不依赖 skip 环境，不准备 mock-cdn、远端 Node/server/部署资源。bundle 准备一次后调用 `build:no-runtime-assets`。
- Agent 完整 core/bootstrap/adapters/contracts/shared-types、必要 workflow/browser/node-repl 依赖、同源 stage bundle/meta、Provider、用户/工作区 Skills、stdio/HTTP MCP、搜索/native 工具与许可声明保留。旧 remote bootstrap 环境不能复用残留 Agent。
- 固定能力唯一 owner 仍为 Desktop 产品组装层，无复制配置、协议修改、用户数据清空或状态迁移。CommandInbox、owner/lease、workspace identity、stale run 与恢复协议不改。
- 新增 9 个构建闭包测试与真实安装包综合关闭 runner；中英文 README、AGENTS、mise 与 source-discovery 技能同步实际入口。集成复核补齐英文目录说明与最终结果链接；没有重写组件或扩大功能裁剪。

规格、错误和时序见 [构建闭包规格](issue6-build.md)。Web/server/server-cli workspace 成员、lockfile 和被 Desktop 引用的库源码仍保留，物理清理归 #7；不按包名删除动态依赖。

## 构建组件交接证据（集成已核对）

以下在前序串行组件实际执行，原始日志保留，不冒充集成阶段重跑干净安装：

| 命令或实验                                                                                                                                                                       | 真实结果                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 先新增闭包测试，执行选中测试                                                                                                                                                     | 预期红：递归 manifest、默认远程准备、旧 --web、残留 Agent 复用 4 项失败；旧 remote server builder 另在实现前失败                                                                                             |
| 删除 root/CLI dist、tsbuildinfo、Desktop out/bundled-agents/bundled-tools/mock-cdn 和统一发行输出，`pnpm install --frozen-lockfile`                                              | 通过，33 projects，native postinstall 完成，lockfile 未变；保留依赖/store 缓存，不是全新 OS 安装                                                                                                             |
| 清输出后 `pnpm build`，再次清输出后 `ZCODE_ENV=production pnpm build`                                                                                                            | 均通过，无 remote skip 环境；该检查点没有 Web/server/server-cli 产品 dist/mock-cdn。之后根 typecheck 可能生成保留库的 dist，不能混淆为产品发行                                                               |
| `ZCODE_ENV=production ZCODE_TARGET_OS=linux ZCODE_TARGET_ARCH=x64 pnpm --filter @zcode/desktop exec electron-builder --config electron-builder.config.js --linux AppImage --x64` | 实际生成 production AppImage，native/resources/notices hooks 完成；并非只验证开发态                                                                                                                          |
| 第一次包内 updates 英文交互                                                                                                                                                      | 失败：继承中文系统语言，`Skip` selector 不匹配。保留失败报告 `packages/desktop/.e2e-artifacts/updates-1790823794501/report.json`；固定测试进程 `LANG=en_US.UTF-8` 后同一未修改生产包通过，未改变产品语言行为 |
| 第一次 CLI 独立 typecheck                                                                                                                                                        | 失败：nested CLI shim PATH 找不到根 turbo；加入根 `node_modules/.bin` 后 forced typecheck 27 tasks 真正执行通过，没有修改依赖绕过                                                                            |

原始日志位于下述受管证据目录中的 `install.log`、`production-clean.log`、`build-production.log`、`appimage-production.log`、`packaged-updates.log`、`packaged-updates-en.log`、`cli-typecheck-first.log` 与 `cli-typecheck-force.log`。没有实际完整执行真实 `pnpm bootstrap` 的 install/build 连锁；其命令顺序由子进程测试验证，install 与同一个 build 各自已真实执行。

## 集成阶段实际重跑

所有下列命令在本阶段重新执行；E2E 使用 `LANG=en_US.UTF-8`，AppImage 使用 `APPIMAGE_EXTRACT_AND_RUN=1`。有凭据的测试仅将授权仓库外 key-file 交给已有 runner，不输出内容、填 key 时不截图。

| 命令                                                                                                                                                  | 真实结果及范围                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-workspace-freshness.mjs`                                                                                                          | main 新鲜，ahead 5 / behind 0                                                                                                                                                                                                                                    |
| `pnpm architecture:check --changed`；`pnpm architecture:context desktop/server/zcode-server-cli/zcode-cli` 分别执行                                   | 架构 0 violations / baseline 0 / new 0；四个目标均 legacy/unmanaged、无 module.ts。CLI tools contract 已读；root/scripts/构建元数据不在受管 source roots，不新增策略例外                                                                                         |
| `pnpm typecheck`                                                                                                                                      | 通过；只按当前根 references 覆盖，包括 Desktop Host，不代表全部 Main/preload/renderer 通过                                                                                                                                                                       |
| `pnpm lint`                                                                                                                                           | 通过：0 errors / 70 个已有 warnings                                                                                                                                                                                                                              |
| `node --test packages/desktop/test/desktopBuildClosure.test.mjs`                                                                                      | 9/9 通过：manifest、默认准备旧 env、直接拒绝、runner delegation、完整 Agent 资源、bootstrap 顺序、清残留与动态闭包                                                                                                                                               |
| `pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/*.test.* packages/services/test/*.test.ts packages/desktop/test/*.test.*` | 178/178 通过，0 skips，包括同源服务装配、Main/Host/Bot/UI admission、CLI app-server 和保留资源                                                                                                                                                                   |
| PATH 加根 `node_modules/.bin` 后 `pnpm --dir apps/zcode-cli typecheck --force`                                                                        | 27/27 successful，0 cached                                                                                                                                                                                                                                       |
| `node scripts/build-desktop-agent-cli.mjs`                                                                                                            | 独立 CLI/完整 Desktop Agent build 通过，同源 bundle 仍与已验证安装包 hash 一致                                                                                                                                                                                   |
| `node <受管证据目录>/package-audit.mjs`                                                                                                               | 实际包审计通过，30,784 个 asar entries，必要资源存在，旧产品树/远端 Node absent；hash 见下文                                                                                                                                                                     |
| `pnpm --filter @zcode/desktop exec node scripts/audit-bundle-size.mjs --artifact-path <AppImage>`                                                     | 通过，182.1 MiB / 500 MiB limit                                                                                                                                                                                                                                  |
| `pnpm --filter @zcode/desktop exec tsx e2e/run-build.mjs --executable <AppImage>`                                                                     | 真实 production 包首次启动/重启通过；旧账号/市场/share/SSH/WSL/Docker 对象保留，入口关闭，真实 preload refusal，Main OAuth/支付 callbacks 0，旧 share intent 投递 1 次但不导入，market trap 0，匹配的 Chromium product URL 0，退出均 0                           |
| `pnpm --filter @zcode/desktop e2e:updates --executable <AppImage> --key-file <仓库外私有文件>`                                                        | 真实包 clean/legacy 均通过；各拒绝 8 请求、trap 0、退出 0，legacy 重启；包内 DeepSeek 对话与 SQLite once-only 持久化通过                                                                                                                                         |
| `pnpm --filter @zcode/desktop exec tsx e2e/run-telemetry.mjs --executable <AppImage> --key-file <仓库外私有文件>`                                     | 真实包 clean/legacy 均通过；SDK absent、product/explicit OTEL 请求 0，legacy queue/identity 字节保留，退出 0，包内真实模型与持久化通过；report 的 agentBoundaryValidated=false，不冒充子进程全流量证明                                                           |
| `pnpm --filter @zcode/desktop e2e:baseline --key-file <仓库外私有文件> --extensions --telemetry`                                                      | test/Preview 实际重建，15 stages 全通过：模型、文件/Bash、reject/allow、busy 追加、stop/no late completion、重启恢复、9 unique serially promoted inputs、用户/工作区 Skills、stdio MCP 1 call、带测试鉴权 HTTP MCP 1 call/31 authenticated requests、OTEL trap 0 |
| `ZCODE_ACCOUNT_E2E_ENV=production pnpm --filter @zcode/desktop exec tsx e2e/run-account.mjs`                                                          | 正式身份开发包通过：原生 OAuth/payment/external/webview 绕过拒绝；正常 MCP/浏览器 URL 保留；本地 Provider fixture 配置、模型选择、重启持久化及旧凭据字节保持，退出 0                                                                                             |
| `ZCODE_MARKET_SHARE_E2E_ENV=production pnpm exec tsx packages/ui/test/productMarketplaceSharing.e2e.mjs`                                              | 正式身份开发包启动/重启通过：设置/Skills/MCP/Subagents 本地入口、真实内置卸载/离线恢复与 suppression；旧 share 无导入，市场/Renderer 请求 0，旧来源/附件保留，退出 0                                                                                             |
| `ZCODE_REMOTE_E2E_ENV=production pnpm --filter @zcode/desktop exec tsx e2e/run-remote-backend.mjs`                                                    | 正式身份开发包两次通过：preload/Main/Host 旧远端/replay 绕过拒绝；每次 4 offending EventListen ports 关闭、4 Task Promise 拒绝后同 attachment 上本地 Task/Agent RPC 存活，退出 0                                                                                 |
| `ZCODE_REMOTE_UI_E2E_ENV=production pnpm exec tsx packages/ui/test/productRemoteWorkspace.e2e.mjs`                                                    | 正式身份开发包两次通过：三条不可用历史、无远端/手机 wrapper、本地目录打开与独立 Bots 设置可达，旧 identity 不降级，退出 0                                                                                                                                        |
| 受影响文件 `pnpm exec oxfmt --check`；`git diff --check`                                                                                              | 通过；最终提交后检查工作区干净、暂存为空                                                                                                                                                                                                                         |

### 现有全量 Desktop tsc 失败（不是通过）

额外实际运行 `pnpm exec tsc --noEmit -p packages/desktop/tsconfig.{main,preload,renderer}.json`（分别执行）：三者均 exit 2，分别 87、3、125 条诊断。Main 含 shared 不在 rootDir/file list；preload 缺 DesktopZoomState 等共享导出；renderer 含 Window.zcode 缺声明。与 [Issue #1 记录](issue1-results.md) 的现有计数一致；本 issue 未改 Desktop src 或 tsconfig，不以根 typecheck/打包成功宣称这些失败消失。未另造完整隔离 worktree 比对每条诊断；保留本次完整日志，不虚报修复。

## 生产产物与运行报告

实际执行的 production 产物：`packages/desktop/dist/ZCode-3.14.3-linux-x86_64.AppImage`。

- AppImage SHA-256：`51dc352a463eaa37b7aa397a45ed38b393545de3dd5e52b9b24b2066e919ff54`。
- 当前 CLI / staged / 包内 Agent SHA-256：`bf5a0031b5c75e58e4d16bead94965740fde8020e0970fd5a8f8a64f2b880378`。
- 必要资源：browser-client/docs/Skills、node-repl MCP server、bundled Skills、rg/bfs/ugrep、root config/provider、notices/licenses。
- 顶层 resources 仅 notices、asar/unpacked、config、glm、icons、licenses、tools；无 Web/server/mock-cdn/remote-assets 产品树、远端 Node、旧 glm native Agent。保留库代码/动态 externals 不等于独立产品发行。

本阶段成功 JSON（均被 Git 忽略，内含测试 fixture，不提交原始临时配置/数据库/netlog）：

- `packages/desktop/.e2e-artifacts/build-1790825143241/report.json`
- `packages/desktop/.e2e-artifacts/updates-1790825159060/report.json`
- `packages/desktop/.e2e-artifacts/telemetry-1790825184441/report.json`
- `packages/desktop/.e2e-artifacts/35d963c0-169b-447c-8929-443224fba681/report.json`
- `packages/desktop/.e2e-artifacts/account-1790825313516/report.json`
- `packages/desktop/.e2e-artifacts/market-share-ui-1790825370934/report.json`
- `packages/desktop/.e2e-artifacts/remote-backend-1790825429932/report.json`
- `packages/desktop/.e2e-artifacts/remote-ui-1790825484946/report.json`

受管本机日志与复制的 report 目录：`/home/sc/.pi/agent/sessions/--home-sc-projects-ZCode-CZCE--/subagent-artifacts/outputs/1966916d-7426-4305-8821-ad46fa2d9f71/issue6/`；本阶段日志均以 `integration-` 开头。测试在最终 #6 提交前执行，核心报告 commit 字段是 #5 加已授权 dirty diff，不伪装为当时已提交；最终审查 patch 由 HEAD^..HEAD 另导出至仓库外 `/tmp/zcode-fork-issues/issue6-current-commit.patch`、`issue6-current-files.txt`、`issue6-current-summary.txt`。

## 保留边界、风险与下一步

- 仅 Linux x64 AppImage 实际构建运行，未系统安装，未执行 Windows/macOS、签名/notarization、其他发行格式或全新 OS/无缓存构建。
- full Skills/MCP 核心执行在 test/Preview 开发包；production 包内真实模型与资源审计分开验证，没有包内完整 Skills/MCP 回归。MCP fixture 测试鉴权不是浏览器 OAuth 授权闭环。
- 网络证据是 Chromium netlog 与本机 fixture counter，不是全进程抓包；真实 native crash、Computer Use/浏览器操作与跨 Host/手机恢复未实跑。当前检出无手机配对/relay owner，不能凭未知旧 fixture 宣称真实配对服务验证。
- 包内无私有 Host RPC/IPC Promise 绕过桥；本阶段已真实重跑 production 开发专项覆盖它们，没有为包新增生产测试后门。两窗口 owner 隔离由组件测试覆盖，不冒充同时两个 GUI 窗口实跑。
- 必需源码/动态依赖保留，不把关闭能力名当 unused 依据。#7 接收上述公开入口、资产闭包与 E2E 契约，按实际引用再删旧包/辅助源码/配置并建立固定 SHA 上游同步流程。
