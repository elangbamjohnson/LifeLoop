/**
 * AddToCalendarButton.tsx
 *
 * A reusable "Add to Calendar" button that triggers an .ics download.
 *
 * Responsibilities of THIS file (browser layer only):
 *   - Call buildIcs() to get the iCalendar text.
 *   - Create a Blob + temporary object URL and programmatically click a hidden
 *     anchor to trigger the download.
 *   - Revoke the URL after the click to release memory.
 *   - Call stopPropagation so the parent card does not collapse.
 *
 * Extensibility note (Android / Web Share API):
 *   To add platform-specific behaviour later (e.g. Web Share API on Android),
 *   check `navigator.share` and `navigator.canShare` in the click handler and
 *   branch accordingly.  No changes to buildIcs() are needed.
 */

import React from "react";
import { Calendar } from "lucide-react";
import { buildIcs } from "../../../shared/utils/calendar";
import { TimelineItem } from "../../../shared/utils/timeline";

interface AddToCalendarButtonProps {
  item: TimelineItem;
  userTimezone: string;
}

/** Slugify a title for use as a filename. */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "event";
}

export const AddToCalendarButton: React.FC<AddToCalendarButtonProps> =
  React.memo(({ item, userTimezone }) => {
    // Render nothing when the item is completed or has no valid dueDate.
    const icsText = buildIcs(item, userTimezone);
    if (icsText === null || item.status === "completed") return null;

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent the parent card from collapsing

      const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${titleToSlug(item.title)}.ics`;
      // Append, click, then remove — necessary in some browsers
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      // Revoke the object URL after a tick so the browser has time to start the download
      setTimeout(() => URL.revokeObjectURL(url), 100);
    };

    return (
      <button
        id={`add-to-calendar-${item.id}`}
        type="button"
        aria-label={`Add "${item.title}" to calendar`}
        onClick={handleClick}
        className="add-to-calendar-btn"
        style={{
          // Minimum 48 × 48 px touch target per Apple HIG and Material 3
          minHeight: "48px",
          minWidth: "48px",
        }}
      >
        <Calendar className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Add to Calendar</span>
      </button>
    );
  });

AddToCalendarButton.displayName = "AddToCalendarButton";
