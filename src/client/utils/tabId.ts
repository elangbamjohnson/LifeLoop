function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'tab-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
}

const tabClientId = generateId();

export function getTabClientId(): string {
  return tabClientId;
}
