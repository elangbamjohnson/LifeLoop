/**
 * AddToCalendarButton.tsx
 *
 * "Add to Calendar" / "Update calendar" component with confirmation prompt flow.
 *
 * Flow:
 *  - Renders as a standard <a> link.
 *  - Tapping opens the .ics route and sets a local pending confirmation flag
 *    persisted in sessionStorage under `lifeloop:calendar-pending:<itemId>`.
 *  - While pending, displays: "Did you add it to your calendar?" with "Yes, added" and "No".
 *  - "Yes, added": clears flag, calls POST /api/v1/items/:id/calendar-added, then displays
 *    "Added to calendar" (disabled, no href).
 *  - "No": clears flag and returns to previous button state without server call.
 *  - "Undo" in added state calls DELETE /api/v1/items/:id/calendar-added.
 *  - If item's date or time changes while pending, the pending flag is cleared.
 */

import React, { useState, useEffect, useRef } from "react";
import { Calendar } from "lucide-react";
import {
  getCalendarButtonState,
  shouldAskCalendarConfirm,
  CalendarButtonState,
} from "../../../shared/utils/calendar";
import { TimelineItem } from "../../../shared/utils/timeline";

interface AddToCalendarButtonProps {
  item: TimelineItem;
  userTimezone?: string;
}

export const AddToCalendarButton: React.FC<AddToCalendarButtonProps> = React.memo(
  ({ item }) => {
    const currentDueSignature = `${item.dueDate || ""}|${Boolean(item.metadata?.hasExplicitTime)}`;

    // Read initial pending state from sessionStorage
    const readPendingStorage = (): boolean => {
      try {
        const isPending =
          sessionStorage.getItem(`lifeloop:calendar-pending:${item.id}`) === "true";
        if (!isPending) return false;

        const storedDue = sessionStorage.getItem(
          `lifeloop:calendar-pending:${item.id}:due`
        );
        if (storedDue && storedDue !== currentDueSignature) {
          sessionStorage.removeItem(`lifeloop:calendar-pending:${item.id}`);
          sessionStorage.removeItem(`lifeloop:calendar-pending:${item.id}:due`);
          return false;
        }
        return true;
      } catch {
        return false;
      }
    };

    const [pending, setPending] = useState<boolean>(readPendingStorage);
    const [localCalendarAdded, setLocalCalendarAdded] = useState<any>(
      item.metadata?.calendarAdded
    );
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Synchronize local calendarAdded if parent item prop updates
    useEffect(() => {
      setLocalCalendarAdded(item.metadata?.calendarAdded);
    }, [item.metadata?.calendarAdded]);

    // Clear pending flag if item's date or time changes
    const prevDueRef = useRef<string>(currentDueSignature);
    useEffect(() => {
      if (prevDueRef.current !== currentDueSignature) {
        prevDueRef.current = currentDueSignature;
        try {
          sessionStorage.removeItem(`lifeloop:calendar-pending:${item.id}`);
          sessionStorage.removeItem(`lifeloop:calendar-pending:${item.id}:due`);
        } catch {}
        setPending(false);
        setErrorMessage(null);
      }
    }, [currentDueSignature, item.id]);

    const effectiveItem: TimelineItem = {
      ...item,
      metadata: {
        ...(item.metadata || {}),
        calendarAdded: localCalendarAdded,
      },
    };

    const state: CalendarButtonState = getCalendarButtonState(effectiveItem);

    if (state === "hidden") {
      return null;
    }

    const clearPendingStorage = () => {
      try {
        sessionStorage.removeItem(`lifeloop:calendar-pending:${item.id}`);
        sessionStorage.removeItem(`lifeloop:calendar-pending:${item.id}:due`);
      } catch {}
    };

    const handleLinkClick = (e: React.MouseEvent) => {
      e.stopPropagation(); // prevent parent card toggle
      setPending(true);
      setErrorMessage(null);
      try {
        sessionStorage.setItem(`lifeloop:calendar-pending:${item.id}`, "true");
        sessionStorage.setItem(
          `lifeloop:calendar-pending:${item.id}:due`,
          currentDueSignature
        );
      } catch {}
    };

    const handleConfirmYes = async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsSaving(true);
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/v1/items/${item.id}/calendar-added`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
          throw new Error("Failed to save calendar status");
        }

        const data = await res.json();
        clearPendingStorage();
        setPending(false);
        setLocalCalendarAdded(
          data.item?.metadata?.calendarAdded || {
            at: new Date().toISOString(),
            dueDate: item.dueDate,
            hasExplicitTime: Boolean(item.metadata?.hasExplicitTime),
          }
        );
      } catch (err: any) {
        setErrorMessage("Could not save calendar status. Please try again.");
      } finally {
        setIsSaving(false);
      }
    };

    const handleConfirmNo = (e: React.MouseEvent) => {
      e.stopPropagation();
      clearPendingStorage();
      setPending(false);
      setErrorMessage(null);
    };

    const handleUndo = async (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsSaving(true);
      try {
        const res = await fetch(`/api/v1/items/${item.id}/calendar-added`, {
          method: "DELETE",
        });
        if (res.ok) {
          setLocalCalendarAdded(null);
          clearPendingStorage();
          setPending(false);
          setErrorMessage(null);
        }
      } catch {
      } finally {
        setIsSaving(false);
      }
    };

    const isConfirming = shouldAskCalendarConfirm(state, pending);

    return (
      <div className="flex flex-col items-start gap-2 max-w-full">
        {state === "added" ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span
              id={`add-to-calendar-${item.id}`}
              aria-disabled="true"
              className="add-to-calendar-btn self-start opacity-80 cursor-default inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300"
              style={{
                minHeight: "48px",
                minWidth: "48px",
                textDecoration: "none",
              }}
            >
              <Calendar className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Added to calendar</span>
            </span>
            <button
              id={`add-to-calendar-undo-${item.id}`}
              type="button"
              onClick={handleUndo}
              disabled={isSaving}
              aria-label={`Undo adding "${item.title}" to calendar`}
              className="text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 underline cursor-pointer px-2 py-1"
              style={{ minHeight: "48px", display: "inline-flex", alignItems: "center" }}
            >
              Undo
            </button>
          </div>
        ) : (
          <a
            id={`add-to-calendar-${item.id}`}
            href={`/api/v1/items/${item.id}/calendar.ics`}
            aria-label={
              state === "update"
                ? `Update "${item.title}" in calendar`
                : `Add "${item.title}" to calendar`
            }
            onClick={handleLinkClick}
            className="add-to-calendar-btn self-start"
            style={{
              minHeight: "48px",
              minWidth: "48px",
              textDecoration: "none",
            }}
          >
            <Calendar className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{state === "update" ? "Update calendar" : "Add to calendar"}</span>
          </a>
        )}

        {isConfirming && (
          <div
            role="group"
            aria-label="Confirm adding to calendar"
            className="calendar-confirm-row flex flex-col gap-2 p-2.5 rounded-xl border border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/40"
            style={{ maxWidth: "100%" }}
          >
            <span className="text-xs font-medium text-stone-800 dark:text-stone-200">
              Did you add it to your calendar?
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                id={`calendar-confirm-yes-${item.id}`}
                type="button"
                onClick={handleConfirmYes}
                disabled={isSaving}
                className="calendar-confirm-yes-btn flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-sm transition-colors cursor-pointer"
                style={{ minHeight: "48px" }}
              >
                {isSaving ? "Saving..." : "Yes, added"}
              </button>
              <button
                id={`calendar-confirm-no-${item.id}`}
                type="button"
                onClick={handleConfirmNo}
                disabled={isSaving}
                className="calendar-confirm-no-btn flex items-center justify-center px-4 py-2 rounded-lg border border-stone-300 hover:bg-stone-100 active:bg-stone-200 dark:border-stone-700 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300 font-medium text-xs transition-colors cursor-pointer"
                style={{ minHeight: "48px" }}
              >
                No
              </button>
            </div>
            {errorMessage && (
              <div
                role="alert"
                className="text-xs font-medium text-red-600 dark:text-red-400 mt-0.5"
              >
                {errorMessage}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

AddToCalendarButton.displayName = "AddToCalendarButton";
