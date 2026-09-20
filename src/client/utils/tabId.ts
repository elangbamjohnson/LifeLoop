const SESSION_STORAGE_KEY = 'lifeloop_tab_id';

let memoryFallbackId: string | null = null;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'tab-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
}

export function getTabClientId(): string {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      let id = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!id) {
        id = generateId();
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
      }
      return id;
    } catch (_) {
      // Fall through to memory fallback if sessionStorage is blocked
    }
  }

  if (!memoryFallbackId) {
    memoryFallbackId = generateId();
  }
  return memoryFallbackId;
}
