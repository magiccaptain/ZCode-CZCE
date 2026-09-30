# Issue #4 实施结果

2026-10-01；基于 Issue #3 `fc61610`，Node 24.14.0 / pnpm 10.33.2 / Electron 41.0.3，Linux x64。全部串行组件与集成变更纳入一个本地提交 `feat(desktop): disable marketplace and sharing (#4)`；不推送、不创建 PR、不修改 GitHub Issue。

## 完成范围 / checklist

- Desktop `DESKTOP_PRODUCT_CAPABILITIES` 继续唯一拥有固定能力；Host 本地与旧远端服务装配、服务/HTTP、最终 Agent spawn 和 UI 读取同源只读视图。不新增产品状态 owner 或数据迁移；fresh review 后经批准仅扩展 plugins/list 可选离线 inventory 返回字段（见下文）。
- 官方/个人市场浏览、详情、来源管理、自动/手动刷新、下载、检查更新、安装/更新、推荐引用及 source archive 导入/导出均在实际 admission/执行前拒绝。legacy IPluginsService、IPluginManagementService、直接 IZCodeAgentService 与实际 CLI bootstrap/protocol/adapters 全部覆盖，拒绝发生在 command resolution、Git/HTTP、临时目录/安装之前。锁后旧任务仍检查；取消原任务允许，不新增持久化队列。
- 最终 Agent env 合并后注入产品市场能力，不能被 inherited/spawn/command 的 true 覆盖；CLI 启动时捕获只读派生事实，运行中 env/config 不能重新开启。非 Desktop 未传装配事实的独立 CLI 保持原默认语义。
- 保留 manifest、本地 installed loader、必要内置播种、已安装配置/reset/启停/卸载/内置恢复及引用 catalog；市场 source archive 禁用不一刀切删除已安装 inline/archive 同步。RemotePluginSyncDialog 禁用下不请求 overview，旧市场行/source preparation 拒绝；完整远程关闭仍归 #5。
- 分享 capabilities/preflight/publish、权限/链接、prepare/upload/confirm、preview/continuation/import 与连接 facade/Host attachment 均拒绝，错误沿既有 `kind=feature_disabled`；不读产品 token、不下载/上传/创建会话。禁用启动不恢复导入索引或执行 abandoned cleanup；本地已导入 rows/附件仍可离线读取，旧 marker/index/数据字节保留。
- UI 无商店、来源、推荐/更新与分享入口；旧 DOM event、pending target、分享选择/attempt/深链不 admission。PluginStorePage 在 effect-bearing child 挂载前拒绝，PluginManagementStore 禁用下直接 listPlugins 而非 overview 失败再 fallback；同步清除仅派生市场缓存，保留 config scope、workspace identity、in-flight 和 stale-result 语义。Plugins/Skills/MCP/Subagent/本地模型设置独立可达；普通 prompt、复制/文件阅读及会话内容不改。
- 保留 CommandInbox、owner/lease、workspace identity、stale run、desktop-continuous/web-remote-replayable、会话恢复、本地 Provider/API key、用户/工作区 Skills、stdio/HTTP MCP 与必要 OAuth。没有禁止正常 Agent shell/网络/浏览器，没有清空旧数据或添加同步 timeout。

## 首次集成实际执行验证（fresh review 修复前）

| 检查                             | 结果与证据                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| freshness / architecture context | 开工 freshness 通过，main ahead 3 / behind 0。desktop/services/shared/ui/zcode-cli context 均 legacy/unmanaged、owner unassigned、module.ts missing，无直接受管依赖契约；读取现有公开契约。最终 architecture 0 violations / 0 baseline / 0 new，不新增基线例外                                                                                                                                       |
| 全量相关单测                     | `pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/*.test.* packages/services/test/*.test.ts packages/desktop/test/*.test.*`：82/82 通过。本 Issue 新增 22 项单测：市场 5、分享 5、UI 11、集成装配 1；另新增/扩展真实 Electron 专项                                                                                                                                         |
| 市场执行证据                     | 实际编译 CLI app-server 正常启动/退出；三重 env true 被产品 false 覆盖；旧来源保持，本地 list/catalog/内置卸载恢复可用。实际 HTTP fixture 请求 0、fake Git marker 缺席、排队安装拒绝且缓存字节不变。用户/工作区 Skills、本地插件配置及 stdio/HTTP MCP 配置回归通过                                                                                                                                   |
| 分享执行证据                     | 七类直接 HTTP 请求（含有效及损坏 upload/confirm）在鉴权/解析/网络前拒绝，token 与 HTTP 计数均 0；直达/连接 service 的 Agent/artifact/session/download 计数 0。Host 两种 clientMode/就绪与未就绪连接拒绝；原本地 rows/附件仍可读，旧索引/marker 不删除                                                                                                                                                |
| 同源装配集成                     | 新 `packages/desktop/test/marketplaceSharingAssembly.test.ts` 使用真正 Desktop owner 与公开 createLocalServices，注册的 management/Agent/legacy/source-sync/分享及 attachment 请求全部明确不可用，Agent command resolution 为 0；普通 config catalog 允许原请求，不宣称整个产品断网                                                                                                                  |
| Desktop 关闭专项                 | test 与 production 均实际重建 Agent/Main/Host/preload/Renderer；带旧市场源及 share marker/index/附件首次启动、同目录重启，五个本地设置页可达，无商店/来源/分享入口。旧市场 DOM event 无跳转；Main 原生旧 share 深链实际投递后不创建新 share 目录。localhost 市场 fixture 与 Renderer share 请求 0；旧源声明和 share 文件字节保持。每种身份两次正常退出 0，各 12 条 case 通过                         |
| 真实核心 / Skills / MCP          | `pnpm --filter @zcode/desktop e2e:baseline --key-file <仓库外私有文件> --extensions --telemetry`：15 阶段（含 build）全部通过。真实模型对话、Bash 文件读写、权限拒绝/允许、busy 追加、停止、重启恢复；两个 Skill 真正加载，stdio/带 fixture 鉴权头 HTTP MCP 各调用 1 次。SQLite 9 条唯一已接受输入、串行 promotion、1 条 queued，停止无迟到完成。显式 OTLP 陷阱 0、旧遥测字段保持、Renderer SDK 缺席 |
| 根 typecheck / lint              | `pnpm typecheck` 通过；`pnpm lint` 0 errors / 70 个已有 warnings。根 typecheck 不包含所有 Main/preload/renderer，也不替代 CLI 独立检查                                                                                                                                                                                                                                                               |
| CLI 独立 build / typecheck       | 将根 node_modules/.bin 加入固定 Node PATH 后，`pnpm --dir apps/zcode-cli build` 16/16 tasks 通过（12 cached）；`typecheck` 27/27 tasks 通过（23 cached）。E2E 另实际重建并同源暂存当前 Agent；不宣称全新依赖安装                                                                                                                                                                                     |
| 变更格式 / diff                  | 本 Issue 全部 66 个 tracked/untracked 变更文件分别用根与 CLI oxfmt --check 通过，`git diff --check` 通过。单个提交后无 staged 文件及 tracked/untracked 变更（忽略运行产物）                                                                                                                                                                                                                          |
| 额外 Desktop tsc                 | Main/preload/renderer `tsc --noEmit` 仍失败，87/3/125 条诊断，与 #1–#3 已记录数量一致；没有用根 typecheck 将它们写成通过。本轮没有隔离 worktree 全基线复验，数量相同不等于逐项证明无新增诊断                                                                                                                                                                                                         |
| 根全仓格式                       | `pnpm fmt:check` 失败：32 个本轮未改动文件，与 Issue #3 记录一致；不扩修无关 README/Bot/会话/UI/Issue #2 results 格式                                                                                                                                                                                                                                                                                |

最终专项报告：`packages/desktop/.e2e-artifacts/market-share-ui-1790807302494/report.json`（test）与 `market-share-ui-1790807358713/report.json`（production）。真实核心报告：`packages/desktop/.e2e-artifacts/22749735-10a3-4268-bcd7-5092fe4b6a55/report.json`。报告包含 build hash、阶段/退出证据；忽略的缓存、截图、脱敏日志不提交。托管 artifact 中 `integration-*.log` 保留实际命令输出，组件 handoff 保存各自 red/green 和旧基线对比证据。

## 新旧失败与未验证范围

- 市场/分享/UI 组件先 spec/test 后实现，真实 red 包含市场 fetch/CDN write、分享 HTTP/旧 attachment 执行、overview/fallback/旧 cache、分享请求 ID admission；修复后均通过，详见串行组件记录。集成没有重写组件或发现需要扩展产品决定的新 bug。
- results 最后补充 CLI lint 结果与文件数后，单文件格式检查出现失败；补正格式并复查全部 66 个提交文件，仅 amend 当前 Issue #4 提交，不创建额外提交或修改前一个 Issue。
- 新装配测试第一稿提前 teardown，Provider owner 异步初始化尚未完成，导致 ENOTEMPTY 测试清理失败及 disposed 诊断；改为等待原 IModelSelectionService.getView 初始化，再执行/释放。最终测试通过；没有加超时/重试或改生产 lifecycle。
- CLI 组件最初根 turbo 命令因 PATH 找不到 turbo 失败；集成使用根安装的真实 turbo 后 build/typecheck 通过，不虚报最初失败。集成再次实际执行 CLI adapters/bootstrap 独立 lint，仍因已有 max-lines 失败：25 errors/18 warnings 与 20 errors/22 warnings；组件已对 HEAD artifact 与当前源分别核验相同计数，根 lint 不替代这些旧失败。
- E2E 构建仍有既有 chunk-size/plugin-timing 警告；退出日志可能保留既有 SQLite transport_closed/source teardown 诊断，正常退出与持久化断言通过，不声称所有日志无错误。
- 专项网络证据是本机市场 fixture、Renderer share 与服务执行计数器，不是全进程全流量抓包。正常 Provider/HTTP MCP/Agent 网络、通用 catalog/workflow 仍允许；不能宣称整个产品断网。
- 本 Issue 未运行 Windows/macOS、安装包/系统安装/签名、真实 MCP OAuth 浏览器授权、跨 Host/手机恢复回归；通用契约与相关状态未修改。HTTP MCP 使用本机 fixture 鉴权头，不冒充真实 OAuth。发行链与无调用源码删除分别留 #6/#7。
- 私有 key 只由既有 runner 读取，不打印、不截图配置阶段；凭据与数据库留仓库外权限受限测试目录。没有读取/提交真实用户数据或内部地址，不删除旧数据。

## Handoff

- `@zcode/shared` 公开 `PLUGIN_MARKETPLACE_UNAVAILABLE` / `PLUGIN_MARKETPLACE_CAPABILITY_ENV`，services node 公开只读 `PluginMarketplaceCapabilities`；最终 spawn 同源标识由 Desktop 组装控制。既有 plugins/list 新增可选 restorableBuiltins 字段，严格 schema 兼容旧 response 缺席；不新增写命令。
- `@zcode/services` 公开 `CONVERSATION_SHARING_UNAVAILABLE`；Unsupported share facade 可委托既有本地 reader，保留原 `kind=feature_disabled`/RPC details。
- UI store initialize 接受 Platform 的 readonly productCapabilities，禁用投影 list-only，不把旧源当已删除。不增加另一份可变配置。
- #5 继续处理完整远程/远控执行链，保留本地 Host 路由与身份隔离；#6/#7 按引用/构建闭包收敛，不删除 Skills/MCP/本地 plugin loader 或普通网络/浏览器能力。

## Fresh review 修复与重新验证

2026-10-01；仅 amend 当前 Issue #4 最后提交，不修改 #1–#3 历史；未推送、未创建 PR、未操作 GitHub issue。两条 finding **已解决**，没有无效 finding 或剩余源码 blocker：

1. **远端 attachment 市场旁路有效并已修复**：原 remoteWorkspaceServiceCollection 直接注册 raw Agent/management/source-sync/legacy，远端默认允许。现 Desktop 装配在 RPC dispatch 前同源拒绝，管理复用原薄服务和 guarded Agent；两个 clientMode 的 connection facade 均不能绕过。connect 白名单传既有标识，Host 显式以固定 owner 覆盖 inherited true，stdio 派生 readonly partial 能力进入 createLocalServices 与原最终 spawn 覆盖。旧 server 不认识标识仍由 Desktop fail closed。没有提前关闭 SSH/WSL/Docker，没有复制固定事实、移动路由或状态 owner。
2. **内置卸载后无离线恢复入口有效并已修复**：原 UI list-only projection 无 suppression inventory 且唯一 restore 页面被禁用。经批准 plugins/list 增加可选 restorableBuiltins 严格返回字段；计算复用原 CLI suppression/bundled definitions owner，旧 response absent 视为空，不 fallback overview。Plugins User 本地页独立恢复列表调用原 restoreBuiltinPlugin 命令；workspace scope 不提供 package 恢复。保持 CUA feature gate、锁、suppression 持久化与原错误处理，不自动重新播种、不重新开放市场。

先更新 spec，补测试并观察 red：远端装配 Missing expected rejection、白名单过滤掉关闭标识；真实 CLI 卸载后 list 无 inventory；schema 拒绝新增字段；UI store 清空 inventory；实际 Electron 卸载后恢复按钮不可见。随后实现并重跑，测试夹具首次有公开入口 import 和 lifecycle disposable 形状错误，已修正测试；schema 初始化顺序错误已修复，不把这些中间失败写成通过。根 typecheck 首次发现装配接口强制 telemetry/sharing 字段；经批准只将 service-assembly subset 与其消费 options 改为 readonly partial，canonical ProductCapabilities 和 Desktop 完整冻结配置不变，不在 server 伪造其他能力。

| 重新执行                           | 真实结果                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| freshness / contexts               | 开工 freshness 通过，main ahead 4 / behind 0；desktop/ui/services/server/shared/zcode-cli 均 legacy/unmanaged、无受管 CONTRACT。读取公开服务/协议契约，无新增基线例外                                                                                                                                                      |
| 受影响与核心单测                   | 原实际入口全量 UI/services/desktop **87/87** 通过；新增远端装配/stdio/非 Desktop 兼容 3 测试、list schema 1、离线 store restore 1，并扩展真实 managed CLI uninstall/list/restore 测试。远端底层市场/source 方法调用 0，非市场 list/restore/installed archive 保留 identity；stdio 禁用命令解析 0，未传标识维持原 admission |
| test 身份 Desktop E2E              | `pnpm exec tsx packages/ui/test/productMarketplaceSharing.e2e.mjs` 重新构建实际 Agent/Main/Host/preload/Renderer，**14 场景通过**，两次正常退出 0；真实卸载→刷新→重启→离线恢复，suppression 存在→清除、插件消失→重新出现；市场 fixture 请求 0、share 0、旧数据保留                                                         |
| production 身份 Desktop E2E        | `ZCODE_MARKET_SHARE_E2E_ENV=production pnpm exec tsx packages/ui/test/productMarketplaceSharing.e2e.mjs` 同上 **14 场景通过**，两次退出 0，市场 0                                                                                                                                                                          |
| 根 typecheck / lint / architecture | 最终 `pnpm typecheck` 通过；`pnpm lint` **0 errors / 70 warnings**；`pnpm architecture:check --changed` **0 violations / baseline / new**                                                                                                                                                                                  |
| CLI build / typecheck              | 固定 Node 并加入根 node_modules/.bin，`pnpm --dir apps/zcode-cli build` **16/16**，`typecheck` **27/27** 通过；专项另外同源重建当前 Agent                                                                                                                                                                                  |
| Desktop 额外 tsc                   | Main/preload/renderer 仍失败 **87/3/125** 条诊断，与前次记录相同；没有基线 worktree 逐条复验，不宣称这三项通过                                                                                                                                                                                                             |
| CLI 局部 lint                      | bootstrap **20 errors / 22 warnings**、adapters **25 errors / 18 warnings** 仍失败，与前次记录相同，主要已有 max-lines；本轮没有扩修无关巨文件，根 lint 不替代它们                                                                                                                                                         |
| 格式 / diff                        | 全仓 `pnpm fmt:check` 仍失败 **32 个未改动文件**；修复相关文件根/CLI oxfmt --check、git diff --check 通过。只 amend 当前 #4；提交后 no staged files                                                                                                                                                                        |

专项新报告：`packages/desktop/.e2e-artifacts/market-share-ui-1790808676548/report.json`（test）、`market-share-ui-1790808998296/report.json`（production）。托管 artifact 的 `fix-*.log` 保存 red/green/静态检查真实输出；不提交截图、构建产物或测试临时数据。

Handoff：新增的只读 list inventory 属于既有 CLI suppression owner；可选字段 absent 不能开启 overview。services node 公开原 buildPluginMarketplaceSpawnEnv 派生函数，Host/远端使用同源标识，不新增固定配置。#5 接手完整远端/远控关闭。本次 fresh 修复没有重跑有凭据真实模型全基线，其前次证据保留但不冒充本次重新执行；没有现场 SSH/WSL/Docker 连真实远端（执行服务装配与两种 facade 已实跑）、Windows/macOS、安装包或真实 MCP OAuth。正常 Provider/MCP/shell/浏览器网络继续允许；fixture 0 不等于全进程流量抓包。

## 第二次 fresh review：离线恢复 CDN 请求修复

审查 `0a6641f` 的新增 P1 **有效且已解决**：恢复行完整 listing 经 PluginStoreAvatar 回退 HTTPS；Browser Use 没有客户端图标映射，渲染即请求官方市场 CDN。先补规格与 Electron 断言，源码未修时实际 red 为 `offline restore must not request marketplace CDN: 2 !== 0`，不是仅根据搜索推断。最小实现把该行改为既有 `PluginIcon`，仅传 `pluginId`，复用客户端 bundled 图标或本地 Blocks。此列表仅在市场禁用的 User scope 出现；显示名、suppression owner、恢复命令、list-only 刷新、通用商店图标及正常 Agent 浏览器/网络均未改。无无效 finding，无已知剩余源码 blocker。

变更文件：`packages/ui/src/settings/PluginsSection.tsx`、`packages/ui/test/productMarketplaceSharing.e2e.mjs`、本结果与 `issue4-marketplace-sharing.md`。继续只 amend 当前最后 Issue #4 提交，不生成额外提交，不改更早历史，不推送或操作 GitHub。

| 本轮实际执行                     | 结果                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| freshness / architecture context | main ahead 4 / behind 0，新鲜；UI legacy/unmanaged、owner unassigned、无 module.ts / 直接受管依赖契约。阅读既有组件/图标与协议类型；修改前及修改后 architecture 均 0 violations / baseline / new        |
| 先测试 red                       | `pnpm exec tsx packages/ui/test/productMarketplaceSharing.e2e.mjs` 真实重建启动，在 Browser Use 卸载后发现 2 次官方市场 CDN 请求，退出 1；新增拦截防真实下载，但每次请求仍计失败                        |
| test 身份专项 green              | 同命令重新构建，14 场景通过、两次正常退出 0。卸载→刷新→重启→恢复保持原 suppression 生命周期，恢复行无 HTTP(S) img；两个生命周期 Renderer 市场 CDN 各 0，市场 fixture/share 0，旧数据保持                |
| production 身份专项 green        | `ZCODE_MARKET_SHARE_E2E_ENV=production pnpm exec tsx packages/ui/test/productMarketplaceSharing.e2e.mjs` 同上 14 场景通过、两次退出 0、CDN 两阶段均 0                                                   |
| 全量受影响单测                   | `pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test packages/ui/test/*.test.* packages/services/test/*.test.ts packages/desktop/test/*.test.*`：87/87 通过；本轮扩展真实交互 E2E，不增加重复单测 |
| 根 typecheck / lint              | `pnpm typecheck` 通过；`pnpm lint` 0 errors / 70 个已有 warnings                                                                                                                                        |
| 根格式 / 变更格式 / diff         | `pnpm fmt:check` 仍失败，32 个未改动文件，与前次列表一致；本轮四文件 oxfmt --check 与 git diff --check 通过。不格式化无关文件                                                                           |

red 报告：`packages/desktop/.e2e-artifacts/market-share-ui-1790809734022/report.json`。green：`market-share-ui-1790809808493/report.json`（test）和 `market-share-ui-1790809875968/report.json`（production），均在上述忽略目录，记录 build hashes、退出码和 `rendererMarketplaceAssetRequests`。托管 artifact 的 `fix2-*.log` 保存命令真实输出；不提交运行产物、截图或临时测试数据。

Handoff 接口未新增：恢复行不再消费 inventory 的 `listing.icon`；原 inventory/协议/restore owner 不变。网络证据扩至 Renderer 官方市场 CDN 路径，不再把单纯 localhost fixture 0 写成恢复入口离线证明，仍不冒充全进程流量抓包。本轮没有重跑有凭据模型全基线、CLI 独立 lint/tsc 或 Desktop 额外三项 tsc；之前的通过/失败记录仅为前次证据。未验证安装包、Windows/macOS、真实 MCP OAuth 与现场 SSH/WSL/Docker；剩余产品裁剪仍按 #5–#7 串行继续。
