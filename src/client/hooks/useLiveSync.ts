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

    es.onerror = (err: Event) => {
      if (!isMountedRef.current || stoppedRef.current) return;

      // Check if this error represents a 401 Unauthorized
      const status = (err as any)?.status || (es as any)?.status;
      if (status === 401 || status === 403) {
        handleAuthFailure();
        return;
      }

      consecutiveErrorsRef.current += 1;
      setIsConnected(false);

      // In browser EventSource, 401 doesn't expose HTTP status on err,
      // so verify auth if error persists
      if (consecutiveErrorsRef.current === 1) {
        fetch('/api/v1/auth/me')
          .then((res) => {
            if (res.status === 401 || res.status === 403) {
              handleAuthFailure();
            }
          })
          .catch(() => {});
      }

      // After 3 consecutive errors, fall back to polling and schedule SSE retry
      if (consecutiveErrorsRef.current >= 3) {
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
