/**
 * Re-read a page's data when its tab becomes the selected one again. Pages stay
 * mounted across tab switches, so their first load can be seconds or minutes
 * old by the time the tab is reopened; a page that edits state (a switch, a
 * saved file) must not present a stale reading of it.
 *
 * @module dsh-harness-panel/client/use-resume-refresh
 */

import { useEffect, useRef } from 'react'

/**
 * Call `refresh` on each false → true transition of `active`.
 *
 * @param active - whether this page's tab is selected.
 * @param refresh - stable callback that re-reads the page's data.
 */
export function useResumeRefresh(active: boolean, refresh: () => void): void {
  const wasActive = useRef(active)
  useEffect(() => {
    const resumed = active && !wasActive.current
    wasActive.current = active
    if (resumed) refresh()
  }, [active, refresh])
}
