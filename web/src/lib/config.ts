export function getApiBaseUrl(): string {
  const override = (import.meta.env as Record<string, string | undefined>)
    .VITE_API_BASE_URL
  if (override) return override
  // Served from the daemon (single binary): use the page's own origin so the
  // API and WebSocket reach the same host/port the UI was loaded from,
  // regardless of which port the daemon bound.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  // Non-browser fallback (e.g. tooling): the default daemon API port.
  return 'http://127.0.0.1:4517'
}

export const API_BASE_URL = getApiBaseUrl()
