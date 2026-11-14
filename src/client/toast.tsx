/**
 * One transient banner per page, over the shipped Toast atom. A new show
 * replaces the current banner (keyed by sequence so the atom restarts its
 * cycle); the page keeps persistent states — load errors, editor conflicts —
 * inline, where their action buttons live.
 *
 * @module dsh-harness-panel/client/toast
 */

import { useCallback, useRef, useState } from 'react'
import type { JSX } from 'react'
import { IconWarningTriangleOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'

/** Banner flavor: plain notice, green success, amber warning. */
export type ToastKind = 'info' | 'success' | 'warn'

/** One queued banner. */
export interface PanelToastItem {
  readonly id: number
  readonly text: string
  readonly kind: ToastKind
}

/** The page's toast handle: show replaces, dismiss unmounts. */
export interface PanelToastHandle {
  readonly toast: PanelToastItem | null
  show(text: string, kind?: ToastKind): void
  dismiss(): void
}

/** Hold one banner at a time; warnings stay longer because they name a failure. */
export function usePanelToast(): PanelToastHandle {
  const [toast, setToast] = useState<PanelToastItem | null>(null)
  const sequence = useRef(0)
  const show = useCallback((text: string, kind: ToastKind = 'info'): void => {
    sequence.current += 1
    setToast({ id: sequence.current, text, kind })
  }, [])
  const dismiss = useCallback((): void => { setToast(null) }, [])
  return { toast, show, dismiss }
}

/** Render the current banner, or nothing. */
export function PanelToastView({ toast, onDone }: {
  readonly toast: PanelToastItem | null
  readonly onDone: () => void
}): JSX.Element | null {
  if (toast === null) return null
  return (
    <Toast
      key={toast.id}
      text={toast.text}
      {...(toast.kind === 'success' ? { tone: 'success' as const } : {})}
      {...(toast.kind === 'warn' ? { icon: <IconWarningTriangleOutlineRegular /> } : {})}
      holdMs={toast.kind === 'warn' ? 6000 : 3200}
      onDone={onDone}
    />
  )
}
