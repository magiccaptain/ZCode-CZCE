# Issue #3 实施结果

2026-10-01；基于 Issue #2 `c0762ce`，版本 3.14.3。Node 24.14.0、pnpm 10.33.2、Electron 41.0.3，Linux x64。本 Issue 只创建一个本地提交，标题 `feat(desktop): disable product account and subscription (#3)`；不推送、不创建 PR、不修改 GitHub Issue。

## 完成范围 / checklist

- 统一事实仍由 Desktop `DESKTOP_PRODUCT_CAPABILITIES` 拥有。Local Host 与旧远端 tab 的本机服务消费同源只读视图；其他装配缺省保持兼容，不复制产品可变事实。
- 产品 OAuth 在 adapter、凭据读取、迁移、回调、timer、刷新与登出删除之前拒绝；UI 不恢复旧用户，不订阅账号 callback/JWT/observer，不显示登录/注册/切换/退出；旧 intent 被消费为失败。
- 服务排除 Account Config Source，用显式 `entitled=false` overlay 同步托管 Agent；请求期账号 credential cache/远端 API/auth/provisioning 全部受执行 guard 约束，不能读取旧 token 或注入团队/套餐模型。独立源码 CLI 显式 standalone 兼容保留，不修改托管 Runtime 协议。
- 购买、支付、套餐、Start/Team Plan、权益、产品用量/reset 与 Off-Peak 启动 sync/outbox/admission 不可执行；UI 无购买 inventory、权益刷新和套餐推荐/跳转。本地 App Usage、普通 automation、通用 workflow/client config 与 Built-in catalog 保留，不把订阅关闭伪装为订阅有效。
- 本地模型设置复用原 Provider Settings/Model Selection、模板和编辑卡：endpoint/key/模型编辑、选择、测试和排序均走原服务；保留 `zhipu-coding-plan-api-key` 等用户 API key。旧账号模型不可用时提供本地设置动作；外部 Provider 鉴权/额度/计费错误保留原文、详情和重试，不跳转登录/升级。
- 集成补齐组件明确留下的 Main seam：旧 OAuth state/handled、授权/支付深链在路由缓存/聚焦/刷新前停止；OpenExternal 通过既有 callback、产品 redirect 与可信 embedded Coding Plan 识别拒绝产品请求；webview 在 guest/preload 创建前拒绝，旧 guest popup/navigation 也不能恢复购买。单向 IPC 维持 void 契约并记录明确不可用码；普通 MCP localhost OAuth、Provider 文档/key/额度页面及正常浏览器保留，不按域名泛封禁。
- 官方账号 MCP 身份解析使用既有 unavailable 契约，不读旧 JWT；通用 stdio/HTTP MCP/API key/OAuth 不删。Feedback 只排除旧产品身份，匿名设备反馈保留。
- 没有删除旧账号/模型/任务数据；没有移动会话、CommandInbox、owner/lease、workspace identity、stale run 或恢复 owner；无协议改动、无同步 timeout。商店/分享、远程/远控、发行链与依赖清理仍分别归 #4–#7。

## 实际验证

| 检查                           | 实际结果 / 证据                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| freshness                      | main ahead 2 / behind 0；起始 HEAD c0762ce。前序 services/UI 未提交文件全部保留                                                                                                                                                                                                                                                                                                                                 |
| 关闭与回归单测                 | `pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/*.test.* packages/services/test/*.test.ts packages/desktop/test/*.test.*`：59/59 通过；本 Issue 新增 21 个单测（services 12、UI 7、Main 2），另更新 Host 同源接线。包括实际旧文件保留、本地 API key 保存/服务重建、通用 MCP key、套餐方法拒绝、Provider/恢复链既有回归                                                              |
| Main red/green                 | 新原生测试原实现两项失败，且旧 OAuth 五分钟 timer 导致测试进程未退出，120s runner 截止；加 guard 后 2/2 通过、正常退出。真实 Electron 原实现允许购买 webview attach（false 而非 true），专项失败；修复后通过。没有用产品 timeout 掩盖该问题                                                                                                                                                                     |
| Desktop 账号专项               | test 与 production 身份均实际重建 Agent/Main/Host/preload/Renderer，干净启动与旧过期 token/损坏 profile 重启共两次退出 0；7 类场景通过：Main 旧原生请求拒绝、普通外链保留、真实 DOM 购买 guest attach 阻止、菜单无产品项、本地 endpoint/key/模型设置保存、模型 UI 选择与重启恢复；旧 credentials 字节始终一致                                                                                                   |
| 真实核心 / Skills / MCP / 遥测 | `e2e:baseline --key-file <仓库外私有文件> --extensions --telemetry` 重建当前源码后全部 14 阶段通过。真实模型对话、Bash 文件读写、权限拒绝/允许、busy 追加、停止、正常重启恢复；用户级/工作区级 Skill、stdio 与带测试鉴权 HTTP MCP 实际调用。SQLite 9 条唯一已接受输入、串行 promotion、1 条 queued；停止无迟到完成。两个 Skill 完成，stdio/HTTP 各调用一次；显式 OTLP 陷阱 0、旧遥测字段保持、Renderer SDK 缺席 |
| 根 typecheck                   | `pnpm typecheck` 通过；实际覆盖以 package.json 为准（含 Host，不含全部 Main/preload/renderer）                                                                                                                                                                                                                                                                                                                  |
| lint / architecture            | `pnpm lint` 0 errors / 70 条已有 warnings；`pnpm architecture:check --changed` 0 violations / 0 baseline / 0 new                                                                                                                                                                                                                                                                                                |
| CLI 独立检查 / 构建            | `PATH=<固定 Node>:<根 node_modules/.bin>:$PATH pnpm --dir apps/zcode-cli build` 16/16 tasks，`typecheck` 27/27 tasks 通过，均 Turbo cache 命中。Desktop E2E 另实际重新构建/同源暂存 Agent；不宣称全新依赖安装                                                                                                                                                                                                   |
| 变更格式 / diff                | 全部本 Issue 变更 `pnpm exec oxfmt --check <变更文件>` 与 `git diff --check` 通过；无额外 spec 提交、无 staged 文件遗留                                                                                                                                                                                                                                                                                         |
| 额外 Desktop tsc               | Main/preload/renderer `tsc --noEmit` **失败**，分别 87/3/125 条诊断，与 Issue #1/#2 已报告数量一致；三处新增 Main guard 文件没有诊断。未声称完整 Desktop tsc 通过，未扩修无关失败；数量一致不等同新隔离 worktree 全基线证明                                                                                                                                                                                     |

核心报告：`packages/desktop/.e2e-artifacts/e4e48f35-c7ed-4fc1-b4e9-3866db8bb64a/report.json`。production 账号报告：`packages/desktop/.e2e-artifacts/account-1790800600028/report.json`；最终 test 账号报告：`packages/desktop/.e2e-artifacts/account-1790800918323/report.json`。两个最终专项均包含旧 guest popup/navigation fixture 与真实 DOM attach，两次退出码均 0；最后仅格式化，无生产逻辑变更。全部报告/缓存/脱敏日志忽略不提交，托管 artifact 保留各命令日志。

服务集成网络为实际服务 request sentinel，禁用请求不访问端口；仅保留通用 `/api/v1/client/configs` catalog，注入 404 验证错误如实传播。Main 专项使用浏览器 spy，观察产品打开次数为零、正常 URLs 仍调用原浏览器端口；真实 DOM webview attach 被 preventDefault。该证据不是全进程全流量抓包，不能描述为整个产品断网。

## 新旧失败与限制

- services/UI 先测试再实现的失败与修复详见组件交接（包含无效 MCP 错误码、Promise 返回类型和 E2E 子菜单/工作区导航假设，均已修复后重跑）。不带 UI tsconfig 的第一次全量测试失败是现有 alias 无法解析；最终使用正确 tsconfig 59/59 通过，不改既有测试。
- 账号 E2E 退出日志仍有既有 `SQLite startup failed: transport_closed` / Controller source teardown 诊断；退出码 0，真实核心/持久化断言通过。未扩修生命周期；不能将此记录为所有日志无错误。
- Windows/macOS、系统级安装/签名、当前 Issue 安装包与真实外部 MCP OAuth 浏览器授权未运行。本机 HTTP MCP 用 fixture 鉴权头，不冒充 OAuth 登录；普通 OAuth URL 原生端口保留经单测与专项验证。外部 Provider 真正返回 401/额度拒绝未向真实收费服务主动制造；错误原文/UI 由源组件测试验证，真实 Provider 正常调用已回归。
- 非 Desktop 默认服务与 standalone 账号兼容仍在源码；远端 backend 本身关闭留 #5，本 Issue 只防止 Desktop 本机账号服务借旧远端 tab 复活。通用 catalog/workflow/反馈可能联网，保留正常 Agent shell/网络/浏览器能力。
- 真实私有 key 只由既有基线 runner 读取且不打印；配置阶段不截图，原始凭据/数据库留权限受限临时目录，不提交真实数据或内部地址。无真实用户数据清理。

## Fresh review 修复（仅 amend 本 Issue）

两项 P1 均经源码与实际失败测试确认有效；没有无效 finding 或未解决 finding。本轮不扩修 #4–#7、不新增协议/产品配置/状态 owner。

1. `EmptyAccountProviderConfigSource.onDidChange` 原先静默 no-op，截断 `zcodeAgentService` 的 active-client 热同步。现直接转发 Config Service 通知与退订；read 仍生成当前 revision 对齐的 `entitled=false`。新测试实际启动 `worker_threads.Worker`，运行公开 `ProviderRegistryService`：A 已发布，B config 先到时保留完整 A，禁用 source 通知交付 B overlay 后发布 B endpoint，本地 Personal key 后续发布、账号仍无权益，退订停止通知。原实现实际失败 `'A' !== 'B'`，修复后通过。测试隔离来源与 Worker Registry，不冒充完整 CLI stdio/真实模型热切换。
2. Main 原生 attach/popup/navigation 原先只识别顶层 `embedded=app`，漏掉同源 `returnTo` 携带标记的既有支付 callback。三处禁用 guard 复用 `isCodingPlanPaymentCallbackUrl`；popup/navigation 同时识别来源和目标。不扩为 PayPal/Provider 域名封禁。专项测试真实 DOM 创建 callback webview，断言两个 attach 都 preventDefault；旧普通 guest 导航/popup 到 callback、callback 来源外跳均拒绝且无 browser routing/openExternal/loadURL；普通 Provider guest 导航 PayPal 保留。原实现真实 Electron 失败 `false !== true`（callback navigation），修复后 test/production 均通过。

本轮改动文件：`packages/services/src/model-provider/providerRuntime.ts`、`packages/services/test/emptyAccountProviderConfigSource.test.ts`、`packages/services/test/fixtures/accountRegistryWorker.mjs`、`packages/desktop/src/main/desktopWindowChrome.ts`、`packages/desktop/e2e/account-native.mjs`、`specs/desktop-local-fork/issue3-account.md`、本 results。先 spec、失败测试、架构检查与 services/desktop context，再生产代码；两模块仍 unmanaged / module.ts missing，无直接受管契约，不添加架构基线例外。

本轮实际检查：

- `node scripts/check-workspace-freshness.mjs` **失败**：`git fetch origin --prune` 的 GnuTLS 握手失败；远端 freshness 未确认，起始本地 main HEAD `b99d89c`，工作区 clean。没有 push/PR/Issue 修改。
- `pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/*.test.* packages/services/test/*.test.ts packages/desktop/test/*.test.*`：**60/60 通过**（新增上述 Worker regression 1 项）。单独 Worker red/green 实际执行；fixture 初稿曾缺 Provider group 导致测试准备失败，补正为既有 standard-personal 后才记录产品 red。
- `pnpm --filter @zcode/desktop exec tsx e2e/run-account.mjs` 和 `ZCODE_ACCOUNT_E2E_ENV=production` 前缀：重新构建实际 Agent/Desktop，7 类原有场景及新增 callback attach/旧 guest 断言全部通过，两次正常启动/退出与旧凭据保留通过。最终报告分别 `packages/desktop/.e2e-artifacts/account-1790802278759/report.json`（test）与 `account-1790802369719/report.json`（production）。原失败报告 `account-1790802151802/report.json`。
- 根 `pnpm typecheck` 通过；`pnpm lint` **0 errors / 70 个已有 warnings**；`pnpm architecture:check --changed` **0 violations / 0 baseline / 0 new**。
- 额外 Main `pnpm exec tsc --noEmit -p packages/desktop/tsconfig.main.json` **失败：87 条诊断**，数量与先前报告一致；`desktopWindowChrome.ts` 无诊断。未把完整 Desktop tsc 标为通过，未扩修无关基线。
- 根 `pnpm fmt:check` **失败：32 个本轮未改动文件**（README、Bot、部分原会话/UI 文件与 Issue #2 results）；未扩修无关格式。全部本 Issue 变更文件的 `pnpm exec oxfmt --check` 与 `git diff --check` 通过。最终只有当前 Issue #3 提交 amend，没有额外提交或 staged 文件遗留。

日志位于本次托管 artifact（`issue3/worker-red.log`、`account-red.log`、`account-green.log`、`account-production-green.log`、`tests-green.log`、`typecheck.log`、`lint.log`、`desktop-main-tsc.log`、`fmt.log`）。本轮没有重新运行私有 key 核心/Skills/MCP；上文既有执行证据仍保留，不称为此次复测。Windows/macOS、当前 Issue 安装包、真实 MCP OAuth 和全进程流量仍是未验证范围；freshness 网络限制新增，其余保留边界不变。

## Handoff

公开接口：`@zcode/services` / `@zcode/services/node` 的只读 `AccountProductCapabilities`、`PRODUCT_ACCOUNT_UNAVAILABLE`、`PRODUCT_SUBSCRIPTION_UNAVAILABLE`；既有 OAuth、Usage、Subscription、Provider Settings/Model Selection 契约保持。Main 不新增产品状态，UI 只派生能力。services/desktop/ui/session context 均 legacy unmanaged，缺 module.ts；session 策略声明的 contract.ts 实际不存在，未创建额外受管模块/基线例外。

后续 #4 保留上述本地设置、Skills/MCP 凭据与已安装资源，不再引回产品账号/套餐；#5 保留现有 Host/Agent 路由与身份防护；#6/#7 按真实调用/构建依赖收敛，不批量删除 account/subscription 文件中的通用配置设施。
