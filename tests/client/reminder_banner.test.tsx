// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ReminderBanner } from '../../src/client/features/dashboard/ReminderBanner';
import { InMemoryEventBus } from '../../src/server/services/EventBus';

describe('In-App Reminder Banner (tests/client/reminder_banner.test.tsx)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // 1. Banner shows
  it('banner shows: displays title, safe-area aware styling, and 48px touch target', () => {
    const onOpenItem = vi.fn();
    const onDismiss = vi.fn();

    render(
      <ReminderBanner
        reminder={{
          id: 'rem-1',
          title: 'Doctor Appointment at 3 PM',
          itemId: 'item-1',
        }}
        onOpenItem={onOpenItem}
        onDismiss={onDismiss}
      />
    );

    const banner = screen.getByTestId('reminder-banner');
    expect(banner).not.toBeNull();
    expect(screen.getByText('Doctor Appointment at 3 PM')).not.toBeNull();
    expect(screen.getByText(/lifeloop reminder/i)).not.toBeNull();

    // Check touch target class
    const content = screen.getByTestId('reminder-banner-content');
    expect(content.className).toContain('touch-target-48');
    expect(content.className).toContain('min-h-[48px]');
  });

  // 2. Auto-dismisses
  it('auto-dismisses: automatically dismisses after ~8 seconds', () => {
    const onOpenItem = vi.fn();
    const onDismiss = vi.fn();

    render(
      <ReminderBanner
        reminder={{
          id: 'rem-2',
          title: 'Car Insurance Due',
          itemId: 'item-2',
        }}
        onOpenItem={onOpenItem}
        onDismiss={onDismiss}
        autoDismissMs={8000}
      />
    );

    expect(onDismiss).not.toHaveBeenCalled();

    // Fast-forward 7.9 seconds -> still open
    act(() => {
      vi.advanceTimersByTime(7900);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Fast-forward remaining 200ms -> dismissed
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // 3. Tap opens the item
  it('tap opens the item: clicking the banner calls onOpenItem with item id', () => {
    const onOpenItem = vi.fn();
    const onDismiss = vi.fn();

    render(
      <ReminderBanner
        reminder={{
          id: 'rem-3',
          title: 'Pay Electricity Bill',
          itemId: 'item-elec-123',
        }}
        onOpenItem={onOpenItem}
        onDismiss={onDismiss}
      />
    );

    const content = screen.getByTestId('reminder-banner-content');
    fireEvent.click(content);

    expect(onOpenItem).toHaveBeenCalledWith('item-elec-123');
  });

  // 4. Does not show for another user's events
  it('it does not show for another user\'s events: eventBus isolates user notifications', () => {
    const bus = new InMemoryEventBus();

    const userAEvents: any[] = [];
    const userBEvents: any[] = [];

    // Mock HTTP SSE response objects for User A and User B
    const resA = {
      write: vi.fn((data: string) => {
        const payload = JSON.parse(data.replace('data: ', '').trim());
        userAEvents.push(payload);
      }),
    } as any;

    const resB = {
      write: vi.fn((data: string) => {
        const payload = JSON.parse(data.replace('data: ', '').trim());
        userBEvents.push(payload);
      }),
    } as any;

    bus.subscribe('user-A', resA);
    bus.subscribe('user-B', resB);

    // Dispatch a reminder for User A
    bus.publish('user-A', {
      type: 'reminder_delivered',
      entity: 'reminder',
      id: 'rem-for-A',
      title: "User A's Personal Reminder",
      itemId: 'item-A',
      at: new Date().toISOString(),
    });

    // User A receives the event
    expect(userAEvents.length).toBe(1);
    expect(userAEvents[0].title).toBe("User A's Personal Reminder");

    // User B receives NOTHING
    expect(userBEvents.length).toBe(0);
    expect(resB.write).not.toHaveBeenCalled();
  });
});
