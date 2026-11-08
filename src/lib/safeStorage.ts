// Safe storage wrapper — never throws, even when localStorage is blocked
// (restricted iframe, in-app browser, privacy mode, cross-origin, etc.)

function isStorageAvailable(): boolean {
  try {
    const test = '__storage_test__'
    window.localStorage.setItem(test, '1')
    window.localStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

const available = isStorageAvailable()

const memoryFallback = new Map<string, string>()

export const safeStorage = {
  getItem(key: string): string | null {
    if (available) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    }
    return memoryFallback.get(key) ?? null
  },

  setItem(key: string, value: string): void {
    if (available) {
      try {
        window.localStorage.setItem(key, value)
        return
      } catch {
        // fall through to memory
      }
    }
    memoryFallback.set(key, value)
  },

  removeItem(key: string): void {
    if (available) {
      try {
        window.localStorage.removeItem(key)
        return
      } catch {
        // fall through to memory
      }
    }
    memoryFallback.delete(key)
  },
}
