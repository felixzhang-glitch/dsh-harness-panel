/**
 * Small shared controls over the shipped primitives: the refresh button every
 * page toolbar carries, an icon-only copy button with its own success tick,
 * and a relative timestamp whose tooltip keeps the absolute reading.
 *
 * @module dsh-harness-panel/client/controls
 */

import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  IconRefreshOutlineRegular,
  Tooltip,
  relativeTime,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fill, formatTime, type Translate } from './shared.ts'
import { relativeTimeLabel } from './time-format.ts'

/** The toolbar refresh button, native atom with the refresh glyph. */
export function RefreshButton({ t, busy, onClick }: {
  readonly t: Translate
  readonly busy: boolean
  readonly onClick: () => void
}): JSX.Element {
  return (
    <Button size="sm" icon={<IconRefreshOutlineRegular />} disabled={busy} onClick={onClick}>
      {busy ? t('refreshing') : t('refresh')}
    </Button>
  )
}

/**
 * Icon-only copy button. A successful write flips the glyph to a check for
 * 1.5s; a refused write leaves the glyph alone (the host clipboard, not the
 * panel, owns that failure).
 */
export function CopyButton({ text, label }: {
  readonly text: string
  readonly label: string
}): JSX.Element {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  const onClick = (): void => {
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setDone(true)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => { setDone(false) }, 1500)
    })
  }
  return (
    <Tooltip label={label} side="top">
      <Button
        size="sm"
        className="dhp-copy"
        aria-label={label}
        icon={done ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        onClick={onClick}
      />
    </Tooltip>
  )
}

/**
 * One relative timestamp ("3 分钟前") with the absolute reading in a tooltip.
 * The bucket refreshes whenever the owning page rerenders; the tooltip keeps
 * the exact moment for anyone who needs it.
 */
export function TimeLabel({ at, t }: { readonly at: number; readonly t: Translate }): JSX.Element {
  const bucket = relativeTimeLabel(relativeTime(at, Date.now()))
  const absolute = formatTime(at) ?? ''
  return (
    <Tooltip label={absolute} side="top">
      <span className="dhp-time">{fill(t(bucket.key), { n: bucket.n })}</span>
    </Tooltip>
  )
}
