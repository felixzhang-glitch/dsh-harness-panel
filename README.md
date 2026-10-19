# dsh-harness-panel

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds a **Harness** page to Settings — one place to inspect and start/stop MCP servers, enable/disable skills, start/stop hook bridges, and inspect or edit the AGENTS.md instruction chain, styled to match the native settings UI.

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

**AGENTS.md**

- The workspace-instruction chain the current session loads, in the loader's own order: `$DSH_HOME/AGENTS.md`, `$DSH_AGENTS_HOME/AGENTS.md`, then the project root down to the session working directory, base candidates before each directory's `.local` overlays
- Every candidate's disposition: loaded, empty, truncated, omitted by the byte budget, duplicate within its candidate group, over the per-source cap, unreadable, or missing. The same budget algorithm the loader uses decides statuses and produces an exact **content that will be injected** preview
- The active agent preset is resolved through the session projection, the preset's `plugins` list, and the root fallback, so the displayed `maxBytes`/candidate configuration is the one in effect
- An inline editor per file, backed by a host write route with an allowlisted candidate path, a 1 MiB content cap, and an mtime precondition; saving through `~/.dsh/AGENTS.md -> ~/.agents/AGENTS.md` preserves the symlink. Missing candidates can be created from their directory card

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
- The host half's write routes are `POST /harness-panel/skills/toggle`, `POST /harness-panel/hooks/toggle-hook`, and `POST /harness-panel/agents/write`. Each requires `content-type: application/json`, an `x-harness-panel: 1` header, and a same-origin `Origin` when the browser sends one; the toggle bodies are bounded to 16 KiB and the AGENTS.md body to 4 MiB
- A skill toggle edits only the two invocation keys of the named skill's own SKILL.md (verified against the file's declared name); a hook toggle edits only that command's `type`; an AGENTS.md write is refused unless the path is a candidate discovered for the requested working directory, and its `expectedMtimeMs` must match the file on disk. Symlinked candidates are written through so the link survives, but a resolved target outside the project root or either instruction home is refused
- The host writes only those file edits plus `$DSH_HOME/harness-panel/state.json` (default `~/.dsh/harness-panel/state.json`): skill names, descriptions, paths, disable times, and the original frontmatter/type lines, mode 0600. No instruction bodies, no credentials
- AGENTS.md discovery reads with the host's Node filesystem, not the agent's sandboxed `ctx.fs` provider; file content is returned only to the same-origin panel and is never logged
- Credentials never leave the host: env/header maps surface as key lists, URLs and error text are redacted
- Routes bind to loopback only (the dsh webserver default)

## Development

```bash
pnpm install
pnpm build       # emits lib/index.js (host ESM) + lib/client.js (browser bundle)
pnpm typecheck
pnpm test        # vitest: mcp aggregation, hooks parsing, AGENTS.md discovery/render/file edits, sanitization, skill file/state, route gates, switch models
```

The scripts prefer `bunx` and fall back to the local Node. On the macOS desktop install the DSH-bundled Node is hardened and cannot load the ad-hoc native rollup/rolldown bindings, so `bunx tsdown` / `bunx vitest run` is the path that works there.

Compatibility: DSH `>=0.2.0 <0.3.0` (developed against desktop 0.2.1-rc.1). AGENTS.md discovery, dedupe and budget rendering mirror `@deepseek-ai/dsh-agent-instructions` 0.2.1-rc.2; if a later loader changes those semantics, the panel needs the same adjustment.

---

## 中文

DeepSeek Harness 设置面板插件：在设置导航中新增 **Harness** 入口，集中查看并启停 MCP 服务器、Skills 与 Hooks，并查看/编辑 AGENTS.md 指令链，视觉与原生设置页一致。

- **MCP**：已配置服务器的连接状态（来自上游 `mcp/status` 事件，无观察时如实显示未知）、传输方式、脱敏目标、工具清单，一键探活；每个可寻址行右侧有原生启停开关，停用后 mcp-client 行与其工具一起下线
- **Skills**：当前会话可见的 skill 目录（与 `/` 菜单同源），每个 skill 右侧有原生启用/停用开关。停用直接写入该 skill SKILL.md 的官方 frontmatter 键（`user-invocable: false`、`disable-model-invocation: true`），在任何 registry scope 都生效，skill 从模型目录与 `/` 菜单消失；面板仍以关闭状态列出，重新启用时按记录还原原始行
- **Hooks**：已挂载的 hook 桥配置解析（事件点 → 匹配器 → 命令），展开后**每条 command 有独立开关**——关闭时把该 hook 的 `type` 改为 bridge 跳过的哨兵值（provider 自身的机制），记录原始值并重载 bridge 行立即生效。bridge 整行不设总开关：loader 对整行的热恢复不可靠，面板停留在文件编辑能服务的粒度。本机约定路径上**未挂载**的配置文件继续只读扫描
- **AGENTS.md**：按 loader 的真实顺序展示当前会话的指令链（`$DSH_HOME/AGENTS.md` → `$DSH_AGENTS_HOME/AGENTS.md` → 项目根到会话工作目录，每层先基础候选再 `.local` 覆盖），标注每个候选的最终去向：已注入、空文件、被截断、因预算省略、同组重复折叠、超过单文件上限、不可读或未创建。预算与去重按 `dsh-agent-instructions` 0.2.x 的算法复刻，并给出**将注入内容**的完整预览；当前 preset 通过会话投影与 preset `plugins` 解析，显示实际生效的 `maxBytes` 与候选配置。每个文件有内联编辑器，保存走候选路径白名单 + 1 MiB 内容上限 + mtime 前置校验；`~/.dsh/AGENTS.md -> ~/.agents/AGENTS.md` 这类符号链接写穿目标而保留链接，缺失候选可在对应目录卡片中新建

安全边界：MCP 与 hook 开关调用 shipped `remote.pluginManager.setPluginEnabled`，由官方 manager 写 profile 的 `cordis.patch.yml` 并 reload，与内置 Plugins 页一致；host 的写入路由为 `POST /harness-panel/skills/toggle`、`POST /harness-panel/hooks/toggle-hook` 与 `POST /harness-panel/agents/write`，均要求 JSON、`x-harness-panel: 1` 与同源 `Origin`，开关类 body 上限 16 KiB，AGENTS.md 写入上限 4 MiB。skill 开关只改目标 SKILL.md 的两个 invocation 键（先校验声明的 skill name），hook 开关只改该命令的 `type`；AGENTS.md 写入只接受本次按请求工作目录发现出的候选路径，且 `expectedMtimeMs` 必须与磁盘一致；符号链接写穿目标，但目标落在项目根或两个指令 home 之外时拒绝写入。host 写出的文件仅这些编辑与 `$DSH_HOME/harness-panel/state.json`（默认 `~/.dsh/harness-panel/state.json`，0600），state 文件只含 skill 名称、描述、路径、停用时间与原始行记录，不含正文与凭据。AGENTS.md 发现与读取使用 host 的 Node 文件系统而非 agent 沙箱 provider；文件内容只返回给同源面板，不写日志。路由仅监听 loopback。

开发命令见上文；安装或重新构建后需重启 DSH（desktop profile 无 live reload）。
