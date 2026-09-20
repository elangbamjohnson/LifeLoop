// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLiveSync } from '../../../src/client/hooks/useLiveSync';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState: number = 0; // 0 CONNECTING, 1 OPEN, 2 CLOSED
  onopen: ((ev: any) => any) | null = null;
  onmessage: ((ev: any) => any) | null = null;
  onerror: ((ev: any) => any) | null = null;

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
    // Hidden: should not open
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    const { unmount: unmount1 } = renderHook(() => useLiveSync());
    expect(MockEventSource.instances).toHaveLength(0);
    unmount1();

    // Offline: should not open
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const { unmount: unmount2 } = renderHook(() => useLiveSync());
    expect(MockEventSource.instances).toHaveLength(0);
    unmount2();

    // Visible + Online: opens EventSource
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

    // Simulate hiding the tab
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(es.readyState).toBe(2); // closed
    unmount();
  });

  it('3. reopens and refetches on visible, pageshow, online', () => {
    const onSync = vi.fn();

    // Start hidden
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    const { unmount } = renderHook(() => useLiveSync({ onSync, tabId: 'tab-1' }));
    expect(MockEventSource.instances).toHaveLength(0);

    // Become visible
    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(onSync).toHaveBeenCalledTimes(1);

    // Simulate pageshow
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(onSync).toHaveBeenCalledTimes(2);

    // Simulate offline then online
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(MockEventSource.instances[0].readyState).toBe(2); // closed

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    // Reopened
    expect(MockEventSource.instances.length).toBe(2);
    expect(onSync).toHaveBeenCalledTimes(3);

    unmount();
  });

  it('4. debounces burst of 5 events to single refetch', () => {
    const onSync = vi.fn();
    const { unmount } = renderHook(() => useLiveSync({ onSync, tabId: 'tab-1' }));
    const es = MockEventSource.instances[0];

    // Emit 5 rapid messages
    act(() => {
      for (let i = 0; i < 5; i++) {
        es.emitMessage({ type: 'changed', entity: 'item', id: `item-${i}`, origin: 'other-device' });
      }
    });

    expect(onSync).not.toHaveBeenCalled();

    // Advance 299ms - still not called
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onSync).not.toHaveBeenCalled();

    // Advance 1ms (total 300ms) - single refetch called!
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

    // Message originating from own tab
    act(() => {
      es.emitMessage({ type: 'changed', entity: 'item', origin: 'my-own-tab' });
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onSync).not.toHaveBeenCalled();

    // Message originating from another tab
    act(() => {
      es.emitMessage({ type: 'changed', entity: 'item', origin: 'another-tab' });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onSync).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('6. fallback polling after 3 failures', () => {
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

  it('7. 401 stops all activity and calls onAuthError', async () => {
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

  it('8. StrictMode: only one EventSource open at a time', () => {
    // In React 18 StrictMode, component is mounted, unmounted, and remounted immediately.
    const { unmount } = renderHook(() => useLiveSync({ tabId: 'strict-mode-tab' }), {
      wrapper: ({ children }) => React.createElement(React.StrictMode, null, children),
    });

    // Check that at most 1 instance is active (readyState !== 2)
    const activeInstances = MockEventSource.instances.filter((inst) => inst.readyState !== 2);
    expect(activeInstances.length).toBeLessThanOrEqual(1);

    unmount();
    const finalActive = MockEventSource.instances.filter((inst) => inst.readyState !== 2);
    expect(finalActive).toHaveLength(0);
  });
});
