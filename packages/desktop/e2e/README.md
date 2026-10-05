# Desktop 核心 E2E 基线

## 首次打开模拟

开发入口：`mise run dev-first-run`（等价 `pnpm dev:desktop:first-run`）。先退出应用并停止当前开发进程；每次命令使用新的临时数据，终端打印目录，退出后保留。原 `mise run dev` 不变。

`node --test packages/desktop/test/firstRunDevelopment.test.mjs` 覆盖命令配置、完整路径隔离、原数据保留、退出码与信号。`pnpm exec tsx packages/desktop/e2e/run-first-run.mjs` 重建实际 Agent/Desktop，复用新入口的环境分配并通过实际 UI 完成引导，验证同目录重启不再引导、再次分配新目录重新引导、Electron 实际路径及旧引导文件保留，不请求模型。截图与报告位于 `.e2e-artifacts/first-run-*/`；E2E 本身使用现有构建测试启动器，命令委派由子进程测试覆盖。

规则见 [`first-run-development.md`](../../../specs/desktop-local-fork/first-run-development.md)。本机结果不代替 Windows/macOS 或安装器验证。

模式默认值专项：`pnpm exec tsx --test packages/ui/test/interfaceMode.test.ts` 验证首次缺省为办公与已保存偏好/旧别名恢复。上述首次启动 E2E 还核验引导第二步办公在第一行并默认选中、编程在第二行、办公完成后重启以及主动选择编程后重启和手动重开引导。规则见 [`onboarding-interface-mode.md`](../../../specs/desktop-local-fork/onboarding-interface-mode.md)。

工作方向专项：`pnpm exec tsx --test packages/ui/test/onboardingWorkDirections.test.ts packages/services/test/onboardingWorkDirections.test.ts` 验证 12 项郑商所工作方向的设置/patch 校验、中英文名称与任务说明、旧职业兼容、记录同步与跳过语义。首次启动 E2E 同时检查第一步无默认选择、“下一步”禁用、选中/返回/改选、保存重启及手动重开预填，覆盖中英文、浅/深主题、宽屏两列和窄屏一列。规则见 [`onboarding-work-directions.md`](../../../specs/desktop-local-fork/onboarding-work-directions.md)。

第三步偏好专项复用首次启动 E2E：中文办公只有推荐/记忆两项、默认勾选、可取消并保存/重开恢复；英文编程只有记忆一项、默认关闭。完成与跳过都不从引导打开迁移向导，跳过仍保留 settings false / record null。截图为 `office-preferences.png`、`coding-preferences.png`，规则见 [`onboarding-preferences.md`](../../../specs/desktop-local-fork/onboarding-preferences.md)。

## 产品品牌

`pnpm exec tsx packages/desktop/e2e/run-branding.mjs` 从当前源码重建 Desktop，在独立临时目录实跑中文/英文首次引导、侧栏、原生关于窗口及正常退出，不请求模型。品牌元数据使用 shared 公共入口；测试确认新显示名称和显式 userData/sessionData 覆盖，并保留上游版权文字。

`node --test packages/desktop/test/productBranding.test.mjs` 验证 production / preview / development 名称、原数据目录及应用名隔离覆盖。截图和报告写入忽略的 `.e2e-artifacts/branding-*/`；本机 E2E 不代替 Windows/macOS 安装包验证。

图标的唯一形状源是透明的 `packages/ui/src/assets/branding/czce-agent.svg`。修改后从根目录执行 `pnpm --filter @zcode/desktop exec electron ../../scripts/generate-product-icons.mjs`，派生轮廓 SVG、透明 UI PNG、带底板的应用 SVG、全部 PNG/ICO/ICNS 与启动壳副本。`public/logo/czce-agent.png` 是透明预览；`public/logo/icons/` 继续保存带 B 款底板的系统图标。`node --test packages/desktop/test/productIcons.test.mjs` 校验尺寸、容器、副本和三种版本的形状一致；品牌 E2E 检查启动、引导、侧栏及关于图像的实际 alpha，检查首页轮廓 mask 加载、内部空白和主题 foreground 颜色，并保存浅深色截图。启动壳采用构建 HTML 的隔离渲染，不执行启动脚本，不作为实际启动就绪信号的时序测试。

## Issue #6 安装包综合关闭冒烟

先从当前源码执行 `ZCODE_ENV=production pnpm build` 并生成本机 AppImage（Linux：`ZCODE_ENV=production ZCODE_TARGET_OS=linux ZCODE_TARGET_ARCH=x64 pnpm --filter @zcode/desktop exec electron-builder --config electron-builder.config.js --linux AppImage --x64`）。默认准备不再需要 remote skip 环境。

```sh
LANG=en_US.UTF-8 APPIMAGE_EXTRACT_AND_RUN=1 pnpm --filter @zcode/desktop exec tsx e2e/run-build.mjs --executable /absolute/path/to/current/ZCode.AppImage
```

该入口不重建或替换安装包资产，不需凭据。真实启动/退出/重启旧账号、市场、share 与 SSH/WSL/Docker 历史目录，验证偏好/设置入口、preload 拒绝、Main 旧 OAuth/支付/分享深链、旧文件保留、本机市场请求和 Chromium netlog。安装包不提供 Host RPC/IPC Promise 绕过探针，这些执行边界仍由已有组件/开发专项覆盖；不声称全进程抓包或真实模型/Skills/MCP 执行。报告位于 `.e2e-artifacts/build-*/`。英文交互需英文系统语言；首次运行在中文系统上发生 Skip 定位失败，改测试进程 LANG 后实跑通过，不更改生产语言行为。

闭包组件测试：`node --test packages/desktop/test/desktopBuildClosure.test.mjs`。真实模型与更新/遥测包内冒烟、核心 Skills/MCP 回归使用下文已有 runner 和仓库外私有 key-file，不能以综合关闭冒烟替代它们。

规格：[`specs/desktop-local-fork/e2e-baseline.md`](../../../specs/desktop-local-fork/e2e-baseline.md)。本入口验证本地核心行为，可用于变更前后回归；测试本身不修改生产实现。

## 运行

从仓库根目录执行，Node/pnpm 必须与 `mise.toml` 一致（24.14.0 / 10.33.2）：

```sh
source "$NVM_DIR/nvm.sh"
nvm use 24.14.0
pnpm --filter @zcode/desktop e2e:baseline --key-file /absolute/path/outside/repository/deepseek-api-key
```

key 文件只包含 DeepSeek API key，放在仓库外的私有目录，文件权限设为 `600`。真实模型调用会使用 API 额度。测试走内置 DeepSeek 模板，目前模型为 `deepseek-flash`，API 格式由模板提供。

需要已安装根 workspace 与 Agent workspace 依赖、可启动 Electron 的桌面显示环境，以及 Provider/现有启动服务网络可达。当前实测平台为 Linux x64、英文 UI；Windows/macOS 与其他语言尚未实际运行。Bash 场景使用 `printf` 与 Node，需要目标平台对应工具可用。

每次执行都会重新构建 Agent、准备本地运行资源，并构建 Desktop 的 Main/Host/preload/renderer；不提供跳过构建选项，避免旧产物被当成当前源码的基线。构建使用 `ZCODE_ENV=test`（Preview 身份），不作为 production 更新关闭的验证。

## 场景和证据

- 首次启动：通过实际 UI 跳过引导与产品登录，进入工作区。
- 模型配置：在设置 UI 添加 DeepSeek，填 key、失焦保存，打开临时本地项目。
- 对话/工具：校验精确的模型回复、Bash 输出与实际文件内容。
- 权限：拒绝后目标文件不存在，再次请求并允许后文件出现。
- 追加输入：文件门闩阻塞真实前台工具，busy 时发送追加输入，检查 accepted ACK 与队列；释放后检查各操作只执行一次。
- 停止：取消真实前台工具后释放门闩，检查迟到文件没有生成；新的对话可以完成。
- 恢复：正常退出码为 0，同一私有数据目录重新启动，打开原 session，恢复历史并继续对话。
- 持久化：只读独立 Agent SQLite 库，检查 9 条已接受输入的 admission/promotion 顺序、唯一 queued 输入、工具状态/输出和回复。权限拒绝与停止对应的工具 error 是预期结果。

结果位于 `packages/desktop/.e2e-artifacts/<runId>/`，已由现有 `.gitignore` 忽略：

- `report.json`：commit、本地变更列表、版本、构建产物 hash、阶段结果、退出码与未验证范围。
- PNG：关键 UI 状态与运行中队列；输入 key 阶段不截图，不录 trace/HAR。
- `runtime.log`：经 key、Bearer token 与 URL 脱敏的进程日志。失败时另存 UI 文本。

原始应用配置、会话库与工作区在系统临时目录 `zcode-desktop-baseline-*` 中，根目录权限为 `700`；其中包含本次保存的 Provider key，仅供本地诊断，不上传或提交。终端与报告会给出该次运行的路径，核验后可删除本次目录。

`gated-tool.mjs` 是测试工作区中的受控命令，不改变 Agent Runtime。文件门闩用于确定性控制测试动作；120s 上限只防止测试失败后工具无限挂起。测试不向 store 注入状态，不绕过 Host 发送业务请求。

默认核心基线不覆盖更新专项、跨 Host owner/lease、远程身份隔离、手机恢复链路、Skills/MCP 或发行安装包；扩展与专项入口见下文。

## Issue #1 验证入口

- `pnpm --filter @zcode/desktop test:product`：固定能力与真实更新 guard 的单元测试，原生端口隔离。
- `pnpm exec tsx --test packages/ui/test/productUpdateVisibility.test.ts`：UI 产品规则优先于发布身份。
- `pnpm --filter @zcode/desktop e2e:updates`：分别重建 production/preview，覆盖干净目录、旧配置与缓存、8 类实际更新请求、原生菜单、设置及正常退出。启动前探针通过 SDK 构造函数的 `app.getVersion()` 调用栈阻止并记录更新器初始化，首次启动与历史重启均为零；探针不主动创建 SDK 实例。另观察强制升级调用来源，其他产品配置请求不计为更新请求。禁用模块加载的无效开发版本回归在 `test/updateGuards.test.mjs`，真实 `mise run dev` 验收边界见 [`dev-startup.md`](../../../specs/desktop-local-fork/dev-startup.md)。
- 核心基线追加 `--extensions`：原生 `.zcode/cli/config.json` / 工作区 `.zcode/config.json` 配置真实 stdio 与带测试鉴权头的 HTTP MCP；用户级/工作区级 Skill 通过 Skill 工具加载。在独立会话核验精确回复和持久化工具输出，核心会话仍检查原来的 9 条输入。
- `e2e:updates --executable /absolute/path/to/packaged/executable`：启动实际本机产物，不替换包内 Provider 资源。使用 Chromium netlog 核验无更新 manifest / 陷阱 feed 请求；原始 netlog 仅留在私有测试目录，报告只记录事件数。

已打包测试可额外提供 `--key-file /absolute/path/outside/repository/deepseek-api-key`，通过包内 Agent 和 Provider 资源完成一次真实对话并检查 SQLite 持久化。这个打包冒烟不替代完整核心基线。

Linux AppImage 本机运行示例：

```sh
APPIMAGE_EXTRACT_AND_RUN=1 pnpm --filter @zcode/desktop e2e:updates --executable /absolute/path/to/ZCode.AppImage --key-file /absolute/path/outside/repository/deepseek-api-key
```

这些测试会使用系统临时目录和忽略的缓存。默认更新测试不使用模型 key；追加打包冒烟时使用。`--extensions` 仍使用真实模型请求，MCP 仅连接本机 fixture。Windows/macOS 需要各自环境实际执行，不能用 Linux 结果替代。

## Issue #2 Desktop/UI 遥测边界

- `pnpm --filter @zcode/desktop exec tsx --test test/telemetryGuards.test.mjs`：真实初始化 guard 的端口隔离测试，包含 SDK 延迟加载、heartbeat、Host 订阅、网络任务、旧 ARMS 桥、OTLP exporter、Renderer SDK/TTFT 以及 Main 本地内存诊断保留。
- `pnpm exec tsx --test packages/ui/test/productTelemetry.test.mjs`：产品能力优先于 reporter、ARMS E2E 缓冲和 workspace telemetry supervisor。
- `pnpm --filter @zcode/desktop exec tsx e2e/run-telemetry.mjs`：无需模型凭据；分别重建 production/test 并启动实际 Electron Main/Host/preload/renderer，覆盖干净和旧遥测数据目录、显式 OTEL/trace/TTFT 环境、旧上报调用、绕过 preload 的 Main 请求、模拟原生错误通知及正常退出。观察 SDK 未加载、产品遥测请求和本地 OTEL 陷阱请求为零，旧队列/状态字节未变，本地 crashReporter 不上传。

- 核心基线追加 `--extensions --telemetry`：在实际模型、Bash、权限、追加、停止、恢复、用户/工作区 Skills、stdio/带鉴权 HTTP MCP 和退出期间设置显式遥测环境，验证 OTLP 陷阱请求为零、旧队列字段不变、Renderer SDK 缺席。缺 deviceMid 的旧文件仅允许原共享 identity owner 补身份（非遥测消费者仍需要）；已有合法身份的文件字节保持由关闭专项验证。
- `e2e/run-telemetry.mjs --executable /absolute/path/to/ZCode.AppImage --key-file /absolute/path/outside/repository/deepseek-api-key`：实跑当前包（Linux 使用 `APPIMAGE_EXTRACT_AND_RUN=1`），干净/旧队列两场景、原生本地 crashReporter 不上传、SDK 未加载与真实 Chromium netlog 无产品遥测 URL；可选 key 使用包内 Agent 完成一次真实对话及 SQLite 持久化。打包场景不注入 Main spy，旧请求通过正常 preload 测试；原始 netlog 仅在私有目录保留。

E2E 报告与脱敏日志写入忽略的 `.e2e-artifacts/telemetry-*/`，核心基线仍写 UUID 目录。模拟错误通知不代表真实 native crash；组件测试另覆盖 Agent factory、最终 env 清洗和正常/模拟异常退出，专项本身不等于完整 Agent/Tool/MCP 网络证明。未运行 Windows/macOS、系统级安装或包内完整 Skills/MCP 基线，不宣称其他产品网络请求已经关闭。最终范围与本机证据见 `specs/desktop-local-fork/issue2-telemetry.md` 和 `issue2-results.md`。

## Issue #3 账号/订阅执行边界与本地模型设置

- `pnpm exec tsx --test packages/ui/test/productAccount*.test.*`：Root OAuth/刷新/observer 注册 guard、旧登录请求、旧权益缓存/请求、购买 dialog inventory guard，以及外部 Provider 错误和历史模型的本地设置提示。
- `pnpm exec tsx --test packages/desktop/test/productAccountMain.test.mjs`：实际 Main IPC 与深链模块，覆盖旧 OAuth state、支付 callback、renderer-ready、产品外链拒绝及通用 MCP/Provider 页面保留。
- `pnpm --filter @zcode/desktop exec tsx e2e/run-account.mjs`：无需模型凭据，重新构建本地 Agent 与 Desktop，真实启动与正常退出两次；Main 旧 OAuth/支付/浏览器请求绕过、旧 guest popup/navigation 与真实 DOM 产品 webview attach 均拒绝；操作偏好菜单，断言没有产品登录/退出/套餐/升级/产品用量项；UI 添加 DeepSeek 模板，保存本机 fixture endpoint 与非凭据 key；打开本地 workspace，在真实模型菜单切换模型；重启使用过期 token/损坏 profile fixture，确认凭据字节保持、草稿模型选择和模型设置恢复。Main browser spy 只观察执行边界，不启动真实外部浏览器。
- 前缀 `ZCODE_ACCOUNT_E2E_ENV=production` 执行正式身份构建，否则 test；产品能力仍是同源固定值。两种构建均在 Linux 实跑，报告记录构建身份。
- 核心回归仍使用 `e2e:baseline --key-file <仓库外私有文件> --extensions --telemetry`；真实执行本地模型、工具、权限、追加、停止、恢复、用户级/工作区级 Skills 和 stdio/带测试鉴权 HTTP MCP。

结果位于忽略的 `.e2e-artifacts/account-*/`（报告、设置截图、脱敏日志）。账号专项不发送外部模型请求，不替代有凭据的核心回归、真实 MCP OAuth 浏览器闭环或安装包验证；当前运行平台 Linux x64。冷启动仍遵守原本的新任务/工作区语义，不让测试假定自动激活先前本地 workspace。最终证据见 `specs/desktop-local-fork/issue3-results.md`。

## Issue #4 市场/分享执行与保留资源

- `pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/*.test.* packages/services/test/*.test.ts packages/desktop/test/*.test.*`：包含市场服务/管理 Agent admission、实际 CLI bootstrap/adapters 与编译后的 app-server、source archive、分享 HTTP/服务/Host attachment、UI hooks/store 与同源 Desktop 服务装配。计数器断言请求/Agent 命令为零，旧数据保留；本地 manifest/内置播种/管理、离线导入副本、用户/工作区 Skills 和 MCP 配置沿原 owner 工作。
- `pnpm exec tsx packages/ui/test/productMarketplaceSharing.e2e.mjs`：无模型凭据，重建实际 Agent/Main/Host/preload/Renderer。带旧个人来源及 share marker/index/附件首次启动并正常重启；操作 Plugins/Skills/MCP/Subagents/本地模型设置；在 Plugins User 页实际卸载 Browser Use、刷新、正常退出重启，再用独立离线恢复入口恢复，核验 suppression 清除与插件重新出现。注入旧市场 DOM event，通过 Main 原生 share 深链路由投递旧 intent，断言无商店/来源/分享入口、不创建新 share 目录；localhost 市场 fixture 与 Renderer share 请求为零，旧源声明和分享文件保持，两次退出 0。
- 前缀 `ZCODE_MARKET_SHARE_E2E_ENV=production` 执行正式身份，否则 test。此专项观察本机 fixture/Renderer 请求，不冒充全进程全流量抓包或完整模型/Skills/MCP 执行；真实核心回归仍执行 `e2e:baseline --key-file <仓库外私有文件> --extensions --telemetry`。

专项报告、build hash、截图与脱敏日志位于忽略的 `.e2e-artifacts/market-share-ui-*/`；临时数据只包含测试 fixture，不使用真实账号。当前实测 Linux x64；本 Issue 未验证安装包、Windows/macOS 或真实 MCP OAuth 浏览器授权，完整结果见 `specs/desktop-local-fork/issue4-results.md`。

## Issue #5 远程执行边界专项

- `pnpm exec tsx --test packages/desktop/test/remoteProductGuards.test.mjs packages/desktop/test/localHostAttachmentProductBoundary.test.ts packages/services/test/remoteProductBoundary.test.ts`：实际 Main IPC/manager 的发现、连接、旧绑定与 Bot 路由 guard；旧 Bot 设置/凭据/parentPort 副作用为零、本地候选保留；两个本地窗口 attachment registry 生命周期隔离、远程/replay 拒绝；Desktop V4 scope 不把旧 remote identity 降为同路径本地请求，其他产品未传能力时保留 replay 协议。
- `pnpm --filter @zcode/desktop exec tsx e2e/run-remote-backend.mjs`：无模型凭据，重建实际 Agent/Main/Host/preload/Renderer，使用合法旧 SSH/WSL/Docker 历史且共享同一本地路径的隔离配置启动、退出、重启。真实 preload 和绕过 preload 的 Main 请求拒绝连接，发现为空；Main 不发送远程 Host 创建消息；绕过 Main 的 Host 请求返回原失败响应、关闭本地 replay/远程 attachment 端口，旧 history 的 identity 保留。另经真实本地 attachment 发送 Agent/Task 的序列化 EventListen（远端 identity、空白 identity、旧 remoteSessionId），仅关闭 4 个 offending port；另在同一正常 attachment 上发送 4 个 Task Promise 请求（snapshot 的远端/空白 identity、旧 remoteSessionId，以及带 MCP 的远端 resume），均明确拒绝但不关闭端口；随后本地 Task 列表与 Agent RPC 返回成功，两次正常退出 0。未知旧 pairing fixture 只证明数据未改写：当前检出没有手机配对/relay owner，不冒充真实配对服务测试。

- `pnpm exec tsx packages/ui/test/productRemoteWorkspace.e2e.mjs`：无模型凭据，重新构建并实跑旧 SSH/WSL/Docker 同路径历史启动/重启；工作区菜单保留三条不可用历史，无远端向导或手机远控包装；实际打开独立 Bots 配置，并通过原平台目录选择器显式打开本地目录。远端历史原对象不改写，不自动转为本地。
- backend 命令前缀 `ZCODE_REMOTE_E2E_ENV=production`、UI 命令前缀 `ZCODE_REMOTE_UI_E2E_ENV=production` 验证正式身份，默认 test/Preview。
- `pnpm exec tsx --test packages/desktop/test/remoteProductAssembly.test.ts`：使用实际 Desktop owner 与公开服务装配，远端 Bot 候选/绑定拒绝、连续 facade 本地握手可用、旧 remote identity/session 与手机 facade 拒绝，Agent command resolver 为零。另用真实 ChannelServer/EventListen 覆盖 Agent/Task 远端订阅拒绝、另一端口事件/请求存活，resolver/spawn 为零；`remoteEventAdmission.test.ts` 验证默认/未知异常不吞，`taskEventAdmissionCleanup.test.ts` 验证重复上游注册失败立即释放本地 listener。`taskProductAdmissionAssembly.test.ts` 经实际公开装配/两个 ChannelServer 验证同 T 的 snapshot 拒绝不污染本地模型/关闭、MCP 准备与 resolver/spawn 为零、typed mixed batch 在 SQL/overlay/cache 变动前拒绝，以及正常本地参数兼容。

报告、build hash 和脱敏日志位于忽略的 `.e2e-artifacts/remote-backend-*/` 与 `remote-ui-*/`。这些专项不验证全部网络流量、同时打开两个 GUI 窗口或真实模型/Skills/MCP 执行；两窗口所有者使用组件测试。真实核心回归仍走已有 `e2e:baseline --key-file <仓库外私有文件> --extensions --telemetry`；安装包、Windows/macOS 需分别运行。规格与本次真实证据见 `specs/desktop-local-fork/issue5-remote.md` 和 `issue5-results.md`。
