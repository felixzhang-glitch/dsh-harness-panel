# dsh-harness-panel

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds a **Harness** page to Settings — one place to inspect MCP servers, skills, and hooks, styled to match the native settings UI.

English · [中文](#中文)

## Features

**MCP** (read-only)

- Every configured `@deepseek-ai/dsh-mcp-client` row: connection status (observed from the upstream `mcp/status` seam, honestly `unknown` when unobserved), transport, sanitized target, tool inventory
- One-shot connectivity probe per server (streamable-http `initialize` POST / stdio spawn handshake, 10s deadline)
- Never writes configuration; env/header values never leave the host (keys only, URLs credential-redacted)

**Skills**

- The current session's user-invocable skill catalog — the same seam the composer `/` menu reads (`remote.skills`), so the panel always agrees with the composer
- Search filter, model-invocable badge, source path

**Hooks**

- Mounted hook bridges (`@deepseek-ai/dsh-hooks-claude-code` / `@deepseek-ai/dsh-hooks-codex`): each row's `configPath` file parsed into event → matcher → command views
- Conventional on-disk locations (`~/.claude/settings.json`, `~/.codex/hooks.json`, project-level, …) scanned read-only and clearly marked **not mounted**

## Design

The visual language follows the shipped settings sections rather than inventing its own: `--dsw-*` design tokens only (no hard-coded colors), native corner radii (`--dsw-radius-xl` cards, `--dsw-radius-md` controls), 0.5px hairline strokes, and the underline tab strip used by the built-in Plugins page. Light and dark themes both work.

## Install

Desktop profile (`~/.dsh/profiles/desktop`):

```bash
cd ~/.dsh/profiles/desktop
# package.json → dependencies: "dsh-harness-panel": "link:<path to this repo>"
# package.json → dsh.profile.bundles: add "dsh-harness-panel"
pnpm install
# restart DSH (the desktop profile has no live reload)
```

Or install by local path from Settings → Plugins.

## Security boundary

- The host half is read-only: it registers three GET routes (`/harness-panel/mcp`, `/harness-panel/mcp/probe`, `/harness-panel/hooks`) and never touches a configuration file
- Credentials never leave the host: env/header maps surface as key lists, URLs and error text are redacted
- Routes bind to loopback only (the dsh webserver default)

## Development

```bash
pnpm install
pnpm build       # emits lib/index.js (host ESM) + lib/client.js (browser bundle)
pnpm typecheck
pnpm test        # vitest: mcp aggregation, hooks parsing, sanitization
```

Compatibility: DSH `>=0.2.0 <0.3.0` (developed against desktop 0.2.0-rc.2).

---

## 中文

DeepSeek Harness 设置面板插件：在设置导航中新增 **Harness** 入口，集中查看 MCP 服务器、Skills 与 Hooks，视觉与原生设置页一致。

- **MCP**（只读）：已配置服务器的连接状态（来自上游 `mcp/status` 事件，无观察时如实显示未知）、传输方式、脱敏目标、工具清单，以及一键探活
- **Skills**：当前会话可见的 skill 目录（与 `/` 菜单同源），支持搜索过滤
- **Hooks**：已挂载的 hook 桥配置解析（事件点 → 匹配器 → 命令），以及本机约定路径上**未挂载**的配置文件扫描

安全边界：host 半完全只读，只注册三条 GET 路由；凭据不出 host（env/headers 只出键名，URL 与错误文本脱敏）；路由仅监听 loopback。

开发命令见上文；安装后需重启 DSH（desktop profile 无 live reload）。
