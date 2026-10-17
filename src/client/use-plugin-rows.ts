/**
 * Page-local cache of `pluginManager.listPlugins()`: the addressability and
 * read-only reasons behind every switch. Refetched after a toggle and by the
 * page's refresh action.
 *
 * @module dsh-harness-panel/client/use-plugin-rows
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginInfoFace, PluginManagerRemoteFace } from './plugin-manager.ts'

/** One snapshot of the addressable loader rows. */
export interface PluginRowsState {
  readonly status: 'loading' | 'ready' | 'error'
  readonly rows: readonly PluginInfoFace[]
  /** Host or transport diagnostic when `status` is `error`. */
  readonly message: string | null
}

/** The hook's read face plus its manual reload. */
export interface PluginRowsHandle {
  readonly state: PluginRowsState
  reload(): void
}

const LOADING: PluginRowsState = { status: 'loading', rows: [], message: null }

/**
 * Load the Host's plugin rows and keep the latest successful snapshot.
 *
 * @param pm - `remote.pluginManager`, absent when the namespace is not mounted.
 * @returns the current state and a reload function.
 */
export function usePluginRows(pm: PluginManagerRemoteFace | undefined): PluginRowsHandle {
  const [state, setState] = useState<PluginRowsState>(LOADING)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    if (pm === undefined) {
      setState({ status: 'error', rows: [], message: 'plugin manager unavailable' })
      return
    }
    try {
      const result = await pm.listPlugins()
      if (!mounted.current) return
      if (!result.ok) {
        setState({ status: 'error', rows: [], message: result.error.message || result.error.code })
        return
      }
      setState({ status: 'ready', rows: result.value, message: null })
    } catch (error) {
      if (!mounted.current) return
      setState({
        status: 'error',
        rows: [],
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [pm])

  useEffect(() => { void load() }, [load])

  const reload = useCallback((): void => { void load() }, [load])

  return { state, reload }
}
