export function getApiBaseUrl(): string {
  return (
    (import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL ??
    'http://127.0.0.1:4517'
  )
}

export const API_BASE_URL = getApiBaseUrl()
