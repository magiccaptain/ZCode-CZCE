# 郑商智助 · CZCE Agent

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="郑商智助 · CZCE Agent" width="128" height="128" />
</div>
<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=47ag983c-8fcb-4d6d-814b-5395193a712c&amp;qr_code=true">ZCode 上游飞书社群</a> ·
  <a href="https://discord.gg/z9aBcQXZQ3">ZCode Discord</a>
</p>
<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>

**郑商所智能工作助手**

协助处理知识查询、材料整理、数据分析与日常任务。

郑商智助（CZCE Agent）基于 ZCode Fork 开发。以上介绍表达产品方向，当前功能范围以下文为准；仓库名称及内部兼容标识暂时保持不变。

本 Fork 只发布本地 Desktop，保留本地 Provider/API key、Agent 工具、会话恢复、用户/工作区 Skills、stdio/HTTP MCP 与必要鉴权。Web、更新、账号/订阅、商店、分享、遥测、远程工作区与手机远控已关闭；普通 Agent 网络、shell 和浏览器能力保留。

## 更新

- 2026-9-23：更新至 ZCode v3.14.3 版本。

## 初始化

准备 Git、Node.js **24.14.0** 和 pnpm **10.33.2**，版本以 [mise.toml](mise.toml) 为准。以下开发和打包命令均在仓库根目录执行。

```bash
pnpm bootstrap
```

`pnpm bootstrap` 安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

Agent CLI 与运行时源码位于 [apps/zcode-cli/](apps/zcode-cli/)，作为普通目录随本仓库一起克隆，无需单独拉取或初始化 Git submodule。

| 命令                                  | 用途                                                  |
| ------------------------------------- | ----------------------------------------------------- |
| `pnpm install`                        | 安装 workspace 依赖（保留核心引用，整包清理另行进行） |
| `pnpm prepare:desktop-runtime`        | 仅准备本地 Agent、Skills/MCP、搜索与目标平台 helper   |
| `pnpm build` / `pnpm build:bootstrap` | 明确构建 Desktop 完整闭包，不递归构建 Web/server 产品 |

默认构建不需要 skip 环境变量，不准备 mock-cdn 或远端 Node/部署资产。旧 Web/server 发行与远端准备直接入口明确失败。

## 开发与运行

### 桌面版

```bash
pnpm dev:desktop

# 使用测试环境
pnpm dev:desktop:test
```

`pnpm dev:desktop` 默认等同于 `pnpm dev:desktop:prod`，使用生产服务配置。启动脚本会准备本地运行资源、构建桌面 Agent，再启动 Electron 和源码监听。

需要独立开发数据目录时，可设置 `ZCODE_DATA_BASE_DIR`。例如在 macOS / Linux 中：

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

模拟新用户首次打开时，先退出应用并停止当前开发进程，再执行：

```bash
mise run dev-first-run
# 等价入口
pnpm dev:desktop:first-run
```

每次执行都会创建新的临时用户目录，隔离设置、引导记录、任务/会话和 Electron 缓存，再按测试环境启动。终端会打印目录路径；退出后保留数据，便于查看日志。原 `mise run dev` 保持不变。该命令只模拟应用数据为空的启动，不重置系统授权或已安装的第三方工具；仅设置 `ZCODE_DATA_BASE_DIR` 不会隔离全局设置和 Electron 缓存。

### CLI 源码开发

直接开发 TUI 或 Agent 时，运行源码入口：

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# 构建 CLI 及其 workspace 依赖
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

此入口只用于 Agent 源码开发；本 Fork 不发布统一 CLI Web 产品。Desktop Agent 同源重建使用 `node scripts/build-desktop-agent-cli.mjs`，生产准备使用 `pnpm prepare:desktop-runtime`。

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                                 | 用途                                             |
| ------------------------------------ | ------------------------------------------------ |
| `ZCODE_DATA_BASE_DIR`                | 应用数据基目录，数据写入其下的 `.zcode/`         |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |

运行时变量可在启动命令的环境中显式设置。随客户端发布的默认配置见 [config/README.md](config/README.md)。

## 打包

第三方声明生成、发行校验流程及声明在发行物中的位置见 [third-party/README.md](third-party/README.md)。

### 桌面版

```bash
pnpm bundle:desktop

# 指定目标平台与 CPU 架构
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

默认目标为 macOS arm64，默认输出目录为 `packages/desktop/dist/`。`--os` 支持 `mac`、`win`、`linux`，`--arch` 支持 `x64`、`arm64`；实际打包与签名需要目标平台对应的工具和配置。

安装：双击打开产物 DMG，将郑商智助拖入"应用程序"。本地构建未签名，首次打开若被 macOS 拦截，执行：

```bash
sudo xattr -rd com.apple.quarantine /Applications/郑商智助.app
```

### 验证

执行 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`。构建闭包测试：`node --test packages/desktop/test/desktopBuildClosure.test.mjs`。真实核心、Skills/MCP 与安装包测试见 [Desktop E2E](packages/desktop/e2e/README.md)；凭据只通过仓库外私有 key-file 交给既有 runner。

## 仓库结构

| 目录                                                 | 职责                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包   |
| `packages/server`                                    | 保留库引用及已关闭发行源码                 |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态     |
| `packages/services`                                  | 业务服务与持久化                           |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现              |
| `apps/zcode-cli`                                     | Agent CLI、TUI、运行时与工具               |
| `scripts`、`config`、`third-party`                   | 构建维护脚本、内置配置与第三方声明材料     |

## 项目声明

功能与优惠范围、维护规则、执行与数据风险，以及许可和第三方版权说明，详见 [NOTICE.md](NOTICE.md)。
