import { useEffect, useRef, useCallback } from 'react'

export function usePollingUpdate(
  fetchFn: () => Promise<void>,
  interval = 3000,
  enabled = true
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const poll = useCallback(async () => {
    if (!mountedRef.current) return
    try {
      await fetchFn()
    } catch {
      // silent – polling should not break the UI
    }
    if (mountedRef.current && enabled) {
      timerRef.current = setTimeout(poll, interval)
    }
  }, [fetchFn, interval, enabled])

  useEffect(() => {
    mountedRef.current = true
    if (enabled) poll()
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [poll, enabled])
}
