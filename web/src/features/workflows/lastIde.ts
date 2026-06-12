const STORAGE_KEY = 'wfr.lastIde'
const DEFAULT_IDE = 'claude-code'

/** Last IDE the user selected in the step editor, or the default. */
export function readLastIde(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return stored
  } catch {
    // localStorage may be unavailable — fall through to default.
  }
  return DEFAULT_IDE
}

/** Persist the user's IDE choice (best-effort). */
export function writeLastIde(ide: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, ide)
  } catch {
    // Persistence is best-effort; ignore failures.
  }
}
