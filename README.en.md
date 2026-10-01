# ZCode

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=47ag983c-8fcb-4d6d-814b-5395193a712c&amp;qr_code=true">Feishu community</a> ·
  <a href="https://discord.gg/z9aBcQXZQ3">Discord</a>
</p>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

This fork ships local Desktop only. Local Provider/API keys, Agent tools and recovery, user/workspace Skills, stdio/HTTP MCP and required authentication remain available. Web, updates, product accounts/subscriptions, marketplaces, sharing, telemetry, remote workspaces and phone control are disabled. Normal Agent shell, networking and browser tools remain available.

## Updates

- 2026-9-23: Updated to ZCode v3.14.3.

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

The Agent CLI and runtime source code lives in [apps/zcode-cli/](apps/zcode-cli/) as a regular directory included when you clone this repository. No separate checkout or Git submodule initialization is required.

| Command                               | Purpose                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm install`                        | Install workspace dependencies; retained library references are cleaned up separately |
| `pnpm prepare:desktop-runtime`        | Prepare local Agent, Skills/MCP, search tools and target-platform helpers only        |
| `pnpm build` / `pnpm build:bootstrap` | Build the explicit Desktop closure, without recursive Web/server product builds       |

No skip environment is required. Builds do not prepare mock-cdn, remote Node binaries or deployment assets. Retired direct distribution scripts reject execution.

## Development and Usage

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses production service configuration. The startup script prepares local runtime assets, builds the desktop Agent, then starts Electron and source watchers.

Set `ZCODE_DATA_BASE_DIR` to use a separate development data directory. For example, on macOS / Linux:

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### CLI Source Development

Use the source entry when developing the TUI or Agent:

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# Build the CLI and its workspace dependencies
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

This entry is for Agent source development, not a CLI Web product release. Rebuild the Desktop Agent from current source with `node scripts/build-desktop-agent-cli.mjs`; prepare production resources with `pnpm prepare:desktop-runtime`.

## Configuration

The root [.env.example](.env.example) provides sample service URLs and build configuration. Copy it to `.env` as needed and place local overrides in `.env.local`. Select the Desktop development environment with `dev:desktop:test` or `dev:desktop:prod`.

| Setting                              | Purpose                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `ZCODE_DATA_BASE_DIR`                | Base directory for application data, stored under its `.zcode/` subdirectory            |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local provider configuration file; uses the built-in configuration when unset |

Runtime variables can be set explicitly in the environment of the startup command. See [config/README.md](config/README.md) for the default configuration shipped with the client.

## Packaging

See [third-party/README.md](third-party/README.md) for notice generation, distribution checks, and where the notices are included in each distribution.

### Desktop

```bash
pnpm bundle:desktop

# Set the target platform and CPU architecture
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

The default target is macOS arm64, and the default output directory is `packages/desktop/dist/`. `--os` accepts `mac`, `win`, or `linux`; `--arch` accepts `x64` or `arm64`. Packaging and signing require the tools and configuration for the target platform.

### Validation

Run `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check --changed` and `node --test packages/desktop/test/desktopBuildClosure.test.mjs`. Real core, Skills/MCP and packaged smoke entrypoints are documented in [Desktop E2E](packages/desktop/e2e/README.md). Credentials must remain in a private key-file outside the repository.

## Repository Structure

| Directory                                            | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main, Host, Renderer, and desktop packaging                                    |
| `packages/web`                                       | Disabled Web product source (pending reference-based cleanup)                           |
| `packages/server`                                    | Retained library references and disabled distribution source                            |
| `packages/zcode-server-cli`                          | Disabled standalone server distribution source                                          |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state                                       |
| `packages/services`                                  | Business services and persistence                                                       |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, and Agent client SDK                         |
| `packages/provider`, `packages/provider-node`        | Common provider capabilities and Node implementations                                   |
| `apps/zcode-cli`                                     | Agent CLI, TUI, runtime, and tools                                                      |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

## Project Notice

See [NOTICE.md](NOTICE.md) for feature and promotion scope, maintenance policy, execution and data risks, licensing, and third-party copyright information.
