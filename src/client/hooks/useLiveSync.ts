import { useEffect, useRef, useState, useCallback } from 'react';
import { getTabClientId } from '../utils/tabId';

export interface UseLiveSyncOptions {
  enabled?: boolean;
  onSync?: () => void;
  onAuthError?: () => void;
  tabId?: string;
}

export interface UseLiveSyncReturn {
  isConnected: boolean;
  isFallback: boolean;
  reconnect: () => void;
}

export function useLiveSync({
  enabled = true,
  onSync,
  onAuthError,
  tabId: propTabId,
}: UseLiveSyncOptions = {}): UseLiveSyncReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  const tabId = propTabId || (typeof window !== 'undefined' ? getTabClientId() : '');

  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;

  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;

  const isMountedRef = useRef(false);
  const stoppedRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);
  const consecutiveErrorsRef = useRef(0);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounce = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  const triggerSyncDebounced = useCallback(() => {
    clearDebounce();
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      if (!stoppedRef.current && isMountedRef.current) {
        onSyncRef.current?.();
      }
    }, 300);
  }, []);

  const stopFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }
    if (isMountedRef.current) {
      setIsFallback(false);
    }
  }, []);

  const startFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) return;
    if (isMountedRef.current) {
      setIsFallback(true);
    }
    fallbackIntervalRef.current = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        !document.hidden &&
        (typeof navigator === 'undefined' || navigator.onLine) &&
        !stoppedRef.current &&
        isMountedRef.current
      ) {
        onSyncRef.current?.();
      }
    }, 30000);
  }, []);

  const closeEventSource = useCallback(() => {
    if (esRef.current) {
      try {
        esRef.current.close();
      } catch (_) {
        // ignore
      }
      esRef.current = null;
    }
    if (isMountedRef.current) {
      setIsConnected(false);
    }
  }, []);

  const stopAll = useCallback(() => {
    stoppedRef.current = true;
    closeEventSource();
    stopFallbackPolling();
    clearDebounce();
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, [closeEventSource, stopFallbackPolling]);

  const handleAuthFailure = useCallback(() => {
    stopAll();
    onAuthErrorRef.current?.();
  }, [stopAll]);

  const connect = useCallback(() => {
    if (!enabled || stoppedRef.current || !isMountedRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    // Clean up any existing connection first
    closeEventSource();

    if (typeof EventSource === 'undefined') {
      startFallbackPolling();
      return;
    }

    const url = `/api/v1/events?clientId=${encodeURIComponent(tabId)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      if (!isMountedRef.current || stoppedRef.current) {
        es.close();
        return;
      }
      consecutiveErrorsRef.current = 0;
      setIsConnected(true);
      stopFallbackPolling();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };

    es.onmessage = (event: MessageEvent) => {
      if (!isMountedRef.current || stoppedRef.current) return;

      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.origin && tabId && payload.origin === tabId) {
          // Ignore own-tab mutation
          return;
        }
      } catch (_) {
        // Ping or non-JSON comments are ignored
      }

      triggerSyncDebounced();
    };

    es.addEventListener('replaced', () => {
      // Replaced due to stream cap on server:
      // Stay closed for 60s with fallback polling, then retry
      closeEventSource();
      startFallbackPolling();
      if (!retryTimeoutRef.current) {
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          if (isMountedRef.current && !stoppedRef.current) {
            connect();
          }
        }, 60000);
      }
    });

    es.onerror = (err: Event) => {
      if (!isMountedRef.current || stoppedRef.current) return;

      // Check if this error object directly provides a 401/403 status (e.g. in test environments)
      const directStatus = (err as any)?.status || (es as any)?.status;
      if (directStatus === 401 || directStatus === 403) {
        handleAuthFailure();
        return;
      }

      consecutiveErrorsRef.current += 1;
      setIsConnected(false);

      if (consecutiveErrorsRef.current >= 3) {
        closeEventSource();
        startFallbackPolling();
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
      }

      const scheduleRetry = () => {
        const backoffDelay = consecutiveErrorsRef.current >= 3
          ? 60000
          : Math.min(1000 * Math.pow(2, consecutiveErrorsRef.current - 1), 60000);

        if (!retryTimeoutRef.current) {
          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            if (isMountedRef.current && !stoppedRef.current) {
              connect();
            }
          }, backoffDelay);
        }
      };

      scheduleRetry();

      // In standard browsers EventSource onerror carries no status code,
      // so call /api/v1/auth/me to check if session expired
      if (typeof fetch === 'function') {
        fetch('/api/v1/auth/me')
          .then(async (res) => {
            if (!isMountedRef.current || stoppedRef.current) return;
            if (res.status === 401 || res.status === 403) {
              handleAuthFailure();
              return;
            }
            if (res.ok) {
              try {
                const data = await res.json();
                if (data.user?.accountStatus === 'pending_verification') {
                  stoppedRef.current = true;
                  closeEventSource();
                  stopFallbackPolling();
                }
              } catch (e) {
                // ignore JSON parse errors
              }
            }
          })
          .catch(() => {
            // Network error / offline, retry is already scheduled
          });
      }
    };
  }, [
    enabled,
    tabId,
    closeEventSource,
    startFallbackPolling,
    stopFallbackPolling,
    triggerSyncDebounced,
    handleAuthFailure,
  ]);

  const reconnect = useCallback(() => {
    consecutiveErrorsRef.current = 0;
    stoppedRef.current = false;
    connect();
  }, [connect]);

  useEffect(() => {
    isMountedRef.current = true;
    stoppedRef.current = false;

    if (enabled) {
      connect();
    }

    const handleVisibleOrOnline = () => {
      if (typeof document !== 'undefined' && !document.hidden && (typeof navigator === 'undefined' || navigator.onLine)) {
        if (!stoppedRef.current) {
          // If disconnected, reconnect
          if (!esRef.current || esRef.current.readyState === 2) {
            connect();
          }
          // Catch-up refetch when tab becomes visible or comes back online
          onSyncRef.current?.();
        }
      }
    };

    const handleHiddenOrOffline = () => {
      closeEventSource();
      clearDebounce();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          handleHiddenOrOffline();
        } else {
          handleVisibleOrOnline();
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleVisibleOrOnline);
      window.addEventListener('pageshow', handleVisibleOrOnline);
      window.addEventListener('offline', handleHiddenOrOffline);
      window.addEventListener('pagehide', handleHiddenOrOffline);
    }

    return () => {
      isMountedRef.current = false;
      stopAll();

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibleOrOnline);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleVisibleOrOnline);
        window.removeEventListener('pageshow', handleVisibleOrOnline);
        window.removeEventListener('offline', handleHiddenOrOffline);
        window.removeEventListener('pagehide', handleHiddenOrOffline);
      }
    };
  }, [enabled, connect, closeEventSource, stopAll]);

  return {
    isConnected,
    isFallback,
    reconnect,
  };
}
