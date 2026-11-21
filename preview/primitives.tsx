/**
 * Preview-only stand-in for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The real package ships CSS modules that only resolve inside the shell's
 * bundler; the preview harness swaps it for these atoms, which reproduce the
 * shipped geometry (28px small buttons, 36x20 switches, 32px input, 24px
 * pills) from the same design tokens. Nothing here ships in the plugin.
 */

import type { CSSProperties, ReactNode } from 'react'

/** One icon glyph: a 16px box drawing a single path in currentColor. */
function glyph(path: ReactNode, viewBox = '0 0 16 16') {
  return function Icon({ size = 16, className }: { size?: number; className?: string }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {path}
      </svg>
    )
  }
}

export const IconChevronDownOutlineRegular = glyph(<path d="M4 6.25 8 10.25 12 6.25" />)
export const IconChevronRightOutlineRegular = glyph(<path d="M6.25 4 10.25 8 6.25 12" />)
export const IconGlobeOutlineRegular = glyph(<><circle cx="8" cy="8" r="5.6" /><path d="M2.6 8h10.8M8 2.4c1.7 1.6 2.5 3.5 2.5 5.6S9.7 12 8 13.6C6.3 12 5.5 10.1 5.5 8S6.3 4 8 2.4Z" /></>)
export const IconSearchOutlineRegular = glyph(<><circle cx="7.2" cy="7.2" r="4.4" /><path d="M10.5 10.5 13.4 13.4" /></>)
export const IconCheckOutlineRegular = glyph(<path d="M3.4 8.4 6.4 11.3 12.6 4.9" />)
export const IconCopyOutlineRegular = glyph(<><rect x="5.4" y="5.4" width="7.6" height="7.6" rx="1.6" /><path d="M10.6 5.4V4.2c0-.9-.7-1.6-1.6-1.6H4.2c-.9 0-1.6.7-1.6 1.6v4.8c0 .9.7 1.6 1.6 1.6h1.2" /></>)
export const IconRefreshOutlineRegular = glyph(<><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75" /><path d="M13.4 2.6v3.2h-3.2" /></>)
export const IconWarningTriangleOutlineRegular = glyph(<><path d="M8 2.9 14 13H2L8 2.9Z" /><path d="M8 6.6v3.1M8 11.4v.1" /></>)

const buttonBase: CSSProperties = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  height: 28,
  padding: '0 10px',
  border: 'none',
  borderRadius: 'var(--dsw-radius-sm)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
}

/** The shipped Button atom, small size, ghost/primary variants. */
export function Button({ variant = 'ghost', size = 'md', icon, className, children, ...rest }: {
  variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
  size?: 'md' | 'sm'
  icon?: ReactNode
  className?: string
  children?: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const style: CSSProperties = {
    ...buttonBase,
    ...size === 'md' ? { height: 36, borderRadius: 'var(--dsw-radius-md)', fontSize: 14, lineHeight: '22px', padding: '0 14px' } : {},
    ...variant === 'primary' ? { background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)' } : {},
    ...variant === 'outline' ? { border: '0.5px solid var(--dsw-alias-border-l3)' } : {},
    ...rest.disabled === true ? { opacity: 0.4, cursor: 'not-allowed' } : {},
  }
  return (
    <button type="button" {...rest} className={className} style={style}>
      {icon === undefined ? null : <span style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>{icon}</span>}
      {children}
    </button>
  )
}

/** The shipped Switch atom: 36x20 track, 16px thumb, aria-checked drives it. */
export function Switch({ checked, onChange, label, disabled, title, className }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={className}
      onClick={() => { onChange(!checked) }}
      style={{
        boxSizing: 'border-box',
        position: 'relative',
        flex: '0 0 auto',
        width: 36,
        height: 20,
        padding: 2,
        border: 0,
        borderRadius: 999,
        background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l3)',
        cursor: disabled === true ? 'default' : 'pointer',
        opacity: disabled === true ? 0.5 : 1,
      }}
    >
      <span
        style={{
          display: 'block',
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: checked ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-switch-thumb)',
          transform: checked ? 'translateX(16px)' : 'none',
          transition: 'transform 120ms ease',
        }}
      />
    </button>
  )
}

/** The shipped Input atom: 32px, hairline frame, optional leading icon. */
export function Input({ icon, className, ...rest }: {
  icon?: ReactNode
  className?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        boxSizing: 'border-box',
        height: 32,
        padding: '0 8px',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        borderRadius: 'var(--dsw-radius-md)',
        background: 'var(--dsw-alias-bg-layer-1)',
      }}
    >
      {icon === undefined ? null : <span style={{ display: 'inline-flex', width: 16, height: 16, color: 'var(--dsw-alias-label-tertiary)' }}>{icon}</span>}
      <input
        {...rest}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 14,
          lineHeight: '22px',
          color: 'var(--dsw-alias-label-primary)',
          fontFamily: 'inherit',
        }}
      />
    </span>
  )
}

/** The shipped Tooltip: a native title is enough for a static render. */
export function Tooltip({ label, children }: { label: string; side?: string; children: ReactNode }) {
  return <span title={label}>{children}</span>
}

/** The shipped Pill: a 24px capsule, active carries the ghost-active fill. */
export function Pill({ active, className, children, ...rest }: {
  active?: boolean
  className?: string
  children?: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 24,
        padding: '0 8px',
        border: 'none',
        borderRadius: 999,
        font: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        cursor: 'pointer',
        color: active === true ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        background: active === true ? 'var(--dsw-alias-button-ghost-active-fill)' : 'var(--dsw-alias-bg-layer-2)',
      }}
    >
      {children}
    </button>
  )
}

/** The shipped Toast: a floating capsule at the panel's bottom edge. */
export function Toast({ text, onDone, holdMs }: { text: string; tone?: string; icon?: ReactNode; holdMs?: number; onDone: () => void }) {
  if (typeof holdMs === 'number') setTimeout(onDone, holdMs)
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: 'min(560px, 90vw)',
        padding: '8px 14px',
        borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-alias-toast-bg)',
        color: 'var(--dsw-alias-toast-label)',
        fontSize: 12,
        lineHeight: '18px',
      }}
    >
      {text}
    </div>
  )
}

/** The shipped StateDot: an 8px solid dot; semantic only. */
export function StateDot({ state, size }: { state: string; size?: number; className?: string; appearance?: string }) {
  const color = state === 'error'
    ? 'var(--dsw-alias-state-error-primary)'
    : state === 'warning'
      ? 'var(--dsw-alias-state-warn-primary)'
      : state === 'done'
        ? 'var(--dsw-alias-state-success-primary)'
        : 'var(--dsw-alias-state-idle-primary)'
  const edge = size ?? 8
  return <span style={{ display: 'inline-block', width: edge, height: edge, borderRadius: '50%', background: color }} />
}

/** MarkdownText: renders the source as preformatted text in the preview. */
export function MarkdownText({ text }: { text: string; labels?: unknown; variant?: string }) {
  return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{text}</pre>
}

export interface MarkdownLabels {
  readonly code: { readonly copyLabel: string; readonly copiedLabel: string }
  readonly footnotes: string
}

/** Structured relative time, matching the primitives' bucket contract. */
export function relativeTime(at: number, now: number): { unit: 'now' | 'minutes' | 'hours' | 'days'; n: number } {
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  if (minutes < 1) return { unit: 'now', n: 0 }
  if (minutes < 60) return { unit: 'minutes', n: minutes }
  const hours = Math.round(minutes / 60)
  if (hours < 24) return { unit: 'hours', n: hours }
  return { unit: 'days', n: Math.round(hours / 24) }
}

/** Clipboard write: a no-op that always reports success. */
export async function writeClipboard(_text: string): Promise<boolean> {
  return true
}
