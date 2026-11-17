// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { ItemEditModal } from "../src/client/features/dashboard/ItemEditModal";

// Mock matchMedia for modal components that might use it implicitly
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
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
});

describe("ItemEditModal component tests", () => {
  const originalTZ = process.env.TZ;

  beforeAll(() => {
    // Set device TZ to something different from profile TZ
    process.env.TZ = "America/New_York";
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  // (a) Change only the title, submit: payload has no dueDate
  it("Change only the title, submit: payload has no dueDate", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    // User profile timezone is Asia/Kolkata (+05:30)
    // Device timezone is America/New_York (EDT, -04:00)
    console.log("new Date().getTimezoneOffset():", new Date().getTimezoneOffset());
    const item = {
      id: "1",
      title: "Initial Title",
      itemType: "appointment",
      status: "active",
      createdAt: "2026-09-28T07:00:00.000Z",
      dueDate: "2026-10-04T19:00:00.000Z", // 00:30 IST on Oct 5
      metadata: { hasExplicitTime: true }
    };

    render(
      <ItemEditModal
        isOpen={true}
        item={item}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    const titleInput = screen.getByDisplayValue("Initial Title");
    fireEvent.change(titleInput, { target: { value: "Updated Title" } });

    // Submit the form directly
    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "Updated Title"
    }));

    // Extract the exact payload to ensure no dueDate
    const payload = onSave.mock.calls[0][0];
    expect(payload.dueDate).toBeUndefined();
  });

  // (b) Change the date, submit: payload has the new dueDate
  it("Change the date, submit: payload has the new dueDate", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const item = {
      id: "2",
      title: "Date Test Item",
      itemType: "appointment",
      status: "active",
      createdAt: "2026-09-28T07:00:00.000Z",
      dueDate: "2026-10-04T19:00:00.000Z",
      metadata: { hasExplicitTime: true }
    };

    render(
      <ItemEditModal
        isOpen={true}
        item={item}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    // Change the date input
    const dateInput = document.getElementById("edit-duedate-input") as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-10-10" } });

    // Submit the form directly
    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });

    const payload = onSave.mock.calls[0][0];
    expect(payload.dueDate).toBeDefined();
    expect(payload.dueDate).toBe("2026-10-10");
  });

  // (c) A revision-bearing item submits expectedRevision
  it("A revision-bearing item submits expectedRevision", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const item = {
      id: "item-rev-1",
      title: "Initial Title",
      itemType: "task",
      status: "active",
      createdAt: "2026-09-28T07:00:00.000Z",
      revision: 4,
      metadata: {}
    };

    render(
      <ItemEditModal
        isOpen={true}
        item={item}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    const titleInput = screen.getByDisplayValue("Initial Title");
    fireEvent.change(titleInput, { target: { value: "Updated Revision Title" } });

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: "item-rev-1",
      title: "Updated Revision Title",
      expectedRevision: 4
    }));
    expect(onClose).toHaveBeenCalled();
  });

  // (d) A conflict retains entered text and keeps the modal open
  it("A conflict retains entered text and keeps the modal open", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Item was modified by another session"));
    const onClose = vi.fn();

    const item = {
      id: "item-conflict-1",
      title: "Original Conflict Item",
      itemType: "task",
      status: "active",
      createdAt: "2026-09-28T07:00:00.000Z",
      revision: 2,
      metadata: {}
    };

    render(
      <ItemEditModal
        isOpen={true}
        item={item}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    const titleInput = screen.getByDisplayValue("Original Conflict Item");
    fireEvent.change(titleInput, { target: { value: "Draft Before Conflict" } });

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });

    // Error banner is displayed
    await waitFor(() => {
      expect(screen.getByText("Item was modified by another session")).toBeDefined();
    });

    // Modal is still open (onClose was NOT called)
    expect(onClose).not.toHaveBeenCalled();

    // The entered text remains in the input
    expect(screen.getByDisplayValue("Draft Before Conflict")).toBeDefined();
    const currentInput = document.getElementById("edit-title-input") as HTMLInputElement;
    expect(currentInput.value).toBe("Draft Before Conflict");
  });

  // (e) Conflict handling does not automatically resubmit or replace the draft with refreshed server data
  it("Conflict handling does not automatically resubmit or replace the draft with refreshed server data", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Stale item revision"));
    const onClose = vi.fn();

    const item = {
      id: "item-conflict-2",
      title: "Original Pre-Conflict Title",
      itemType: "task",
      status: "active",
      createdAt: "2026-09-28T07:00:00.000Z",
      revision: 1,
      metadata: {}
    };

    const { rerender } = render(
      <ItemEditModal
        isOpen={true}
        item={item}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    const titleInput = screen.getByDisplayValue("Original Pre-Conflict Title");
    fireEvent.change(titleInput, { target: { value: "User In-Progress Draft" } });

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("Stale item revision")).toBeDefined();
    });

    // Check that onSave was called exactly once and does not automatically resubmit
    expect(onSave).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onSave).toHaveBeenCalledTimes(1);

    // Simulate refreshed server data arriving via props (e.g. from background live sync / polling)
    const refreshedServerItem = {
      ...item,
      title: "Concurrent Server Update",
      revision: 2,
    };

    rerender(
      <ItemEditModal
        isOpen={true}
        item={refreshedServerItem}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    // The draft must NOT be replaced with refreshed server data
    const currentInput = document.getElementById("edit-title-input") as HTMLInputElement;
    expect(currentInput.value).toBe("User In-Progress Draft");
    expect(screen.queryByDisplayValue("Concurrent Server Update")).toBeNull();

    // No auto-resubmission occurred upon receiving refreshed data
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  // (f) Refresh before first save: preserves base revision 1 and never silently submits older draft with refreshed revision 2
  it("Refresh before first save: preserves base revision 1 and never silently submits older draft with refreshed revision 2", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Conflict: Stale revision"));
    const onClose = vi.fn();

    const item = {
      id: "item-refresh-before-save",
      title: "Original Base Title",
      itemType: "task",
      status: "active",
      createdAt: "2026-09-28T07:00:00.000Z",
      revision: 1,
      metadata: { originalMeta: "stay" }
    };

    const { rerender } = render(
      <ItemEditModal
        isOpen={true}
        item={item}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    // Enter draft edits
    const titleInput = screen.getByDisplayValue("Original Base Title");
    fireEvent.change(titleInput, { target: { value: "Draft Before First Save" } });

    // BEFORE submitting, background refresh occurs (e.g., SSE/polling delivers revision 2)
    const refreshedServerItem = {
      ...item,
      title: "Concurrent Server Revision",
      revision: 2,
      metadata: { originalMeta: "stay", serverAdded: true }
    };

    rerender(
      <ItemEditModal
        isOpen={true}
        item={refreshedServerItem}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    // Verify draft is still present
    const currentInput = document.getElementById("edit-title-input") as HTMLInputElement;
    expect(currentInput.value).toBe("Draft Before First Save");

    // Submit the form
    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // CRITICAL: Must use base revision 1, NEVER the refreshed revision 2!
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: "item-refresh-before-save",
      title: "Draft Before First Save",
      expectedRevision: 1
    }));
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 2
    }));

    // Verify error banner is shown and modal stays open
    await waitFor(() => {
      expect(screen.getByText("Conflict: Stale revision")).toBeDefined();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(currentInput.value).toBe("Draft Before First Save");
  });

  // (g) Refresh after 409 conflict: subsequent submit still uses base revision 1 and never silently submits older draft with refreshed revision 2
  it("Refresh after 409 conflict: subsequent submit still uses base revision 1 and never silently submits older draft with refreshed revision 2", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Conflict: Stale revision"));
    const onClose = vi.fn();

    const item = {
      id: "item-refresh-after-409",
      title: "Original Conflict Title",
      itemType: "task",
      status: "active",
      createdAt: "2026-09-28T07:00:00.000Z",
      revision: 1,
      metadata: {}
    };

    const { rerender } = render(
      <ItemEditModal
        isOpen={true}
        item={item}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    // Enter draft edits
    const titleInput = screen.getByDisplayValue("Original Conflict Title");
    fireEvent.change(titleInput, { target: { value: "Draft Under Conflict" } });

    // Submit 1: Triggers 409 conflict
    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedRevision: 1
    }));
    await waitFor(() => {
      expect(screen.getByText("Conflict: Stale revision")).toBeDefined();
    });

    // AFTER 409, background sync delivers refreshed props containing revision 2
    const refreshedServerItem = {
      ...item,
      title: "Server Updated Title",
      revision: 2,
    };

    rerender(
      <ItemEditModal
        isOpen={true}
        item={refreshedServerItem}
        onClose={onClose}
        onSave={onSave}
        userTimezone="Asia/Kolkata"
      />
    );

    // Draft is preserved, no automatic resubmission
    const currentInput = document.getElementById("edit-title-input") as HTMLInputElement;
    expect(currentInput.value).toBe("Draft Under Conflict");
    expect(onSave).toHaveBeenCalledTimes(1);

    // User attempts to submit again
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(2);
    });

    // CRITICAL: Second submission still pairs draft with base revision 1, NEVER revision 2!
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "item-refresh-after-409",
      title: "Draft Under Conflict",
      expectedRevision: 1
    }));
    expect(onSave).not.toHaveBeenLastCalledWith(expect.objectContaining({
      expectedRevision: 2
    }));

    expect(onClose).not.toHaveBeenCalled();
    expect(currentInput.value).toBe("Draft Under Conflict");
  });
});
