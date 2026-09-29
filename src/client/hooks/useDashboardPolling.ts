import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import type { TimelineItem } from "../../shared/utils/timeline";

export interface Capture {
  id: string;
  type: string;
  rawPayload: string;
  originalFilename: string | null;
  processingStatus: "pending" | "processing" | "completed" | "failed" | "fallback_pending_retry";
  metadata?: Record<string, any> | null;
  createdAt: string;
}

/** Return shape is intentionally stable so callers don't need to change. */
export interface DashboardPollingResult {
  captures: Capture[];
  setCaptures: Dispatch<SetStateAction<Capture[]>>;
  items: TimelineItem[];
  setItems: Dispatch<SetStateAction<TimelineItem[]>>;
  loading: boolean;
  error: Error | null;
  authError: boolean;
  refetch: () => void;
}

// Backoff bounds (ms)
const BACKOFF_MIN = 5_000;
const BACKOFF_MAX = 60_000;

function jitter(ms: number): number {
  return ms + Math.random() * ms * 0.25;
}

/**
 * useDashboardPolling
 *
 * Polling strategy:
 * - hasProcessing=true  → repeat every 5 s (chained setTimeout)
 * - hasProcessing=false → no timer; re-fetch on visibilitychange (visible),
 *                         online, and pageshow events
 * - Hidden or offline   → no timers, no fetches
 * - Errors             → exponential back-off 5 s → 60 s (+ jitter), reset on success
 * - 401/403            → stop all timers, set authError=true, call logout if available
 * - Abort              → AbortController per request; stale results are discarded
 * - StrictMode         → cleanup on first unmount cancels any scheduled work
 */
export function useDashboardPolling(
  hasProcessing: boolean,
  onAuthError?: () => void,
): DashboardPollingResult {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [authError, setAuthError] = useState(false);

  // Ref-bag so callbacks close over stable refs without re-creating effects
  const isMounted = useRef(false);
  const hasProcessingRef = useRef(hasProcessing);
  hasProcessingRef.current = hasProcessing;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const backoffRef = useRef(BACKOFF_MIN);
  const stoppedRef = useRef(false); // set on 401/403

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(
    (delayMs: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        doFetch();
      }, delayMs);
    },
    // doFetch is stable (defined with useCallback below); add after.
    // Linter disabled: forward reference is safe because scheduleNext is
    // called only after doFetch is defined.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearTimer],
  );

  const doFetch = useCallback(async () => {
    if (stoppedRef.current) return;
    if (!isMounted.current) return;
    if (document.hidden || !navigator.onLine) return;

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const [capRes, itemRes] = await Promise.all([
        fetch("/api/v1/captures", { signal: ac.signal }),
        fetch("/api/v1/items", { signal: ac.signal }),
      ]);

      // Check for auth error first
      if (capRes.status === 401 || capRes.status === 403 ||
          itemRes.status === 401 || itemRes.status === 403) {
        if (!isMounted.current) return;
        stoppedRef.current = true;
        clearTimer();
        setAuthError(true);
        onAuthError?.();
        return;
      }

      // Discard if a newer request is already in flight
      if (ac.signal.aborted) return;
      if (!isMounted.current) return;

      if (capRes.ok) {
        const data = await capRes.json();
        if (!ac.signal.aborted && isMounted.current)
          setCaptures(data.captures || []);
      }
      if (itemRes.ok) {
        const data = await itemRes.json();
        if (!ac.signal.aborted && isMounted.current) {
          const rawItems = (data.items || []).map((i: any) => ({
            ...i,
            dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : null,
            snoozedUntil: i.snoozedUntil
              ? new Date(i.snoozedUntil).toISOString()
              : null,
            completedAt: i.completedAt
              ? new Date(i.completedAt).toISOString()
              : null,
            createdAt: new Date(i.createdAt).toISOString(),
          }));
          setItems(rawItems);
        }
      }

      // Success: reset backoff
      backoffRef.current = BACKOFF_MIN;
      if (isMounted.current) setError(null);

      // Schedule next poll only when hasProcessing
      if (hasProcessingRef.current && isMounted.current && !stoppedRef.current) {
        scheduleNext(5_000);
      }
    } catch (e) {
      if ((e as any)?.name === "AbortError") return; // intentional abort
      if (!isMounted.current) return;

      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      setLoading(false);

      // Backoff then retry
      const delay = jitter(backoffRef.current);
      backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX);
      scheduleNext(delay);
      return;
    }

    if (isMounted.current) setLoading(false);
  }, [clearTimer, scheduleNext, onAuthError]);

  // Attach scheduleNext → doFetch back-reference after doFetch is defined.
  // (The `scheduleNext` memoised above closes over `doFetch` via the callback
  //  body, which captures it through the closure at call time — safe.)

  // Manual refetch exposed to callers
  const refetch = useCallback(() => {
    clearTimer();
    doFetch();
  }, [clearTimer, doFetch]);

  useEffect(() => {
    isMounted.current = true;
    stoppedRef.current = false;

    // Initial fetch
    doFetch();

    // Passive triggers (no timer overhead when idle)
    const onVisible = () => {
      if (!document.hidden && navigator.onLine && !stoppedRef.current)
        doFetch();
    };
    const onOnline = () => {
      if (!document.hidden && !stoppedRef.current) doFetch();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onVisible);

    return () => {
      isMounted.current = false;
      clearTimer();
      if (abortRef.current) abortRef.current.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // intentionally empty: doFetch/clearTimer are stable refs

  // React to hasProcessing changing from false → true: kick off polling
  useEffect(() => {
    if (hasProcessing && isMounted.current && !stoppedRef.current) {
      clearTimer();
      scheduleNext(5_000);
    } else if (!hasProcessing) {
      clearTimer();
    }
  }, [hasProcessing, clearTimer, scheduleNext]);

  return {
    captures,
    setCaptures,
    items,
    setItems,
    loading,
    error,
    authError,
    refetch,
  };
}
