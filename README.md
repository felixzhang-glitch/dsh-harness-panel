# dsh-harness-panel

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds a **Harness** page to Settings — one place to inspect and start/stop MCP servers, enable/disable skills, and start/stop hook bridges, styled to match the native settings UI.

English · [中文](#中文)

## Features

**MCP**

- Every configured `@deepseek-ai/dsh-mcp-client` row: connection status (observed from the upstream `mcp/status` seam, honestly `unknown` when unobserved), transport, sanitized target, tool inventory
- A native start/stop switch on every addressable row, through the same `pluginManager` Remote the built-in Plugins page uses; disabling stops the mcp-client row and its tools
- One-shot connectivity probe per server (streamable-http `initialize` POST / stdio spawn handshake, 10s deadline)
- Env/header values never leave the host (keys only, URLs credential-redacted)

**Skills**

- The current session's user-invocable skill catalog — the same seam the composer `/` menu reads (`remote.skills`), so the panel always agrees with the composer
- A native enable/disable switch per skill. Disabling sets the provider's own frontmatter keys (`user-invocable: false`, `disable-model-invocation: true`) in the skill's SKILL.md, so it leaves the model catalog and the `/` menu in every registry scope; the panel keeps listing it with an off switch, and re-enabling restores the original frontmatter lines
- Search filter, model-invocable badge, source path

**Hooks**

- Mounted hook bridges (`@deepseek-ai/dsh-hooks-claude-code` / `@deepseek-ai/dsh-hooks-codex`): each row's `configPath` file parsed into event → matcher → command views
- A per-command switch inside each expanded group: turning one hook off flips its `type` to the sentinel the bridges skip, records the original value, and reloads the bridge row so it takes effect immediately. The bridge row itself deliberately carries no whole-row switch — the loader's live re-enable of a row is unreliable, so the page stays at the granularity the file edit serves
- Conventional on-disk locations (`~/.claude/settings.json`, `~/.codex/hooks.json`, project-level, …) scanned read-only and clearly marked **not mounted**

## Design

The visual language follows the shipped settings sections rather than inventing its own: `--dsw-*` design tokens only (no hard-coded colors), native corner radii (`--dsw-radius-xl` cards, `--dsw-radius-md` controls), 0.5px hairline strokes, the underline tab strip used by the built-in Plugins page, and the shipped `Switch` atom from `@deepseek-ai/dsh-client-ui-primitives` — the exact control the Plugins page uses. Light and dark themes both work.

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

- MCP and hook bridge switches call the shipped `remote.pluginManager.setPluginEnabled`: the official manager writes the profile's `cordis.patch.yml` and reloads the row, exactly as the built-in Plugins page does. This host half registers no write route for them
- The host half adds one write route, `POST /harness-panel/skills/toggle`, for skill toggles. It requires `content-type: application/json`, an `x-harness-panel: 1` header, and a same-origin `Origin` when the browser sends one; the body is bounded to 16 KiB. A toggle edits only the two invocation keys of the named skill's own SKILL.md (verified against the file's declared name) and records the original lines for restore
- Beside those two frontmatter lines, the only file the host writes is `$DSH_HOME/harness-panel/state.json` (default `~/.dsh/harness-panel/state.json`): skill names, descriptions, paths, disable times, and the original frontmatter lines, mode 0600. No instruction bodies, no credentials
- Credentials never leave the host: env/header maps surface as key lists, URLs and error text are redacted
- Routes bind to loopback only (the dsh webserver default)

## Development

```bash
pnpm install
pnpm build       # emits lib/index.js (host ESM) + lib/client.js (browser bundle)
pnpm typecheck
pnpm test        # vitest: mcp aggregation, hooks parsing, sanitization, skill file/state, route gate, switch models
```

The scripts prefer `bunx` and fall back to the local Node. On the macOS desktop install the DSH-bundled Node is hardened and cannot load the ad-hoc native rollup/rolldown bindings, so `bunx tsdown` / `bunx vitest run` is the path that works there.

Compatibility: DSH `>=0.2.0 <0.3.0` (developed against desktop 0.2.1-rc.1).

---

## 中文

DeepSeek Harness 设置面板插件：在设置导航中新增 **Harness** 入口，集中查看并启停 MCP 服务器、Skills 与 Hooks，视觉与原生设置页一致。

- **MCP**：已配置服务器的连接状态（来自上游 `mcp/status` 事件，无观察时如实显示未知）、传输方式、脱敏目标、工具清单，一键探活；每个可寻址行右侧有原生启停开关，停用后 mcp-client 行与其工具一起下线
- **Skills**：当前会话可见的 skill 目录（与 `/` 菜单同源），每个 skill 右侧有原生启用/停用开关。停用直接写入该 skill SKILL.md 的官方 frontmatter 键（`user-invocable: false`、`disable-model-invocation: true`），在任何 registry scope 都生效，skill 从模型目录与 `/` 菜单消失；面板仍以关闭状态列出，重新启用时按记录还原原始行
- **Hooks**：已挂载的 hook 桥配置解析（事件点 → 匹配器 → 命令），展开后**每条 command 有独立开关**——关闭时把该 hook 的 `type` 改为 bridge 跳过的哨兵值（provider 自身的机制），记录原始值并重载 bridge 行立即生效。bridge 整行不设总开关：loader 对整行的热恢复不可靠，面板停留在文件编辑能服务的粒度。本机约定路径上**未挂载**的配置文件继续只读扫描

安全边界：MCP 与 hook 开关调用 shipped `remote.pluginManager.setPluginEnabled`，由官方 manager 写 profile 的 `cordis.patch.yml` 并 reload，与内置 Plugins 页一致；host 只新增一条 skill 开关写入路由 `POST /harness-panel/skills/toggle`，要求 JSON、`x-harness-panel: 1` 与同源 `Origin`，body 上限 16 KiB，且只改目标 SKILL.md 里两个 invocation 键（先校验文件声明的 skill name）。除这两行外，host 唯一直接写出的文件是 `$DSH_HOME/harness-panel/state.json`（默认 `~/.dsh/harness-panel/state.json`，0600），只含 skill 名称、描述、路径、停用时间与原始行记录，不含正文与凭据。路由仅监听 loopback。

开发命令见上文；安装或重新构建后需重启 DSH（desktop profile 无 live reload）。
