# Desktop 核心 E2E 基线

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
- `pnpm --filter @zcode/desktop e2e:updates`：分别重建 production/preview，覆盖干净目录、旧配置与缓存、8 类实际更新请求、原生菜单、设置及正常退出。启动前 spy 观察更新器和强制升级调用来源；其他产品配置请求不计为更新请求。
- 核心基线追加 `--extensions`：原生 `.zcode/cli/config.json` / 工作区 `.zcode/config.json` 配置真实 stdio 与带测试鉴权头的 HTTP MCP；用户级/工作区级 Skill 通过 Skill 工具加载。在独立会话核验精确回复和持久化工具输出，核心会话仍检查原来的 9 条输入。
- `e2e:updates --executable /absolute/path/to/packaged/executable`：启动实际本机产物，不替换包内 Provider 资源。使用 Chromium netlog 核验无更新 manifest / 陷阱 feed 请求；原始 netlog 仅留在私有测试目录，报告只记录事件数。

已打包测试可额外提供 `--key-file /absolute/path/outside/repository/deepseek-api-key`，通过包内 Agent 和 Provider 资源完成一次真实对话并检查 SQLite 持久化。这个打包冒烟不替代完整核心基线。

Linux AppImage 本机运行示例：

```sh
APPIMAGE_EXTRACT_AND_RUN=1 pnpm --filter @zcode/desktop e2e:updates --executable /absolute/path/to/ZCode.AppImage --key-file /absolute/path/outside/repository/deepseek-api-key
```

这些测试会使用系统临时目录和忽略的缓存。默认更新测试不使用模型 key；追加打包冒烟时使用。`--extensions` 仍使用真实模型请求，MCP 仅连接本机 fixture。Windows/macOS 需要各自环境实际执行，不能用 Linux 结果替代。
