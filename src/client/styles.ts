/**
 * Scoped stylesheet for the Harness section. Standalone client bundles cannot
 * use the in-repo CSS-module pipeline, so the sheet ships as a string and is
 * installed effect-scoped into one `<style data-dsh-harness-panel>` element.
 * Every selector is scoped under `[data-dsh-harness-panel]` and uses theme
 * design tokens only, so it follows both color schemes.
 *
 * The panel is a status surface, not a dashboard: information density over
 * decoration, semantic color only where it carries a failure, tabular figures
 * for every count, hairlines instead of stacked boxes, and no control that
 * repeats what the row already says. Geometry follows the shipped settings
 * sections — 0.5px strokes, `--dsw-radius-*` corners, 13px base text, and the
 * native underline tab strip.
 *
 * @module dsh-harness-panel/client/styles
 */

/** Live installations of the panel stylesheet (one element, many mounts). */
let liveInstalls = 0

/**
 * One `<style>` installation; returns the exact disposer that releases it.
 * Ownership is counted across mounts: the element is created once, any live
 * install keeps it, and only the last disposer removes it.
 */
export function installPanelStyles(): () => void {
  let disposed = false
  liveInstalls += 1
  let element = document.querySelector<HTMLStyleElement>('style[data-dsh-harness-panel]')
  if (element === null) {
    element = document.createElement('style')
    element.dataset.dshHarnessPanel = ''
    element.textContent = PANEL_CSS
    document.head.append(element)
  }
  return () => {
    if (disposed) return
    disposed = true
    liveInstalls -= 1
    if (liveInstalls <= 0) {
      liveInstalls = 0
      element?.remove()
    }
  }
}

/** The panel stylesheet, scoped and token-driven. */
export const PANEL_CSS = `
[data-dsh-harness-panel] {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  /* Digit columns align across rows; prose is unaffected. */
  font-variant-numeric: tabular-nums;
}

/* Header */

[data-dsh-harness-panel] .dhp-heading {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  letter-spacing: -0.01em;
}

[data-dsh-harness-panel] .dhp-intro {
  margin: 0;
  max-width: 68ch;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
  text-wrap: pretty;
}

/* Tab strip: mirrors the shipped Plugins settings section — quiet underline
   tabs, active row carries the 2px indicator. */

[data-dsh-harness-panel] .dhp-tabs {
  display: flex;
  align-items: flex-end;
  gap: 22px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  margin-top: 2px;
}

[data-dsh-harness-panel] .dhp-tab {
  position: relative;
  border: 0;
  padding: 7px 1px 9px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}

[data-dsh-harness-panel] .dhp-tab[data-active='true'] {
  color: var(--dsw-alias-label-primary);
}

@media (hover: hover) {
  [data-dsh-harness-panel] .dhp-tab:hover {
    color: var(--dsw-alias-label-primary);
  }
}

[data-dsh-harness-panel] .dhp-tab[data-active='true']::after,
[data-dsh-harness-panel] .dhp-tab:focus-visible::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--dsw-alias-label-primary);
  content: '';
}

[data-dsh-harness-panel] .dhp-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
  border-radius: 2px;
  color: var(--dsw-alias-label-primary);
}

/* Tab panels: one column, hairline spacing between blocks. */

[data-dsh-harness-panel] .dhp-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 2px;
}

/* Author display rules beat the hidden attribute's UA rule; restore it so
   only the selected tab panel is visible (visited panels stay mounted). */
[data-dsh-harness-panel] .dhp-panel[hidden] {
  display: none;
}

/* Toolbar: page summary on the left, actions on the right. */

[data-dsh-harness-panel] .dhp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  flex-wrap: wrap;
  min-height: 28px;
}

[data-dsh-harness-panel] .dhp-meta {
  display: flex;
  align-items: center;
  gap: 4px 10px;
  flex-wrap: wrap;
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-harness-panel] .dhp-meta strong {
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-harness-panel] .dhp-meta[data-tone='warn'] strong {
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary));
}

[data-dsh-harness-panel] .dhp-meta[data-tone='error'] strong {
  color: var(--dsw-alias-state-error-primary);
}

/* Action cluster inside a row or an editor bar. */

[data-dsh-harness-panel] .dhp-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

/* Blocks: an optional title over one list. */

[data-dsh-harness-panel] .dhp-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

[data-dsh-harness-panel] .dhp-block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-height: 18px;
}

[data-dsh-harness-panel] .dhp-block-title {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* A directory group inside a titled section: one step quieter than the title. */
[data-dsh-harness-panel] .dhp-block-title[data-mono='true'] {
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
}

[data-dsh-harness-panel] .dhp-block-note {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

/* Lists: one framed sheet, rows one hairline apart. No per-row box. */

[data-dsh-harness-panel] .dhp-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill);
  overflow: hidden;
}

[data-dsh-harness-panel] .dhp-row {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

[data-dsh-harness-panel] .dhp-rows > .dhp-row:first-child {
  border-top: 0;
}

[data-dsh-harness-panel] .dhp-row-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 12px;
}

@media (hover: hover) {
  [data-dsh-harness-panel] .dhp-row-head:hover,
  [data-dsh-harness-panel] .dhp-row[data-open='true'] > .dhp-row-head {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

/* The expansion target is its own button; the switch is a sibling, never a
   nested button, so keyboard focus and activation stay two distinct stops. */
[data-dsh-harness-panel] .dhp-row-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

[data-dsh-harness-panel] .dhp-row-toggle {
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

[data-dsh-harness-panel] .dhp-row-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 3px;
  border-radius: var(--dsw-radius-xs);
}

[data-dsh-harness-panel] .dhp-row-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

[data-dsh-harness-panel] .dhp-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}

[data-dsh-harness-panel] .dhp-row-title[data-mono='true'] {
  font-family: var(--ds-font-family-code);
  font-size: 12.5px;
}

[data-dsh-harness-panel] .dhp-row-sub {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-harness-panel] .dhp-row-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}

[data-dsh-harness-panel] .dhp-row-end {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

/* A row whose subject is switched off dims its title only. */
[data-dsh-harness-panel] .dhp-row[data-off='true'] .dhp-row-title {
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-harness-panel] .dhp-row-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 10px 12px;
  background: var(--dsw-alias-bg-module-platform);
}

[data-dsh-harness-panel] .dhp-chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transform: rotate(-90deg);
}

[data-dsh-harness-panel] .dhp-row[data-open='true'] .dhp-chevron {
  transform: none;
}

/* Definition lists: 11px label column, 12px value column. */

[data-dsh-harness-panel] .dhp-facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 3px 12px;
  margin: 0;
  font-size: 12px;
  line-height: 17px;
}

[data-dsh-harness-panel] .dhp-facts dt {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 17px;
}

[data-dsh-harness-panel] .dhp-facts dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
}

/* Status: a dot plus a word. Color never carries the only signal. */

[data-dsh-harness-panel] .dhp-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}

[data-dsh-harness-panel] .dhp-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary);
  opacity: 0.75;
}

[data-dsh-harness-panel] .dhp-state[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary));
}

[data-dsh-harness-panel] .dhp-state[data-tone='warn'] .dhp-dot {
  background: var(--dsw-alias-state-warn-primary);
  opacity: 1;
}

[data-dsh-harness-panel] .dhp-state[data-tone='error'] {
  color: var(--dsw-alias-state-error-primary);
}

[data-dsh-harness-panel] .dhp-state[data-tone='error'] .dhp-dot {
  background: currentColor;
  opacity: 1;
}

[data-dsh-harness-panel] .dhp-state[data-tone='muted'] {
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-harness-panel] .dhp-state[data-tone='muted'] .dhp-dot {
  box-sizing: border-box;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l4);
  opacity: 1;
}

/* Micro tags: a hairline box, no fill, no tint. */

[data-dsh-harness-panel] .dhp-tag {
  display: inline-flex;
  align-items: center;
  flex: none;
  max-width: 100%;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  padding: 0 5px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

[data-dsh-harness-panel] .dhp-tag[data-tone='accent'] {
  border-color: var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-harness-panel] .dhp-tag[data-tone='warn'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent);
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary));
}

[data-dsh-harness-panel] .dhp-tag[data-tone='error'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

/* Notes: a 2px rule and plain text. No tinted boxes. */

[data-dsh-harness-panel] .dhp-note {
  margin: 0;
  border-left: 2px solid var(--dsw-alias-border-l3);
  padding-left: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

[data-dsh-harness-panel] .dhp-note[data-tone='warn'] {
  border-left-color: var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary));
}

[data-dsh-harness-panel] .dhp-note[data-tone='error'] {
  border-left-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}

[data-dsh-harness-panel] .dhp-hint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

[data-dsh-harness-panel] .dhp-hint .dhp-code {
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-harness-panel] .dhp-error {
  margin: 0;
  border-left: 2px solid var(--dsw-alias-state-error-primary);
  padding-left: 8px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

/* Code-ish inline text (paths, commands, identifiers). */

[data-dsh-harness-panel] .dhp-code {
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
  line-height: 17px;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

/* Empty and loading states. */

[data-dsh-harness-panel] .dhp-empty {
  margin: 0;
  padding: 6px 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-harness-panel] .dhp-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-lg);
  padding: 12px;
  background: var(--dsw-alias-settings-card-fill);
}

[data-dsh-harness-panel] .dhp-skeleton-bar {
  width: 34%;
  height: 11px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-bg-skeleton);
}

[data-dsh-harness-panel] .dhp-skeleton-bar + .dhp-skeleton-bar {
  width: 62%;
}

[data-dsh-harness-panel] .dhp-skeleton-bar + .dhp-skeleton-bar + .dhp-skeleton-bar {
  width: 46%;
}

/* Search field: the shipped Input atom, full width. */

[data-dsh-harness-panel] .dhp-search {
  width: 100%;
}

[data-dsh-harness-panel] .dhp-copy {
  flex: none;
}

[data-dsh-harness-panel] .dhp-time {
  cursor: help;
}

/* A path and its copy control sit together; the path shrinks, the control does not. */
[data-dsh-harness-panel] .dhp-pathrow {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

[data-dsh-harness-panel] .dhp-pathrow > .dhp-row-sub {
  flex: 0 1 auto;
  min-width: 0;
}

/* Tool rows inside an expanded server row: name, then a one-line summary. */

[data-dsh-harness-panel] .dhp-tools {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

[data-dsh-harness-panel] .dhp-tool {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
}

[data-dsh-harness-panel] .dhp-tool-name {
  flex: none;
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
  line-height: 17px;
  overflow-wrap: anywhere;
}

[data-dsh-harness-panel] .dhp-tool-desc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  line-height: 17px;
}

/* Hook groups inside an expanded bridge row. */

[data-dsh-harness-panel] .dhp-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

[data-dsh-harness-panel] .dhp-group + .dhp-group {
  padding-top: 2px;
}

[data-dsh-harness-panel] .dhp-group-title {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
}

[data-dsh-harness-panel] .dhp-group-sub {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 17px;
}

[data-dsh-harness-panel] .dhp-hook-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

[data-dsh-harness-panel] .dhp-hook-cmd {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
  line-height: 17px;
  overflow-wrap: anywhere;
}

[data-dsh-harness-panel] .dhp-hook-cmd[data-off='true'] {
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through;
}

/* Inline editor for instruction files. */

[data-dsh-harness-panel] .dhp-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 10px 12px;
  background: var(--dsw-alias-bg-module-platform);
}

[data-dsh-harness-panel] .dhp-editor-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  flex-wrap: wrap;
}

[data-dsh-harness-panel] .dhp-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 180px;
  resize: vertical;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  padding: 8px 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-harness-panel] .dhp-textarea:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}

[data-dsh-harness-panel] .dhp-md {
  box-sizing: border-box;
  min-height: 240px;
  max-height: 420px;
  overflow: auto;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  padding: 10px 12px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 13px;
  line-height: 20px;
}

[data-dsh-harness-panel] .dhp-editor-meta {
  min-width: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  line-height: 17px;
  overflow-wrap: anywhere;
}

[data-dsh-harness-panel] .dhp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 4px;
}

[data-dsh-harness-panel] .dhp-disclosure {
  min-width: 0;
}

[data-dsh-harness-panel] .dhp-disclosure > summary {
  cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-harness-panel] .dhp-disclosure > summary:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
  border-radius: var(--dsw-radius-xs);
}

[data-dsh-harness-panel] .dhp-pre {
  margin: 8px 0 0;
  max-height: 380px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}

/* Overview status board: four subsystems, one row each, columns aligned.
   A row is the navigation target — there is no separate "open" control. */

[data-dsh-harness-panel] .dhp-board,
[data-dsh-harness-panel] .dhp-board-head,
[data-dsh-harness-panel] .dhp-board-row {
  --dhp-board-cols: 104px 84px minmax(0, 1fr);
}

[data-dsh-harness-panel] .dhp-board {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-settings-card-fill);
  overflow: hidden;
}

[data-dsh-harness-panel] .dhp-board-head {
  display: grid;
  grid-template-columns: var(--dhp-board-cols);
  gap: 0 12px;
  padding: 6px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

[data-dsh-harness-panel] .dhp-board-row {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: var(--dhp-board-cols);
  align-items: start;
  gap: 0 12px;
  width: 100%;
  border: 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 9px 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

[data-dsh-harness-panel] .dhp-board-list {
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}

[data-dsh-harness-panel] .dhp-board-list > li:first-child .dhp-board-row {
  border-top: 0;
}

[data-dsh-harness-panel] .dhp-board-row:active {
  background: var(--dsw-alias-interactive-bg-active);
}

@media (hover: hover) {
  [data-dsh-harness-panel] .dhp-board-row:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

[data-dsh-harness-panel] .dhp-board-row:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}

[data-dsh-harness-panel] .dhp-board-name {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}

[data-dsh-harness-panel] .dhp-board-count {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  font-weight: 400;
}

[data-dsh-harness-panel] .dhp-board-state {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 20px;
}

[data-dsh-harness-panel] .dhp-board-metrics {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 20px;
  overflow-wrap: anywhere;
}

[data-dsh-harness-panel] .dhp-board-findings {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding-top: 3px;
}

[data-dsh-harness-panel] .dhp-finding {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-align: left;
}

[data-dsh-harness-panel] .dhp-finding::before {
  flex: none;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.55;
  content: '';
}

[data-dsh-harness-panel] .dhp-finding[data-severity='warn']::before {
  background: var(--dsw-alias-state-warn-primary);
  opacity: 1;
}

[data-dsh-harness-panel] .dhp-finding[data-severity='error']::before {
  background: var(--dsw-alias-state-error-primary);
  opacity: 1;
}

/* The dot carries the severity; the words stay neutral so a row with three
   findings does not paint half the table red. */
[data-dsh-harness-panel] .dhp-finding-label {
  flex: none;
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-harness-panel] .dhp-finding-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code);
  font-size: 11.5px;
}

[data-dsh-harness-panel] .dhp-finding-more {
  margin: 0;
  padding-left: 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11.5px;
  line-height: 18px;
}

/* Budget gauge: a 2px rule, drawn only when the budget is actually tight. */

[data-dsh-harness-panel] .dhp-budget {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 220px;
  padding-top: 1px;
}

[data-dsh-harness-panel] .dhp-budget-track {
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
}

[data-dsh-harness-panel] .dhp-budget-fill {
  display: block;
  height: 100%;
  background: var(--dsw-alias-state-business-primary);
}

[data-dsh-harness-panel] .dhp-budget-fill[data-hot='true'] {
  background: var(--dsw-alias-state-warn-primary);
}

@media (max-width: 620px) {
  [data-dsh-harness-panel] .dhp-board,
  [data-dsh-harness-panel] .dhp-board-head,
  [data-dsh-harness-panel] .dhp-board-row {
    --dhp-board-cols: minmax(0, 1fr) 84px;
  }

  [data-dsh-harness-panel] .dhp-board-head > :last-child {
    display: none;
  }

  [data-dsh-harness-panel] .dhp-board-metrics {
    grid-column: 1 / -1;
    padding-top: 2px;
  }
}

@media (prefers-reduced-motion: no-preference) {
  [data-dsh-harness-panel] .dhp-chevron {
    transition: transform 140ms var(--ds-ease-in-out);
  }

  [data-dsh-harness-panel] .dhp-skeleton-bar {
    animation: dhp-skeleton-pulse 2s cubic-bezier(0.36, 0, 0.64, 1) infinite;
  }
}

@keyframes dhp-skeleton-pulse {
  0% { opacity: 1; }
  40% { opacity: 0.55; }
  80%, 100% { opacity: 1; }
}
`;
