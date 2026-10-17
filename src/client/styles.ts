/**
 * Scoped stylesheet for the Harness section. Standalone client bundles cannot
 * use the in-repo CSS-module pipeline, so the sheet ships as a string and is
 * installed effect-scoped into one `<style data-dsh-harness-panel>` element.
 * Every selector is scoped under `[data-dsh-harness-panel]` and uses theme
 * design tokens only, so it follows both color schemes.
 *
 * Geometry follows the shipped settings sections: 0.5px hairline borders,
 * `--dsw-radius-*` corners (cards xl, controls md/sm), 13px base text with
 * 12px tertiary captions, and the native underline tab strip.
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
const PANEL_CSS = `
[data-dsh-harness-panel] {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}
[data-dsh-harness-panel] .dhp-heading {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
[data-dsh-harness-panel] .dhp-intro {
  margin: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
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
[data-dsh-harness-panel] .dhp-tab:hover,
[data-dsh-harness-panel] .dhp-tab[data-active='true'] {
  color: var(--dsw-alias-label-primary);
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
[data-dsh-harness-panel] .dhp-panel {
  min-width: 0;
  padding-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* Author display rules beat the hidden attribute's UA rule; restore it so
   only the selected tab panel is visible (visited panels stay mounted). */
[data-dsh-harness-panel] .dhp-panel[hidden] {
  display: none;
}

/* Toolbar row (count summary + refresh). */
[data-dsh-harness-panel] .dhp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
[data-dsh-harness-panel] .dhp-sub {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

/* Buttons: the native quiet pill (module-platform fill, md radius). */
[data-dsh-harness-panel] .dhp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  padding: 5px 12px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  flex: none;
}
[data-dsh-harness-panel] .dhp-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-dsh-harness-panel] .dhp-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
[data-dsh-harness-panel] .dhp-btn:disabled:hover {
  background: var(--dsw-alias-bg-module-platform);
}
[data-dsh-harness-panel] .dhp-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

/* Search input: mirrors the native config field geometry. */
[data-dsh-harness-panel] .dhp-search {
  box-sizing: border-box;
  width: 100%;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  padding: 6px 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
[data-dsh-harness-panel] .dhp-search::placeholder {
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-harness-panel] .dhp-search:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}

/* Cards: the native settings card — hairline stroke, xl radius, layer-2 fill. */
[data-dsh-harness-panel] .dhp-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
[data-dsh-harness-panel] .dhp-card {
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
  overflow: hidden;
}
[data-dsh-harness-panel] .dhp-card[data-open='true'] {
  border-color: var(--dsw-alias-border-l3);
}
[data-dsh-harness-panel] .dhp-card-head {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
}
[data-dsh-harness-panel] .dhp-card-head:hover,
[data-dsh-harness-panel] .dhp-card[data-open='true'] > .dhp-card-head {
  background: var(--dsw-alias-interactive-bg-hover);
}
/* The expansion target is its own button; the switch is a sibling, never a
   nested button, so keyboard focus and activation stay two distinct stops. */
[data-dsh-harness-panel] .dhp-card-toggle {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
[data-dsh-harness-panel] .dhp-card-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 4px;
  border-radius: var(--dsw-radius-md);
}
[data-dsh-harness-panel] .dhp-card-switch {
  display: flex;
  align-items: center;
  flex: none;
}
[data-dsh-harness-panel] .dhp-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
[data-dsh-harness-panel] .dhp-card-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}
[data-dsh-harness-panel] .dhp-card-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
[data-dsh-harness-panel] .dhp-card-trailing {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
[data-dsh-harness-panel] .dhp-card-details {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Definition list inside expanded cards. */
[data-dsh-harness-panel] .dhp-details {
  margin: 0;
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  font-size: 12px;
  line-height: 18px;
}
[data-dsh-harness-panel] .dhp-details dt {
  color: var(--dsw-alias-label-tertiary);
}
[data-dsh-harness-panel] .dhp-details dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary);
}

/* Status badges: soft tinted pills, native state palette. */
[data-dsh-harness-panel] .dhp-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  flex: none;
}
[data-dsh-harness-panel] .dhp-badge[data-tone='ok'] {
  color: var(--dsw-alias-state-success-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
}
[data-dsh-harness-panel] .dhp-badge[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
}
[data-dsh-harness-panel] .dhp-badge[data-tone='error'] {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
}
[data-dsh-harness-panel] .dhp-badge[data-tone='muted'] {
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-dsh-harness-panel] .dhp-badge[data-tone='accent'] {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
}
[data-dsh-harness-panel] .dhp-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}

/* Tool rows inside an expanded server card. */
[data-dsh-harness-panel] .dhp-tools {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
[data-dsh-harness-panel] .dhp-tool {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 2px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
[data-dsh-harness-panel] .dhp-tool:last-child {
  border-bottom: 0;
}
[data-dsh-harness-panel] .dhp-tool-name {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
[data-dsh-harness-panel] .dhp-tool-desc {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

/* Code-ish inline text (paths, commands). */
[data-dsh-harness-panel] .dhp-code {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  overflow-wrap: anywhere;
}

/* Skill list rows. */
[data-dsh-harness-panel] .dhp-skill {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
[data-dsh-harness-panel] .dhp-skill:last-child {
  border-bottom: 0;
}
[data-dsh-harness-panel] .dhp-skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
[data-dsh-harness-panel] .dhp-skill-name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  font-size: 13px;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-harness-panel] .dhp-skill-trailing {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
[data-dsh-harness-panel] .dhp-skill[data-disabled='true'] .dhp-skill-name {
  color: var(--dsw-alias-label-tertiary);
}

/* Hook groups. */
[data-dsh-harness-panel] .dhp-hook-group {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
[data-dsh-harness-panel] .dhp-hook-cmd {
  font-family: var(--ds-font-family-code);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary);
}

/* Group subheadings inside a page. */
[data-dsh-harness-panel] .dhp-group-title {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}

/* Error and hint notes. */
[data-dsh-harness-panel] .dhp-error {
  margin: 0;
  border-radius: var(--dsw-radius-lg);
  padding: 8px 10px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
[data-dsh-harness-panel] .dhp-hint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

/* Empty / loading states. */
[data-dsh-harness-panel] .dhp-state {
  color: var(--dsw-alias-label-tertiary);
  padding: 32px 0;
  text-align: center;
  font-size: 13px;
}
[data-dsh-harness-panel] .dhp-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  padding: 15px 14px;
  background: var(--dsw-alias-settings-card-fill);
}
[data-dsh-harness-panel] .dhp-skeleton-bar {
  width: 40%;
  height: 14px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-bg-skeleton);
}
[data-dsh-harness-panel] .dhp-skeleton-bar + .dhp-skeleton-bar {
  width: 80%;
  height: 12px;
}
`
