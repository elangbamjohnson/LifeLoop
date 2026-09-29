// @vitest-environment jsdom
import React from "react";
import { render, screen, act, cleanup, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dashboard } from "../../../src/client/features/dashboard/Dashboard";
import { TimelineItem, groupItemsIntoTimeline, getItemBadge } from "../../../src/shared/utils/timeline";

// Mock auth hook
const mockUser = { id: "user-1", email: "user@example.com", isAdmin: true };
vi.mock("../../../src/client/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    checkAuth: vi.fn(),
    logout: vi.fn(),
  }),
}));

// Mock theme hook
vi.mock("../../../src/client/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "light",
    toggleTheme: vi.fn(),
  }),
}));

// Mock live sync
vi.mock("../../../src/client/hooks/useLiveSync", () => ({
  useLiveSync: () => {},
}));

// Control polling hook output
let currentItems: TimelineItem[] = [];
vi.mock("../../../src/client/hooks/useDashboardPolling", () => ({
  useDashboardPolling: () => ({
    captures: [],
    items: currentItems,
    loading: false,
    error: null,
    authError: false,
    refetch: vi.fn(),
  }),
}));

describe("Live Overdue Labels & Timeline Grouping (fix/live-overdue-labels)", () => {
  const baseTime = new Date("2026-09-28T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(baseTime);
    Object.defineProperty(document, "hidden", { value: false, writable: true });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Item due in 60 seconds: label is 'Today'. Advance 61 seconds with no remount: label is 'Overdue'", () => {
    const dueTime = new Date(baseTime.getTime() + 60 * 1000); // 60s in future
    const testItem: TimelineItem = {
      id: "item-due-soon",
      title: "Check the oven",
      itemType: "task",
      status: "active",
      dueDate: dueTime.toISOString(),
      createdAt: baseTime.toISOString(),
    };
    currentItems = [testItem];

    const { unmount } = render(React.createElement(Dashboard, null));

    // In the Reminders & Due Today carousel
    const carouselSection = document.getElementById("section-reminders-carousel");
    expect(carouselSection).not.toBeNull();
    const carouselPill = within(carouselSection!).getByText("Today");
    expect(carouselPill).not.toBeNull();

    // Advance 61 seconds without remounting
    act(() => {
      vi.advanceTimersByTime(61000);
    });

    // The carousel pill now displays "Overdue" automatically
    const overduePill = within(carouselSection!).getByText("Overdue");
    expect(overduePill).not.toBeNull();

    unmount();
  });

  it("Same item moves from the Today section to the Overdue section without remount", () => {
    const dueTime = new Date(baseTime.getTime() + 60 * 1000); // 60s in future
    const testItem: TimelineItem = {
      id: "item-move-section",
      title: "Pay electric bill",
      itemType: "payment",
      status: "active",
      dueDate: dueTime.toISOString(),
      createdAt: baseTime.toISOString(),
    };
    currentItems = [testItem];

    const { unmount } = render(React.createElement(Dashboard, null));

    // Initially: item is inside the Today section
    const todaySection = document.getElementById("section-today");
    expect(todaySection).not.toBeNull();
    expect(within(todaySection!).getByText("Pay electric bill")).not.toBeNull();

    // Needs attention section is not present or empty
    const initialNeedsAttention = document.getElementById("section-needs-attention");
    expect(initialNeedsAttention).toBeNull();

    // Advance 61 seconds without remounting
    act(() => {
      vi.advanceTimersByTime(61000);
    });

    // Now: item has automatically moved to the Needs Attention (Overdue) section!
    const needsAttentionSection = document.getElementById("section-needs-attention");
    expect(needsAttentionSection).not.toBeNull();
    expect(within(needsAttentionSection!).getByText("Pay electric bill")).not.toBeNull();

    // And is no longer in the Today section list
    expect(within(todaySection!).queryByText("Pay electric bill")).toBeNull();

    unmount();
  });

  it("Hidden tab: no ticks. On becoming visible, the label is corrected at once", () => {
    const dueTime = new Date(baseTime.getTime() + 60 * 1000); // 60s in future
    const testItem: TimelineItem = {
      id: "item-hidden-tab",
      title: "Dentist call",
      itemType: "appointment",
      status: "active",
      dueDate: dueTime.toISOString(),
      createdAt: baseTime.toISOString(),
    };
    currentItems = [testItem];

    const { unmount } = render(React.createElement(Dashboard, null));

    const carouselSection = document.getElementById("section-reminders-carousel");
    expect(within(carouselSection!).getByText("Today")).not.toBeNull();

    // Hide tab
    act(() => {
      Object.defineProperty(document, "hidden", { value: true, writable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Advance 61s while hidden: ticker is paused, no re-render
    act(() => {
      vi.advanceTimersByTime(61000);
    });

    // While hidden, still shows "Today" because ticks were paused
    expect(within(carouselSection!).getByText("Today")).not.toBeNull();

    // Make tab visible again
    act(() => {
      Object.defineProperty(document, "hidden", { value: false, writable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // On visibilitychange to visible, clock is corrected to real time immediately -> "Overdue"
    expect(within(carouselSection!).getByText("Overdue")).not.toBeNull();

    unmount();
  });

  it("Unmount clears the interval (no leaked timers)", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    const { unmount } = render(React.createElement(Dashboard, null));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it("The item's title, status and click behavior are unchanged", () => {
    const dueTime = new Date(baseTime.getTime() + 60 * 1000);
    const testItem: TimelineItem = {
      id: "item-behavior-check",
      title: "Dentist appointment",
      itemType: "appointment",
      status: "active",
      dueDate: dueTime.toISOString(),
      createdAt: baseTime.toISOString(),
      metadata: { description: "Regular checkup" },
    };
    currentItems = [testItem];

    const { unmount } = render(React.createElement(Dashboard, null));

    // Item title is present
    expect(screen.getAllByText("Dentist appointment").length).toBeGreaterThan(0);

    // Click item card to expand details
    let itemCard = document.getElementById("item-card-item-behavior-check");
    expect(itemCard).not.toBeNull();
    fireEvent.click(itemCard!);
    expect(screen.getByText("Regular checkup")).not.toBeNull();

    // Advance time past due: item transitions automatically to Needs Attention
    act(() => {
      vi.advanceTimersByTime(61000);
    });

    // Title remains intact
    expect(screen.getAllByText("Dentist appointment").length).toBeGreaterThan(0);

    // In the new section, clicking the card still works identically
    itemCard = document.getElementById("item-card-item-behavior-check");
    expect(itemCard).not.toBeNull();
    fireEvent.click(itemCard!);
    expect(screen.getByText("Regular checkup")).not.toBeNull();

    // Click again to collapse
    fireEvent.click(itemCard!);
    expect(screen.queryByText("Regular checkup")).toBeNull();

    unmount();
  });

  it("An unreviewed item due tomorrow gets variant 'review', label 'Tomorrow', and is NOT 'Overdue'", () => {
    const tomorrowDate = new Date(baseTime.getTime() + 24 * 60 * 60 * 1000);
    const pendingItem: TimelineItem = {
      id: "item-pending-tomorrow",
      title: "Confirm dentist for tomorrow",
      itemType: "appointment",
      status: "pending_review",
      dueDate: tomorrowDate.toISOString(),
      createdAt: baseTime.toISOString(),
    };

    // 1. Check getItemBadge directly
    const badge = getItemBadge(pendingItem, baseTime);
    expect(badge.variant).toBe("review");
    expect(badge.text).toBe("Tomorrow");

    // 2. Check groupItemsIntoTimeline: item appears in both needsAttention (for Priority) and tomorrow (for Timeline)
    const grouping = groupItemsIntoTimeline([pendingItem], baseTime);
    expect(grouping.needsAttention.map((i) => i.id)).toContain("item-pending-tomorrow");
    expect(grouping.tomorrow.map((i) => i.id)).toContain("item-pending-tomorrow");

    // 3. Render Dashboard: in Carousel, it says 'Needs Review', NEVER 'Overdue'
    currentItems = [pendingItem];
    const { unmount } = render(React.createElement(Dashboard, null));

    const carouselSection = document.getElementById("section-reminders-carousel");
    expect(carouselSection).not.toBeNull();

    // Must have "Needs Review"
    expect(within(carouselSection!).queryByText("Needs Review")).not.toBeNull();
    // Must NOT have "Overdue"
    expect(within(carouselSection!).queryByText("Overdue")).toBeNull();

    // 4. Switch to Timeline tab
    const timelineTabBtn = screen.getByRole("tab", { name: /Timeline/i });
    fireEvent.click(timelineTabBtn);

    // Item must appear in the Timeline view
    expect(screen.getAllByText("Confirm dentist for tomorrow").length).toBeGreaterThan(0);

    // The Confirm button must be present so user can confirm it
    expect(screen.getAllByRole("button", { name: /Confirm/i }).length).toBeGreaterThan(0);

    unmount();
  });
});

