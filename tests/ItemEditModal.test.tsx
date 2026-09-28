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
});
