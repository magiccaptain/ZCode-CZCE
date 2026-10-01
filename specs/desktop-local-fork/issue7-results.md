# Issue #7 本机清理与回归结果

实施平台 Linux x64，Node 24.14.0 / pnpm 10.33.2。基于 `831b355`，#7 的组件差异由 integration 阶段统一验收并纳入一个本地提交；不推送、不创建 PR 或修改 issue。

## 已完成

- 原子删除零消费者 Web/server-cli 产品包，server 无消费者的 HTTP/stdio 产品启动/旧构建闭包，以及独占远程 packaging/helpers/rg13 归档。
- 清理 server 旧产品专用依赖与 Agent noop telemetry 7 个 SDK/context/exporter dependency；同步 exports、typecheck、knip、policy、lockfile、实际失效文档/skill 引用。
- 保留 server remote/stdio 契约、完整 Agent 布局、公共 Provider/鉴权、插件 loader、工作流、Skills/MCP、CommandInbox、owner/lease、workspace identity、stale run、会话恢复和动态必要资产；未改协议/固定产品配置/用户数据。
- 建立 `scripts/upstream-regression.mjs` 与配套测试、维护流程；固定上游 `29628c9acdb81b703bbd4080c207a0e7ce5e276e`，独立 integration 基线工作树实际执行闭包检查。没有 fetch/merge 未来版本、覆盖 CLI、提交或自动合入。
- 删除逐项依据、保留模块与图见 `issue7-cleanup.md`；流程与限制见 `upstream-regression.md`。

## 真实静态、安装与构建

| 命令/场景                                                                           | 实际结果                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| freshness / architecture changed 与各模块 context                                   | 新鲜；架构0 violations/0 baseline/0 new；desktop/server/server-cli/web/services/ui/zcode-cli 都为 legacy unmanaged，无 module.ts/direct contract                                        |
| 新闭包测试先红再绿                                                                  | 第一轮3项失败；server 启动闭包新增测试也先失败；upstream 测试先 module-not-found，实现后通过                                                                                            |
| `pnpm install --lockfile-only --ignore-scripts` 与 `pnpm install --frozen-lockfile` | 通过；31 workspace 项目，旧 importer 与不再需要的锁项消失。仍有上游 TUI TypeScript peer/deprecated warnings；不是全新 node_modules 空环境安装证明                                       |
| `pnpm typecheck`                                                                    | 通过；根当前 references，不宣称全部 Desktop Main/preload/renderer 单独类型检查                                                                                                          |
| `pnpm lint`                                                                         | 通过，0 errors/70 warnings                                                                                                                                                              |
| `pnpm architecture:check --changed`                                                 | 通过，0新增/0 baseline                                                                                                                                                                  |
| `pnpm fmt:check`                                                                    | 失败，30个既有未改文件（Bot 与 issue2-results 等）；不扩大范围格式化。受影响文件 `oxfmt --check` 22个匹配文件全部通过                                                                   |
| CLI `pnpm --dir apps/zcode-cli typecheck`                                           | 首次失败：nested PATH 找不到根 turbo。把根 node_modules/.bin 加入 PATH 后 `typecheck --force` 真执行27 tasks成功，0 cached；流程脚本显式使用根 shim                                     |
| aggregate UI/services/Desktop tests                                                 | 最终184/184通过；Agent telemetry 单独11/11通过                                                                                                                                          |
| knip / dep:refs                                                                     | 均已实际执行。knip最终仍exit1：67 unused files、38 deps、30 devDeps、398 exports、8存量unlisted；无新增 unresolved import。引用具体结论见清理规格，不以 unused 批量删资源               |
| 干净输出 `ZCODE_ENV=production pnpm build`                                          | 通过；首次删除 Desktop out/bundled-agents/bundled-tools 与完整 Agent build-chain dist 后重建成功。server闭包最终变更后再次清 Desktop/server输出并重建成功；无旧Web/远端发行输出作为依赖 |
| 当前源码 Linux production AppImage                                                  | electron-builder通过；包内 native/runtime closure检查通过；本地 Agent/renderer/必要资源完整。不是 Windows/macOS/签名/系统安装验证                                                       |

## 实际运行（最终 server 闭包清理后）

| 入口                                                                               | 结果与证据                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packaged `e2e/run-build.mjs --executable <当前AppImage>`                           | 通过，旧账号/市场/share/SSH/WSL/Docker fixture、UI/平台拒绝及正常启动/退出/重启；`packages/desktop/.e2e-artifacts/build-1790827504022/report.json`                                                |
| packaged `e2e/run-telemetry.mjs --executable <当前AppImage> --key-file <私有文件>` | 通过，干净/旧队列字节保留、SDK未加载、产品/OTLP请求0、包内真实DeepSeek对话与SQLite持久化；`telemetry-1790827519730/report.json`                                                                   |
| `e2e:baseline --key-file <私有文件> --extensions --telemetry`                      | 通过，真实模型、文件/Bash、权限拒绝/允许、busy追加串行admission、停止、正常重启恢复、用户/工作区Skills、stdio/带测试鉴权HTTP MCP及持久化/遥测；`5913a6e0-63da-4bb3-b06f-dcdb19547b9d/report.json` |
| production `e2e/run-account.mjs`                                                   | 通过，旧账号/OAuth/支付绕过无副作用、本地Provider/model设置保存重启；`account-1790827620473/report.json`                                                                                          |
| production `packages/ui/test/productMarketplaceSharing.e2e.mjs`                    | 通过，市场/分享请求0、本地已安装管理与离线内置恢复；`market-share-ui-1790827678062/report.json`                                                                                                   |
| production `e2e/run-remote-backend.mjs`                                            | 通过，旧历史保持、远端/手机attachment拒绝、本地请求正常；`remote-backend-1790827737456/report.json`                                                                                               |
| production `packages/ui/test/productRemoteWorkspace.e2e.mjs`                       | 通过，旧远端历史不可用、本地目录/Bot入口保持；`remote-ui-1790827895994/report.json`                                                                                                               |
| `e2e:updates`                                                                      | 首次未设LANG使用中文系统，英文Skip定位失败，报告真实失败；只将测试LANG设为en_US.UTF-8后production/test实际重建重跑通过；`updates-1790828051006/report.json`                                       |

上述相对运行报告均位于 `packages/desktop/.e2e-artifacts/`。包内冒烟不等于包内完整核心生命周期或Skills/MCP。fixture 网络计数/Chromium netlog不等于全进程全流量捕获。

本次 AppImage SHA-256：`f65500086960b692c7e1d2d14739625483349eaaf2870a7d07c3d57818d7ea86`。基线演练 localBefore/localAfter 均为 `831b3559747e6a2429c67cf7514b3b9e38bd53c7`（没有merge或提交），独立工作树闭包4/4通过；最新直接闭包/构建/流程测试15/15通过。

维护日志及隔离基线报告在仓库外受管目录 `/home/sc/.pi/agent/sessions/--home-sc-projects-ZCode-CZCE--/subagent-artifacts/outputs/1966916d-7426-4305-8821-ad46fa2d9f71/issue7/` 的 `logs/` 和 `upstream-baseline-review.json`；外部worktree为 `baseline-worktree/`，分支 `integration/issue7-baseline`。上游与本地SHA、完整本地差异和无merge冲突处理说明由实跑工具记录。

## Integration 阶段复核

- 对照 issue checklist 与完整组件 diff，确认最终删除闭包与保留公共接口一致，未重新实现各组件或移转所有者。scripts/tests 没有受管模块，Desktop/UI/services/CLI context 均为 legacy unmanaged、无直接依赖契约；CLI context 指向既有 tools contract，已阅读。
- 执行流程接口纠正：`--verify` 新增既有 UI/services/Desktop guard/同源装配测试与 Agent telemetry 测试。严格解析参数，在 IO 前拒绝未知/重复/缺值、互斥及模式不适用参数；路径边界不再把 checkout 内 `..internal` 当作外部父路径。先更新 spec、补测试实跑3项失败，再实现，17/17直接闭包/构建/流程测试通过。
- 正常 `pnpm build` 不自动删除输出，流程文档已纠正；上文 clean-output 是组件单独演练证据。
- integration 自行实跑 `pnpm typecheck`、`pnpm lint`（0 errors/70 warnings）、`pnpm architecture:check --changed` 均通过；CLI `typecheck --force` 27/27真执行、0 cached；production `pnpm build` 通过。`pnpm fmt:check` 仍因30个既有未改文件失败，不标通过。
- 使用与流程脚本完全相同的 spawn 参数（glob 无 shell 展开），聚合测试186/186、Agent telemetry 11/11通过；其中相对组件184新增2项参数测试。
- integration 真实核心/Skills/MCP/telemetry 重跑通过：`packages/desktop/.e2e-artifacts/ae033c06-d540-4e1b-a298-2687a409041a/report.json`。私有 key 只交既有 runner，不打印、不在填 key 阶段截图。
- 当前组件 production AppImage 综合关闭 E2E重跑通过：`build-1790829257670/report.json`（沿用组件构建、上述SHA，不冒充 integration 重新打包）；production/test 更新实际重建 E2E通过：`updates-1790829273334/report.json`。两个相对报告都在 `packages/desktop/.e2e-artifacts/`。
- 完整 `--verify` 已在干净的独立 `integration/issue7-verify` worktree 真执行：从空 node_modules frozen install 成功（1855 packages、pnpm store复用、无下载，不等同空操作系统安装），根 typecheck/lint/全量architecture通过，随后 fmt因相同30个存量文件失败并exit1。闭包/build/CLI/行为/E2E等后续命令未由这一连锁调用执行，上述单独运行证据不能伪称full gate全绿。脱敏结构化报告为受管目录 `upstream-verify-integration.json`，完整日志 `logs/integration-full-verify.log`；分支/worktree保留供审查，没有额外提交、merge或推送。
- 最终提交后保存真实 `HEAD^..HEAD` 证据：`/tmp/zcode-fork-issues/issue7-current-commit.patch`、`issue7-current-files.txt`、`issue7-current-summary.txt`。最终 SHA 从 summary/Git 读取，避免将自引用 commit SHA 写入提交文件。

## Fresh review 修复（P2 集成方式与来源门禁矛盾）

- 已确认有效：原流程文档允许逐提交 cherry-pick，而 `scripts/upstream-regression.mjs` 的 `main()` 在任何回归或报告创建前无条件执行 `git merge-base --is-ancestor upstream HEAD`。普通 cherry-pick 不保留来源提交的 ancestry，不能完成原文宣传的门禁流程。没有无效 finding。
- 经批准限定为 merge-only：先更新 `issue7-cleanup.md` 的维护者/脚本所有者、来源错误、保留边界、时序及验收，再增加 `upstreamRegression.test.mjs` 文档契约测试，实跑 5 项中新增 1 项失败；随后修正文档只支持保留历史的 Git merge，明确普通 cherry-pick 不受支持。来源 guard、CLI 参数与报告接口完全未改，未新增来源映射或产品开关。
- 受影响闭包/构建/流程测试最终 18/18 通过；根 `pnpm typecheck` 通过；`pnpm lint` 为 0 errors/70 warnings；`pnpm architecture:check --changed` 为 0 violations/0 baseline/0 new。desktop context 为 legacy unmanaged、无 module.ts/直接契约；scripts/tests 不在受管 roots 内。
- 全仓 `pnpm fmt:check` 在新增测试格式修正后仍仅因 30 个既有未改文件失败；4 个本次变更文件的 `oxfmt --check` 通过。不扩展为存量格式清理。
- 本次只修复流程文档契约，无 Runtime/UI 行为改动，未重跑 E2E/build/完整 `--verify`；原完整门禁遇存量格式失败停止的结论保持不变，不能由此宣称全绿或真正未来上游合入已验证。
- 实跑日志保存于上文受管目录 `logs/fix1-affected-tests.log`、`fix1-typecheck.log`、`fix1-lint.log`、`fix1-architecture.log`、`fix1-format-full.log` 和 `fix1-format-changed.log`。只 amend 当前 #7 提交；当前 patch/files/summary 仍更新到上文 `/tmp/zcode-fork-issues/issue7-current-*`，不推送、不改早期历史。

## 主代理整批最终验收

主代理在 #2–#7 六个提交全部完成、独立审查通过后，使用固定 Node 24.14.0 / pnpm 10.33.2 重新执行：

- 根 `pnpm typecheck`、`pnpm lint`（0 errors / 70 warnings）、架构 changed 与全仓检查均通过；相对 Issue #1 的完整变更 `git diff --check` 通过。
- UI/services/Desktop 聚合测试 **187/187**、Agent 遥测测试 **11/11** 通过；CLI `typecheck --force` **27/27** 真执行、0 cached。
- 对整个 `dfd3961..HEAD` 变更范围检查格式，发现 `issue2-results.md` 和 CLI `dependencies/README.md` 两份本轮文档遗漏格式化。仅格式化这两文件并纳入 #7 文档清理，不增加提交、不改变任何 Runtime/UI 行为。不能把这两项称为本轮开始前的旧问题。
- 修正后全仓格式仍失败于 **29 个不在本轮变更范围内的文件**；不扩修无关文件。`pnpm knip` 仍失败：67 unused files、38 dependencies、30 devDependencies、8 unlisted dependencies、398 exports、145 exported types、36 duplicate exports；保留已有引用审计边界，不为工具全绿删除动态必要依赖。
- 本机 production AppImage 文件存在，SHA-256 再次核验为 `f65500086960b692c7e1d2d14739625483349eaaf2870a7d07c3d57818d7ea86`，与上述真实运行产物一致。此最终补充仅文档格式/验收记录，不冒称主代理重新执行了全部 E2E 或完整上游门禁。

主代理日志在仓库外 `/tmp/zcode-fork-issues/final-parent-*.log`。最终修改纳入原 #7 提交；#2–#7 仍恰好六个提交，#1 不改、不推送。

## 未验证与下一步

- 未来上游真正合入/冲突解决未执行；本轮已实际执行隔离review-only基线，以及上列真实单项验证。完整 `--verify` 已实跑至存量全仓格式失败即停止（见上节），后续未执行项不标通过；不能宣称该门禁已全绿。
- Windows/macOS、签名/公证/系统安装、真实MCP OAuth浏览器闭环、包内完整核心/Skills/MCP、跨Host/手机replay运行及全流量证明未执行。本地核心工具/网络能力未关闭。
- 现有全仓格式、knip unused/unlisted、Main/preload/renderer独立类型问题不是本清理修复范围；没有新增协议或状态所有者。
