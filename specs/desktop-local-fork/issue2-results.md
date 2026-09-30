# Issue #2 实施结果

2026-10-01；基于 Issue #1 `dfd3961`，版本 3.14.3。Node 24.14.0、pnpm 10.33.2、Electron 41.0.3，Linux x64。仅本地提交，不推送、不创建 PR、不修改 GitHub Issue。

## 完成范围与 handoff 接口

- 唯一产品事实仍为 Desktop 冻结配置。Main、Host、preload、Renderer/UI 在 SDK、采集、订阅、队列、exporter 与定时器之前裁决；旧 IPC、遥测桥、batch 与环境不能绕过。Main 不导入有构造副作用的 ARMS SDK，不创建 TelemetryCore、OTLP owner 或退出上传任务；本地 logger、内存诊断、crash archive 保留，原生 crashReporter 不上传。
- Host 唯一 `createLocalServices` 调用传入 `DESKTOP_PRODUCT_CAPABILITIES` 原对象。services 公开只读 `productCapabilities?: Readonly<Pick<ProductCapabilities, "telemetry">>` 接口沿原 Agent 启动适配消费，不维护第二份固定事实。最终 env 合并后清洗产品配置；保留 Provider、broker、网络代理、CA、workspace identity 和用户显式 MCP/shell 配置。
- Fork CLI（含不另发行的 standalone 源码入口）bootstrap、模型/run trace、exporter factory 与退出接口均无产品遥测启用路径；Bash/MCP 不构造资源探针或产品采集 timer。MCP 本地进程列表及连接/owner 生命周期、CLI 本地内存日志与 resident/event/publisher 维护保留。旧 TTFT envelope 不注册旁路 observer/clock，不改变业务 admission。
- integration 审计补闭 scheduler utility process 的采集注册口：Main 丢弃样本不足以关闭它；现于 sampler/timer 前执行同源 guard，正常 cron 派发、logger、业务 polling 保留。Host/scheduler tsconfig 明确包含纯产品配置，实际 tsup `out/host/index.js`、`out/scheduler/index.js` 入口不变。
- 未改协议、会话状态 owner、CommandInbox、owner/lease、identity key、stale run 或 stream/replay 契约。账号、订阅、市场、分享、relay、远程等其他产品能力仍待后续 Issue，不宣称停止全部产品联网。

## 实际验证

| 验证                         | 结果与证据                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 关闭能力单测                 | 27 项通过：Desktop guard 10、Host 装配 1、UI 3、services env 2、CLI 11；另 Issue #1 更新回归 4 项通过。Host 接线与 scheduler 新测试均先在缺失实现上失败，再通过                                                                                                                                                                                                                       |
| Desktop 关闭 E2E             | production/test × 干净/旧队列 4 场景通过；实际重建/启动 Main、Host、preload、Renderer，旧上报与绕过 Main 调用、模拟错误通知、退出码 0。SDK 未加载，产品遥测/显式 OTLP 陷阱请求 0，已有 identity/队列/数据量状态字节不变。报告：`packages/desktop/.e2e-artifacts/telemetry-1790790755409/report.json`                                                                                  |
| 真实核心 + Skills/MCP + 遥测 | 最终源码重新构建后 15 阶段全部通过。真实本地 Provider 对话、Bash 文件读写、权限拒绝/允许、busy 追加、停止、同目录重启恢复；用户级/工作区级 Skill、stdio MCP 与带鉴权 HTTP MCP 均实际调用。显式遥测环境贯穿运行/退出，OTLP 陷阱 0；缺 deviceMid 的旧 state 仅补共享身份，旧队列/其他字段不变。报告：`packages/desktop/.e2e-artifacts/cae0e070-d8e9-46f8-976c-70421ff817cc/report.json` |
| 当前 AppImage 实跑           | 最终 scheduler 修复后重建 production 包并实际启动，`app.isPackaged=true`。干净/旧队列 2 场景通过，SDK 缺席、crashReporter 不上传、旧文件字节保留、OTLP 陷阱 0；Chromium netlog 分别有 784/1843 事件且无产品遥测 URL。包内 Agent 完成一次真实 DeepSeek 对话，SQLite 1 条 promoted 输入及精确回复各仅一次。报告：`packages/desktop/.e2e-artifacts/telemetry-1790791193824/report.json`  |
| 必需静态检查                 | `pnpm typecheck` 通过；`pnpm lint` 0 errors/70 条已有 warnings；`pnpm architecture:check --changed` 0 violations/0 baseline/0 new；全部变更格式检查与 `git diff --check` 通过                                                                                                                                                                                                         |
| CLI 独立检查/构建            | `PATH=<固定 Node>:<根 node_modules/.bin>:$PATH pnpm --dir apps/zcode-cli typecheck` 27/27 tasks、`build` 16/16 tasks 通过；依赖产物由实际 Desktop E2E 构建链重新编译并同源暂存。Turbo 缓存不等同干净依赖安装；嵌套 lockfile closure/output warnings 保留                                                                                                                              |

核心 SQLite：9 条唯一已接受输入、串行 promotion、1 条运行中追加；工具输出恢复，停止无迟到完成，权限拒绝/停止的工具 error 为预期。扩展独立会话中两个 Skill 与两个 MCP 工具完成，stdio/HTTP 各执行一次。HTTP 使用测试鉴权头，不等同真实外部 MCP OAuth 登录。

复现入口见 [Desktop E2E README](../../packages/desktop/e2e/README.md)：

```sh
pnpm --filter @zcode/desktop exec tsx --test test/telemetryGuards.test.mjs test/hostProductCapabilities.test.mjs
pnpm exec tsx --test packages/services/test/agentTelemetryEnv.test.ts packages/ui/test/productTelemetry.test.mjs packages/ui/test/productUpdateVisibility.test.ts
pnpm --dir apps/zcode-cli exec node --test test/productTelemetry.test.mjs
pnpm --filter @zcode/desktop exec tsx e2e/run-telemetry.mjs
pnpm --filter @zcode/desktop e2e:baseline --key-file <仓库外私有文件> --extensions --telemetry
```

本机 AppImage：`packages/desktop/.e2e-artifacts/issue2-package/ZCode-3.14.3-linux-x86_64.AppImage`，190,675,751 字节；SHA-256 `a47815dae346ede412b3f43141f541087982d4153fb3a7f6d33f51df38328dfc`。先由 E2E 重建/暂存 Agent 与必要本机资源，再 `ZCODE_ENV=production pnpm --filter @zcode/desktop build:no-runtime-assets`，从 desktop 执行现有 electron-builder（`--linux AppImage --x64 --publish never`、本机 Electron 41.0.3、独立输出目录）；Linux 用 `APPIMAGE_EXTRACT_AND_RUN=1` 启动遥测专项。未全新安装锁文件依赖，未做系统级安装或签名，不宣称干净系统构建。

## 新旧失败与边界澄清

- 首次本轮核心试跑在 startup 失败：系统中文引导与既有英文 `Skip` 选择器不匹配；未到凭据/核心阶段。测试私有目录现固定英文 locale，未改产品 UI、未添加超时。
- 第二次核心试跑此前 14 个核心/扩展阶段通过，但整个测试在最终旧 state 字节断言失败，不能记为整轮通过。Main 既有共享 `ensureDesktopDeviceMidSync` 为缺身份的文件补 UUID；它也供 help/context/native/反馈非遥测消费者。经批准不迁移 identity owner；验收拆成已有合法身份的字节保持与缺身份仅补 deviceMid 两类，队列/其他字段保持，无恢复/上传。修正规格/断言后重新执行，并在最终 scheduler 修复后再次全链通过。
- 本轮新增 E2E 曾造成 root max-lines 失败；已把陷阱 owner 抽到源命名 fixture、共享英文 locale 准备函数并收敛报告范围字段，最终 root lint 0 errors/70 warnings。新增的 Host 接线/scheduler red-phase 失败是预期测试证据，不是最终未修 bug。
- 额外完整 `pnpm exec tsc -b packages/desktop` 仍失败（216 条诊断）。Main/preload/renderer `tsc --noEmit` 亦失败，当前 Desktop 源码诊断分别 87/3/125，与 Issue #1 报告数量相同；本轮 archive 隔离比较因 symlink/reference 源码回退产生额外环境诊断，不用于声称完整基线相等。scheduler 独立检查仍有 `src/scheduler/index.ts:252 TS2322`：HEAD `dfd3961` 的隔离源码同样产生该错误，文件未改。scheduler 同源导入最初新增 TS6059/TS6307 已用批准的最小 tsconfig 修复。根 typecheck 不覆盖 Main/preload/renderer/scheduler，不能把根通过写成完整 Desktop tsc 通过。
- Agent 组件执行的完整 CLI lint 失败，含未变更 model-api-recorder/agent-trace-runtime 及其他大文件；未做完整 CLI lint 基线对比，不标为通过。组件对 10 个受影响 CLI/test 文件的显式 root oxlint 是 0 warnings/errors；integration 重新运行必需 CLI typecheck/build，未扩展修复无关 lint。

## 剩余风险与后续

未实际运行 Windows/macOS、真实 native crash、外部 MCP OAuth、跨 Host/远程 identity/手机恢复链路；相关业务语义未修改。AppImage 仅一次模型对话，完整核心/Skills/MCP 在未打包 Desktop 上验证。网络证据覆盖已识别产品遥测与显式 OTLP 陷阱，不等于所有进程全流量抓包；disabled factory、SDK/订阅/timer 单测提供其初始化证据。

遥测依赖物理删除、tracked shared ARMS JS/d.ts/map 生成副本与构建闭包清理留 Issue #7；Desktop 专用构建收敛留 Issue #6。下一阶段 #3 继续消费同源公开能力，关闭账号/订阅，不移本地 Provider/凭据、Skills/MCP 或 Agent 状态。

真实 key 保持仓库外权限 600；UI 填 key 阶段不截图。测试原始配置/数据库/netlog仅保留私有临时目录，报告/日志脱敏，测试数据与包均忽略不提交。未删除真实用户数据。

## Fresh review 修复结果

基于被审查提交 `9a890a8` 的窄修复，仍只 amend Issue #2 的最后提交；不修改更早历史、不推送、不操作 GitHub。

### 已解决 / 无效 / 剩余

- **已解决 P1 环境配置漏传**：源码确认统一识别器未覆盖 ARMS endpoint 和 Renderer action trace 开关；补两项精确产品键（大小写不敏感），同一识别器继续供最终 Agent 清洗、runtime、Tool/MCP 和 passthrough 使用。red-phase 真实 Agent 最终环境仍残留四个大小写 fixture 键、CLI 分类返回 false；green-phase 不再残留。Provider 凭据、broker、identity、代理及显式 shell overlay/MCP server env 的原合并规则保留。这里修复的是配置泄漏，不声称曾观察到上传。
- **已解决 P1 输入性能仍采集**：源码确认 `TextContentPlugin` 原先无条件注册 composition 旁路监听和读取计时时钟。插件现在读取现有平台能力视图，禁用先于 listener/clock/sample 构造；markdown、首字符及后续 `onChange` 保持。源插件测试使用 AST 提取真实内部函数、实际 Lexical editor/EditorState/序列化，仅隔离 React hooks/DOM/采集端口，不新增产品导出。red-phase 禁用仍注册 root listener；green-phase 禁用 listener/clock/sample 均为零，启用路径两次输入读取 4 次时钟并采样 2 次，监听卸载回收、相同 markdown 不重复回传。
- **无效 finding：无**。两项均有源码和实际 red-phase 证据，不以出口无请求否定采集漏洞。
- **剩余**：本次未重跑凭据核心/Skills/MCP 和发行 AppImage；上文的报告只代表原审查提交，不作为本次修复后包的证据。完整 Desktop tsc、完整 CLI lint 原失败及其他平台/真实 crash/OAuth/全进程抓包风险仍保留；本次不扩修。

### 改动与 handoff

生产代码仅 `packages/shared/src/runtimeEnv.ts`、`packages/ui/src/LexicalChatInput.tsx`。测试更新 `apps/zcode-cli/test/productTelemetry.test.mjs`、`packages/services/test/agentTelemetryEnv.test.ts`；新增 `packages/ui/test/LexicalChatInputTelemetry.test.mjs`、`packages/desktop/e2e/lexical-input-telemetry.mjs` 并接入 `packages/desktop/e2e/run-telemetry.mjs`。文档更新本 results 与 `issue2-telemetry.md`。

handoff 接口不变：Desktop 仍唯一固定能力 owner，UI 只读平台视图，services/shared/CLI 复用公开入口；未改 Agent 协议或移状态。desktop/ui/shared/services/zcode-cli context 均 managed:false、module.ts 缺失且无直接依赖契约（CLI 发现既有 tools contract）；不更新 baseline。无新增业务状态、超时或 owner/lease/identity/CommandInbox/replay 修改。

### 本次实际执行

| 命令 / 检查 | 结果 |
| --- | --- |
| `node scripts/check-workspace-freshness.mjs` | main 基线新鲜；开工 HEAD 为 `9a890a8`，无本地未提交变更 |
| `pnpm exec tsx --test packages/services/test/agentTelemetryEnv.test.ts packages/ui/test/LexicalChatInputTelemetry.test.mjs packages/ui/test/productTelemetry.test.mjs packages/ui/test/productUpdateVisibility.test.ts` | 8/8 通过；包含新增源插件 2 项。环境及插件新增测试先在原实现失败；首次插件测试构建缺 PNG loader 的 harness 问题已修正后重跑得到真实 red-phase |
| `pnpm --dir apps/zcode-cli exec node --test test/productTelemetry.test.mjs` | 11/11 通过；真实 Tool/MCP env、runtime sanitizer、passthrough、正常/模拟异常子进程退出回归 |
| `pnpm --filter @zcode/desktop exec tsx --test test/telemetryGuards.test.mjs test/hostProductCapabilities.test.mjs` | 11/11 通过 |
| `pnpm --filter @zcode/desktop exec tsx e2e/run-telemetry.mjs` | 重建当前 Agent 与 Desktop 后 production/test × clean/legacy 共 4 场景通过。新增实际输入首字符/后续/清空序列化断言通过；SDK/缓冲缺席、产品与显式 OTLP 请求 0、旧状态字节保持、正常退出 0。报告 `packages/desktop/.e2e-artifacts/telemetry-1790793408844/report.json`；不含模型请求或打包验证 |
| `pnpm typecheck` / `pnpm lint` | 通过；lint 0 errors / 70 warnings（修复前报告也是 70）。root typecheck 覆盖范围仍以实际 package.json 为准 |
| `pnpm architecture:check --changed` | 多次执行，最终 0 violations / 0 baseline / 0 new |
| `pnpm fmt:check` | **失败**：31 个未修改文件有格式问题，含 README、cronBotDelivery、bots 及相关 UI；不恢复/格式化无关文件，不把根格式写成通过 |
| `pnpm exec oxfmt --check <本次根代码与测试文件>` / `pnpm --dir apps/zcode-cli exec oxfmt --check test/productTelemetry.test.mjs` / `git diff --check` | 通过；新增测试/fixture 初次格式检查失败后仅格式化这两文件，重新检查和重跑测试；根格式配置排除 CLI，已另跑 CLI formatter |
| `pnpm --dir apps/zcode-cli typecheck` / `build` | 27/27 和 16/16 tasks 通过；typecheck 全 Turbo cache 命中，build 15 cached/1 executed。E2E 另执行实际 Agent bundle 构建，缓存不等同干净依赖安装 |

原始本轮脱敏验证日志位于托管 artifact `issue2/fix-{red-root,red-ui,red-cli,green-root,green-cli,green-desktop,e2e,typecheck,lint,architecture,format,format-root,cli-typecheck,cli-build,cli-format}.log`；未提交测试缓存/运行数据。最终验收报告记录 amend 后 SHA 和无 staged files。后续 #3 继续消费现有能力接口，#6/#7 构建/依赖收敛边界不变。
