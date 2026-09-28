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
  badgeVariant?: "urgent" | "today" | "upcoming" | "neutral" | "completed";
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
 */
export function getItemBadge(item: Partial<TimelineItem>, referenceDate: Date = new Date()): {
  text: string;
  variant: "urgent" | "today" | "upcoming" | "neutral" | "completed";
} {
  if (item.status === "completed") {
    return { text: "Completed", variant: "completed" };
  }

  if (item.status === "pending_review") {
    return { text: "Needs Confirmation", variant: "urgent" };
  }

  if (item.itemType === "waiting_for" || item.metadata?.waitingFor) {
    const who = item.metadata?.waitingFor || "External";
    return { text: `Waiting for: ${who}`, variant: "neutral" };
  }

  const target = getItemTargetDate(item);
  if (!target) {
    return { text: "No date", variant: "neutral" };
  }

  const days = getDaysDifference(target, referenceDate);

  if (days < 0 || (days === 0 && target.getTime() <= referenceDate.getTime())) {
    return { text: days < 0 ? `Overdue by ${Math.abs(days)}d` : "Overdue", variant: "urgent" };
  }
  if (days === 0) {
    return { text: "Due today", variant: "today" };
  }
  if (days === 1) {
    return { text: "Tomorrow", variant: "upcoming" };
  }
  if (days <= 7) {
    return { text: `In ${days} days`, variant: "upcoming" };
  }
  return { text: `${days} days`, variant: "neutral" };
}

/**
 * Intelligently groups items into LifeLoop timeline buckets.
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

    // 1. If completed -> goes to past / completed history
    if (item.status === "completed") {
      result.past.push(item);
      continue;
    }

    // 2. Needs attention (unreviewed AI)
    if (item.status === "pending_review") {
      result.needsAttention.push(item);
      continue;
    }

    // 3. Active / Confirmed Waiting-For candidate
    if (item.itemType === "waiting_for" || item.metadata?.isWaitingFor === true || item.metadata?.waitingFor) {
      result.waitingFor.push(item);
      continue;
    }

    const target = getItemTargetDate(item);

    if (!target) {
      // Items with no due date go into upcoming
      result.upcoming.push(item);
      continue;
    }

    const days = getDaysDifference(target, referenceDate);

    if (days < 0 || (days === 0 && target.getTime() <= referenceDate.getTime())) {
      // Overdue items demand attention! Exactly one bucket per view
      result.needsAttention.push(item);
    } else if (days === 0) {
      result.today.push(item);
    } else if (days === 1) {
      result.tomorrow.push(item);
    } else if (days <= 7) {
      result.thisWeek.push(item);
    } else {
      result.upcoming.push(item);
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
