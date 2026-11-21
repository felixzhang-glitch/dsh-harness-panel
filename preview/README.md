# Preview harness

Mounts the real Harness section — same components, same stylesheet, same
dictionary — against fixed fixtures in a plain page, so layout and density can
be checked without restarting DSH.

```bash
bun preview/build.ts
open preview/dist/index.html
```

Query flags:

| flag | meaning |
| --- | --- |
| `tab=0..4` | open Overview / MCP / Skills / Hooks / AGENTS.md |
| `open=N` | expand the Nth expandable row on that tab |
| `dark=1` | set `body[data-ds-dark-theme]` |
| `lang=en` | render the English dictionary |

## What is stubbed

- `primitives.tsx` stands in for `@deepseek-ai/dsh-client-ui-primitives`. The
  real package ships CSS modules that only the shell's bundler resolves; the
  stand-ins reproduce the shipped geometry (28px small buttons, 36x20 switch,
  32px input, 24px pill) from the same `--dsw-*` tokens. They are close enough
  to judge layout, not a substitute for the atoms.
- React comes from the Bun cache (`react@19.2.8` + `react-dom` + `scheduler`),
  because this repo installs React without a DOM renderer.
- `fixtures.ts` answers the panel's host routes and the `skills` /
  `pluginManager` Remotes.

## Why `vendor/` is committed

`vendor/base.css` and `vendor/design-platform.css` are the DSH theme token
sheets (MIT, from `@deepseek-ai/dsh-client-ui-theme`), copied out of the app so
the harness renders on the real palette. They drift when the app's tokens
change; re-copy them from the installed app when a preview looks off:

```bash
# inside the app bundle: /dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/
```

`preview/dist` is generated and git-ignored.
