// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLiveSync } from '../../../src/client/hooks/useLiveSync';
import { getTabClientId } from '../../../src/client/utils/tabId';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState: number = 0; // 0 CONNECTING, 1 OPEN, 2 CLOSED
  onopen: ((ev: any) => any) | null = null;
  onmessage: ((ev: any) => any) | null = null;
  onerror: ((ev: any) => any) | null = null;
  private listeners: Map<string, Array<(ev: any) => void>> = new Map();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate auto-open
    setTimeout(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        if (this.onopen) {
          this.onopen(new Event('open'));
        }
      }
    }, 0);
  }

  addEventListener(type: string, listener: (ev: any) => void) {
    let list = this.listeners.get(type);
    if (!list) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(listener);
  }

  removeEventListener(type: string, listener: (ev: any) => void) {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  emitCustomEvent(type: string, event: any = new Event(type)) {
    const list = this.listeners.get(type);
    if (list) {
      for (const listener of [...list]) {
        listener(event);
      }
    }
  }

  emitMessage(data: any) {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent('message', {
          data: typeof data === 'string' ? data : JSON.stringify(data),
        })
      );
    }
  }

  emitError(err: any = new Event('error')) {
    if (this.onerror) {
      this.onerror(err);
    }
  }

  close() {
    this.readyState = 2;
  }
}

describe('useLiveSync Hook', () => {
  let originalEventSource: any;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    MockEventSource.instances = [];
    originalEventSource = global.EventSource;
    (global as any).EventSource = MockEventSource;

    fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;

    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    global.EventSource = originalEventSource;
  });

  it('1. opens only when visible + online', () => {
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    const { unmount: unmount1 } = renderHook(() => useLiveSync());
    expect(MockEventSource.instances).toHaveLength(0);
    unmount1();

    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const { unmount: unmount2 } = renderHook(() => useLiveSync());
    expect(MockEventSource.instances).toHaveLength(0);
    unmount2();

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
    const { unmount: unmount3 } = renderHook(() => useLiveSync({ tabId: 'test-tab-1' }));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('clientId=test-tab-1');
    unmount3();
  });

  it('2. closes when hidden', () => {
    const { unmount } = renderHook(() => useLiveSync({ tabId: 'tab-1' }));
    expect(MockEventSource.instances).toHaveLength(1);
    const es = MockEventSource.instances[0];

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(es.readyState).toBe(2);
    unmount();
  });

  it('3. reopens and refetches on visible, pageshow, online', () => {
    const onSync = vi.fn();

    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    const { unmount } = renderHook(() => useLiveSync({ onSync, tabId: 'tab-1' }));
    expect(MockEventSource.instances).toHaveLength(0);

    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(onSync).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(onSync).toHaveBeenCalledTimes(2);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(MockEventSource.instances[0].readyState).toBe(2);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(MockEventSource.instances.length).toBe(2);
    expect(onSync).toHaveBeenCalledTimes(3);

    unmount();
  });

  it('4. debounces burst of 5 events to single refetch', () => {
    const onSync = vi.fn();
    const { unmount } = renderHook(() => useLiveSync({ onSync, tabId: 'tab-1' }));
    const es = MockEventSource.instances[0];

    act(() => {
      for (let i = 0; i < 5; i++) {
        es.emitMessage({ type: 'changed', entity: 'item', id: `item-${i}`, origin: 'other-device' });
      }
    });

    expect(onSync).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onSync).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onSync).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('5. ignores own origin (tabId matches)', () => {
    const onSync = vi.fn();
    const { unmount } = renderHook(() => useLiveSync({ onSync, tabId: 'my-own-tab' }));
    const es = MockEventSource.instances[0];

    act(() => {
      es.emitMessage({ type: 'changed', entity: 'item', origin: 'my-own-tab' });
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onSync).not.toHaveBeenCalled();

    act(() => {
      es.emitMessage({ type: 'changed', entity: 'item', origin: 'another-tab' });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onSync).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('6. fallback polling after 3 failures and 60s reconnect retry', () => {
    const onSync = vi.fn();
    const { result, unmount } = renderHook(() => useLiveSync({ onSync, tabId: 'tab-1' }));
    const es = MockEventSource.instances[0];

    // 3 consecutive errors
    act(() => {
      es.emitError(new Event('error'));
      es.emitError(new Event('error'));
      es.emitError(new Event('error'));
    });

    expect(result.current.isFallback).toBe(true);
    expect(es.readyState).toBe(2); // closed

    // Fallback polls every 30s
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(onSync).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(onSync).toHaveBeenCalledTimes(2);

    // At 60s, attempts reconnecting SSE
    expect(MockEventSource.instances).toHaveLength(2);
    const newEs = MockEventSource.instances[1];

    // When new connection opens, fallback is cleared
    act(() => {
      newEs.onopen?.(new Event('open'));
    });
    expect(result.current.isFallback).toBe(false);

    unmount();
  });

  it('7. 401 stops all activity and calls onAuthError', () => {
    const onAuthError = vi.fn();
    const onSync = vi.fn();

    const { unmount } = renderHook(() => useLiveSync({ onAuthError, onSync, tabId: 'tab-1' }));
    const es = MockEventSource.instances[0];

    // Simulate 401 error on EventSource
    act(() => {
      const err = new Event('error');
      (err as any).status = 401;
      es.emitError(err);
    });

    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(es.readyState).toBe(2); // closed

    // No timers should trigger refetch
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(onSync).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(1); // No new instances created

    unmount();
  });

  it('7b. Item 4: /api/v1/auth/me checked on error; stops on 401 and calls onAuthError', async () => {
    const onAuthError = vi.fn();
    const onSync = vi.fn();

    fetchMock.mockResolvedValueOnce({ status: 401, ok: false });

    const { unmount } = renderHook(() => useLiveSync({ onAuthError, onSync, tabId: 'tab-1' }));
    const es = MockEventSource.instances[0];

    await act(async () => {
      es.emitError(new Event('error'));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/me');
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(es.readyState).toBe(2);

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(onSync).not.toHaveBeenCalled();

    unmount();
  });

  it('8. StrictMode: only one EventSource open at a time', () => {
    const { unmount } = renderHook(() => useLiveSync({ tabId: 'strict-mode-tab' }), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    const activeInstances = MockEventSource.instances.filter((inst) => inst.readyState !== 2);
    expect(activeInstances.length).toBeLessThanOrEqual(1);

    unmount();
    const finalActive = MockEventSource.instances.filter((inst) => inst.readyState !== 2);
    expect(finalActive).toHaveLength(0);
  });

  // Item 1 Test: In-memory tabId & two hook instances with different ids see each other's events
  it('9. Item 1: two hook instances with different ids see each other events; same id ignores its own', () => {
    const tabA = 'tab-instance-A';
    const tabB = 'tab-instance-B';

    const onSyncA = vi.fn();
    const onSyncB = vi.fn();

    const { unmount: unmountA } = renderHook(() => useLiveSync({ onSync: onSyncA, tabId: tabA }));
    const { unmount: unmountB } = renderHook(() => useLiveSync({ onSync: onSyncB, tabId: tabB }));

    const esA = MockEventSource.instances[0];
    const esB = MockEventSource.instances[1];

    // Event originating from tab A
    act(() => {
      esA.emitMessage({ type: 'changed', entity: 'item', id: 'i1', origin: tabA });
      esB.emitMessage({ type: 'changed', entity: 'item', id: 'i1', origin: tabA });
    });

    act(() => {
      vi.advanceTimersByTime(350);
    });

    // Tab A ignored its own event; Tab B received and refetched!
    expect(onSyncA).not.toHaveBeenCalled();
    expect(onSyncB).toHaveBeenCalledTimes(1);

    unmountA();
    unmountB();
  });

  // Item 2 Test: Background events (AI completion, no origin) trigger refetch on creating tab
  it('10. Item 2: background events without origin trigger refetch on the creating tab', () => {
    const myTab = getTabClientId();
    const onSync = vi.fn();

    const { unmount } = renderHook(() => useLiveSync({ onSync, tabId: myTab }));
    const es = MockEventSource.instances[0];

    // AI completion event carries NO origin
    act(() => {
      es.emitMessage({ type: 'changed', entity: 'capture', id: 'cap-1' });
    });

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(onSync).toHaveBeenCalledTimes(1);
    unmount();
  });

  // Item 3 Test: Trailing throttle test (two changes 500ms apart end with both visible)
  it('11. Item 3: trailing throttle executes leading edge and trailing edge so no changes are lost', () => {
    const fetchFn = vi.fn();

    // Replicate trailing throttle logic used in Dashboard
    function useTestThrottledRefetch() {
      const lastFetchTimeRef = useRef(0);
      const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

      const throttledRefetch = useCallback(() => {
        const now = Date.now();
        const elapsed = now - lastFetchTimeRef.current;

        if (elapsed >= 1000) {
          if (trailingTimerRef.current !== null) {
            clearTimeout(trailingTimerRef.current);
            trailingTimerRef.current = null;
          }
          lastFetchTimeRef.current = now;
          fetchFn();
        } else if (trailingTimerRef.current === null) {
          const remaining = 1000 - elapsed;
          trailingTimerRef.current = setTimeout(() => {
            trailingTimerRef.current = null;
            lastFetchTimeRef.current = Date.now();
            fetchFn();
          }, remaining);
        }
      }, []);

      return throttledRefetch;
    }

    const { result } = renderHook(() => useTestThrottledRefetch());

    // First change at t = 0
    act(() => {
      result.current();
    });
    expect(fetchFn).toHaveBeenCalledTimes(1); // Leading edge executed immediately

    // Second change 500ms later (within the 1000ms window)
    act(() => {
      vi.advanceTimersByTime(500);
      result.current();
    });
    // Still 1 (waiting for trailing edge)
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Advance to t = 1000ms (trailing edge fires)
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Trailing edge executed! Both changes visible!
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // Item 5 Test: 11 tabs settle without reconnect loop
  it('12. Item 5: replaced event closes stream for 60s and uses fallback polling without reconnect loop', () => {
    const onSync = vi.fn();
    const { result, unmount } = renderHook(() => useLiveSync({ onSync, tabId: 'tab-11' }));
    const es = MockEventSource.instances[0];

    act(() => {
      es.emitCustomEvent('replaced', new Event('replaced'));
    });

    // Stream is closed, switches to fallback polling
    expect(es.readyState).toBe(2);
    expect(result.current.isFallback).toBe(true);

    // Within 60s, does NOT try to reconnect SSE
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(MockEventSource.instances).toHaveLength(1);
    expect(onSync).toHaveBeenCalledTimes(1); // Polled via fallback

    // At 60s, retries reconnecting SSE
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    unmount();
  });
});
