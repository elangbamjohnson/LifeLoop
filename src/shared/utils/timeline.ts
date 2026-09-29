export type TimelineSectionKey = "today" | "tomorrow" | "this_week" | "upcoming" | "past";

export interface TimelineItem {
  id: string;
  title: string;
  itemType: string;
  status: string; // 'pending_review' | 'active' | 'completed' | 'snoozed' | 'archived'
  dueDate?: string | null;
  snoozedUntil?: string | null;
  completedAt?: string | null;
  confidenceScore?: number | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  badgeText?: string;
  /**
   * "review"   – pending_review (never confused with date-based urgency)
   * "urgent"   – genuinely overdue (past due date)
   * "today"    – due today but not yet past
   * "upcoming" – due within 7 days
   * "neutral"  – no date or far future
   * "completed"– done
   */
  badgeVariant?: "review" | "urgent" | "today" | "upcoming" | "neutral" | "completed";
}

export interface TimelineGrouping {
  needsAttention: TimelineItem[];
  today: TimelineItem[];
  tomorrow: TimelineItem[];
  thisWeek: TimelineItem[];
  upcoming: TimelineItem[];
  waitingFor: TimelineItem[];
  past: TimelineItem[];
}

/**
 * Normalizes an item's target date (considering due date or snoozed until).
 */
export function getItemTargetDate(item: Partial<TimelineItem>): Date | null {
  if (item.snoozedUntil) {
    const d = new Date(item.snoozedUntil);
    if (!isNaN(d.getTime())) return d;
  }
  if (item.dueDate) {
    const d = new Date(item.dueDate);
    if (!isNaN(d.getTime())) return d;
  }
  if (item.metadata?.dueDate) {
    const d = new Date(item.metadata.dueDate);
    if (!isNaN(d.getTime())) return d;
  }
  if (item.metadata?.expiryDate) {
    const d = new Date(item.metadata.expiryDate);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Calculates days difference from reference date (at start of day in user timezone).
 */
export function getDaysDifference(targetDate: Date, referenceDate: Date = new Date()): number {
  const t = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
  const r = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime();
  const diffDays = Math.round((t - r) / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Generates human-friendly badge text & visual variant.
 *
 * KEY FIX: pending_review items now receive variant "review" (not "urgent").
 * "urgent" is reserved exclusively for genuinely overdue (past due-date) items.
 * This prevents tomorrow's unconfirmed items from being mislabelled "Overdue".
 */
export function getItemBadge(item: Partial<TimelineItem>, referenceDate: Date = new Date()): {
  text: string;
  variant: "review" | "urgent" | "today" | "upcoming" | "neutral" | "completed";
} {
  if (item.status === "completed") {
    return { text: "Completed", variant: "completed" };
  }

  if (item.itemType === "waiting_for" || item.metadata?.waitingFor) {
    const who = item.metadata?.waitingFor || "External";
    return { text: `Waiting for: ${who}`, variant: "neutral" };
  }

  const target = getItemTargetDate(item);
  if (!target) {
    if (item.status === "pending_review") {
      return { text: "Needs Confirmation", variant: "review" };
    }
    return { text: "No date", variant: "neutral" };
  }

  const days = getDaysDifference(target, referenceDate);

  if (days < 0 || (days === 0 && target.getTime() <= referenceDate.getTime())) {
    return { text: days < 0 ? `Overdue by ${Math.abs(days)}d` : "Overdue", variant: "urgent" };
  }
  if (days === 0) {
    return { text: "Due today", variant: item.status === "pending_review" ? "review" : "today" };
  }
  if (days === 1) {
    return { text: "Tomorrow", variant: item.status === "pending_review" ? "review" : "upcoming" };
  }
  if (days <= 7) {
    return { text: `In ${days} days`, variant: item.status === "pending_review" ? "review" : "upcoming" };
  }
  return { text: `${days} days`, variant: item.status === "pending_review" ? "review" : "neutral" };
}

/**
 * Intelligently groups items into LifeLoop timeline buckets.
 *
 * KEY FIX: pending_review items are now placed into BOTH needsAttention AND
 * their chronological time bucket (today / tomorrow / thisWeek / upcoming).
 * Previously they were short-circuited into needsAttention only, which caused
 * them to disappear from the Timeline tab entirely.
 */
export function groupItemsIntoTimeline(
  items: TimelineItem[],
  referenceDate: Date = new Date()
): TimelineGrouping {
  const result: TimelineGrouping = {
    needsAttention: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    upcoming: [],
    waitingFor: [],
    past: [],
  };

  for (const rawItem of items) {
    const badge = getItemBadge(rawItem, referenceDate);
    const item = { ...rawItem, badgeText: badge.text, badgeVariant: badge.variant };

    // 1. Completed → past history
    if (item.status === "completed") {
      result.past.push(item);
      continue;
    }

    // 2. Active / Confirmed Waiting-For candidate (skip review check – they appear separately)
    if (
      item.status !== "pending_review" &&
      (item.itemType === "waiting_for" || item.metadata?.isWaitingFor === true || item.metadata?.waitingFor)
    ) {
      result.waitingFor.push(item);
      continue;
    }

    const target = getItemTargetDate(item);

    // 3. Determine the chronological time bucket
    let timelineBucket: "needsAttention" | "today" | "tomorrow" | "thisWeek" | "upcoming";

    if (!target) {
      timelineBucket = "upcoming"; // no due date → long-term bucket
    } else {
      const days = getDaysDifference(target, referenceDate);
      if (days < 0 || (days === 0 && target.getTime() <= referenceDate.getTime())) {
        timelineBucket = "needsAttention"; // genuinely overdue
      } else if (days === 0) {
        timelineBucket = "today";
      } else if (days === 1) {
        timelineBucket = "tomorrow";
      } else if (days <= 7) {
        timelineBucket = "thisWeek";
      } else {
        timelineBucket = "upcoming";
      }
    }

    // 4. pending_review items always appear in needsAttention for the Priority view,
    //    AND are duplicated into their chronological bucket for the Timeline view.
    if (item.status === "pending_review") {
      result.needsAttention.push(item);
      // Only push into chronological bucket if it's not already needsAttention
      // (to avoid double-rendering in Priority view's Needs Attention section)
      if (timelineBucket !== "needsAttention") {
        result[timelineBucket].push(item);
      }
    } else {
      result[timelineBucket].push(item);
    }
  }

  // Sort groups chronologically
  const sortByDate = (a: TimelineItem, b: TimelineItem) => {
    const dateA = getItemTargetDate(a)?.getTime() || 0;
    const dateB = getItemTargetDate(b)?.getTime() || 0;
    return dateA - dateB;
  };

  result.today.sort(sortByDate);
  result.tomorrow.sort(sortByDate);
  result.thisWeek.sort(sortByDate);
  result.upcoming.sort(sortByDate);
  result.needsAttention.sort(sortByDate);

  return result;
}
