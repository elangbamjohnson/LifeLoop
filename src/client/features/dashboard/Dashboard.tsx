import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { 
  Plus, 
  Settings, 
  Search, 
  Loader2, 
  CheckCircle2, 
  Clock, 
  AlertTriangle,
  Calendar,
  Hourglass,
  Inbox, 
  Sparkles, 
  Bell, 
  CheckCircle, 
  Bot, 
  Network, 
  Users, 
  LogOut, 
  X, 
  ChevronDown,
  MoreHorizontal,
  Sun,
  Moon
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { createPortal } from "react-dom";
import { CaptureDialog } from "./CaptureDialog";
import { ItemCard } from "./ItemCard";
import { ItemEditModal } from "./ItemEditModal";
import { PreferencesModal } from "./PreferencesModal";
import { InstallModal } from "./InstallModal";
import { ReminderBanner } from "./ReminderBanner";
import { AskView } from "./AskView";
import { LifeGraphView } from "./LifeGraphView";
import { EntityDetailView } from "./EntityDetailView";
import { groupItemsIntoTimeline, TimelineItem, TimelineGrouping } from "../../../shared/utils/timeline";
import { FamilyPage } from "../family/FamilyPage";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useDashboardPolling, Capture } from "../../hooks/useDashboardPolling";
import { extractApiErrorMessage, NETWORK_ERROR_MESSAGE } from "../../lib/apiError";
import { useLiveSync } from "../../hooks/useLiveSync";
import { useNow } from "../../hooks/useNow";
import { getTabClientId } from "../../utils/tabId";

// Capture submission handler
export async function submitCapture(
  data: { type: string; payload: string | File },
  options?: {
    tabId?: string;
    showToast?: (msg: string) => void;
    fetchData?: () => void;
  }
) {
  const formData = new FormData();
  formData.append("type", data.type);
  formData.append("source", "web");

  if (typeof data.payload === "string") {
    formData.append("rawPayload", data.payload);
  } else {
    formData.append("file", data.payload);
  }

  let res: Response;
  try {
    res = await fetch("/api/v1/captures", {
      method: "POST",
      headers: { 
        "X-Client-Id": options?.tabId || "",
        "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      body: formData,
    });
  } catch {
    throw new Error(NETWORK_ERROR_MESSAGE);
  }

  if (!res.ok) {
    const msg = await extractApiErrorMessage(res);
    throw new Error(msg);
  }

  options?.showToast?.("Captured! LifeLoop AI is organizing it in the background.");
  options?.fetchData?.();
}

export { submitCapture as handleCaptureSubmit };

export function Dashboard() {
  const { user, loading: authLoading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isAdmin = Boolean(!authLoading && user?.isAdmin);
  const [activeTab, setActiveTab] = useState<"priority" | "timeline" | "captures" | "ask" | "graph" | "family">("priority");
  const [familyUnreadCount, setFamilyUnreadCount] = useState(0);
  const [isFamilyBannerDismissed, setIsFamilyBannerDismissed] = useState(false);
  const [activeEntity, setActiveEntity] = useState<TimelineItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Stable IANA timezone string — used by every ItemCard's AddToCalendarButton
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;


  // Fail-closed fallback: if activeTab is ask or graph for a non-admin, fall back to priority
  useEffect(() => {
    if (!isAdmin && (activeTab === "ask" || activeTab === "graph")) {
      setActiveTab("priority");
    }
  }, [isAdmin, activeTab]);

  // Modals & Menus
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TimelineItem | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [retryingCaptureId, setRetryingCaptureId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "danger" | "warning" | "info";
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    onConfirm: () => {},
  });

  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const captureBtnRef = useRef<HTMLButtonElement>(null);

  const [profileMenuStyles, setProfileMenuStyles] = useState<React.CSSProperties>({});

  const updateProfileMenuPosition = useCallback(() => {
    if (!profileBtnRef.current) return;
    const rect = profileBtnRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const computedStyle = getComputedStyle(document.documentElement);
    const parsePx = (val: string) => parseFloat(val) || 0;
    const safeTop = parsePx(computedStyle.getPropertyValue("--safe-top"));
    const safeBottom = parsePx(computedStyle.getPropertyValue("--safe-bottom"));
    const safeLeft = parsePx(computedStyle.getPropertyValue("--safe-left"));
    const safeRight = parsePx(computedStyle.getPropertyValue("--safe-right"));

    const MARGIN = 8;
    const chipCenterY = rect.top + rect.height / 2;
    const isUpperHalf = chipCenterY < viewportHeight / 2;

    const styles: React.CSSProperties = {
      position: "fixed",
      zIndex: 60,
      overflowY: "auto",
    };

    const minLeft = MARGIN + safeLeft;
    const maxRight = viewportWidth - MARGIN - safeRight;
    const maxAvailableWidth = maxRight - minLeft;
    const menuWidth = Math.min(224, Math.max(160, maxAvailableWidth));
    styles.width = `${menuWidth}px`;

    if (isUpperHalf) {
      // Opens below the chip
      const top = rect.bottom + MARGIN;
      const availableHeight = viewportHeight - top - safeBottom - MARGIN;
      styles.top = `${top}px`;
      styles.bottom = "auto";
      styles.maxHeight = `${Math.max(100, availableHeight)}px`;

      // Right-aligned with the chip
      let left = rect.right - menuWidth;
      left = Math.max(minLeft, Math.min(left, maxRight - menuWidth));
      styles.left = `${left}px`;
      styles.right = "auto";
    } else {
      // Opens upward when anchor is in lower half (rail/sidebar)
      const bottom = viewportHeight - rect.top + MARGIN;
      const availableHeight = rect.top - safeTop - MARGIN;
      styles.bottom = `${bottom}px`;
      styles.top = "auto";
      styles.maxHeight = `${Math.max(100, availableHeight)}px`;

      // Left-aligned with anchor, clamped inside safe margin
      let left = rect.left;
      left = Math.max(minLeft, Math.min(left, maxRight - menuWidth));
      styles.left = `${left}px`;
      styles.right = "auto";
    }

    setProfileMenuStyles(styles);
  }, []);

  useLayoutEffect(() => {
    if (isProfileMenuOpen) {
      updateProfileMenuPosition();
    }
  }, [isProfileMenuOpen, updateProfileMenuPosition]);

  // Handle profile menu open/close, focus, Esc, and outside click
  useEffect(() => {
    if (!isProfileMenuOpen) return;
    updateProfileMenuPosition();

    const timer = requestAnimationFrame(() => {
      const firstItem = document.getElementById("profile-preferences-btn");
      firstItem?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsProfileMenuOpen(false);
        profileBtnRef.current?.focus();
      }
    };

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(target) &&
        profileBtnRef.current &&
        !profileBtnRef.current.contains(target)
      ) {
        setIsProfileMenuOpen(false);
        profileBtnRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("resize", updateProfileMenuPosition);
    window.addEventListener("scroll", updateProfileMenuPosition, true);

    return () => {
      cancelAnimationFrame(timer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("resize", updateProfileMenuPosition);
      window.removeEventListener("scroll", updateProfileMenuPosition, true);
    };
  }, [isProfileMenuOpen, updateProfileMenuPosition]);

  // Data
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [hasProcessing, setHasProcessing] = useState(false);

  const { captures, setCaptures, items, setItems, loading, refetch: fetchData } =
    useDashboardPolling(hasProcessing, logout);

  // Open item from URL search param if present (?item=<id>)
  const openedUrlItemRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || items.length === 0) return;
    const urlItemId = new URLSearchParams(window.location.search).get("item");
    if (!urlItemId) return;
    if (openedUrlItemRef.current === urlItemId) return;
    const target = items.find((i) => i.id === urlItemId);
    if (target) {
      openedUrlItemRef.current = urlItemId;
      setEditingItem(target);
    }
  }, [items]);

  const tabId = useRef(getTabClientId()).current;
  const lastFetchTimeRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deduplicatedRefetch = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastFetchTimeRef.current;

    if (elapsed >= 1000) {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
      lastFetchTimeRef.current = now;
      fetchData();
    } else if (trailingTimerRef.current === null) {
      const remaining = 1000 - elapsed;
      trailingTimerRef.current = setTimeout(() => {
        trailingTimerRef.current = null;
        lastFetchTimeRef.current = Date.now();
        fetchData();
      }, remaining);
    }
  }, [fetchData]);

  useEffect(() => {
    return () => {
      if (trailingTimerRef.current !== null) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
    };
  }, []);

  const [activeReminderBanner, setActiveReminderBanner] = useState<{
    id: string;
    title: string;
    itemId?: string;
  } | null>(null);

  useLiveSync({
    enabled: Boolean(user),
    tabId,
    onSync: deduplicatedRefetch,
    onAuthError: logout,
    onEvent: (event) => {
      if (event.type === "reminder_delivered" && event.title) {
        setActiveReminderBanner({
          id: event.id,
          title: event.title,
          itemId: event.itemId,
        });
      }
    },
  });

  // Keep hasProcessing in sync with capture statuses after each fetch
  useEffect(() => {
    const next = captures.some(
      (c) =>
        c.processingStatus === "pending" ||
        c.processingStatus === "processing" ||
        c.processingStatus === "fallback_pending_retry",
    );
    setHasProcessing(next);
  }, [captures]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const now = useNow(30000);

  // Filter items by search query (memoized to avoid re-filtering on tick)
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.itemType.toLowerCase().includes(q) ||
        JSON.stringify(i.metadata || {}).toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  // Intelligently compute Life Timeline grouping with live reference time (memoized)
  const timeline: TimelineGrouping = useMemo(
    () => groupItemsIntoTimeline(filteredItems, now),
    [filteredItems, now]
  );

  // Capture submission handler
  const handleCaptureSubmit = async (data: { type: string; payload: string | File }) => {
    await submitCapture(data, { tabId, showToast, fetchData });
  };

  // Toggle complete
  const handleToggleComplete = async (id: string, completed: boolean) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: completed ? "completed" : "active" } : i))
    );

    try {
      await fetch(`/api/v1/items/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": tabId },
        body: JSON.stringify({ completed }),
      });
      showToast(completed ? "Marked complete" : "Reopened item");
      fetchData();
    } catch (err) {
      console.error(err);
      fetchData();
    }
  };

  // Snooze item
  const handleSnooze = async (id: string, days: number) => {
    try {
      await fetch(`/api/v1/items/${id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": tabId },
        body: JSON.stringify({ snoozeDays: days }),
      });
      showToast(`Snoozed for ${days} day${days > 1 ? "s" : ""}`);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Confirm low-confidence AI parse
  const handleConfirmAI = async (id: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "active" } : i))
    );
    try {
      await fetch(`/api/v1/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Client-Id": tabId },
        body: JSON.stringify({ status: "active" }),
      });
      showToast("Confirmed into LifeLoop!");
      fetchData();
    } catch (err) {
      console.error(err);
      fetchData();
    }
  };

  // Delete item
  const handleDeleteItem = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete this life item?",
      description: "This item will be permanently removed from your LifeLoop.",
      confirmLabel: "Delete Item",
      variant: "danger",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          await fetch(`/api/v1/items/${id}`, {
            method: "DELETE",
            headers: { "X-Client-Id": tabId },
          });
          setItems((prev) => prev.filter((i) => i.id !== id));
          showToast("Item deleted");
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  // Save edited item
  const handleSaveItemEdit = async (updated: Partial<TimelineItem> & { reminderOffsets?: number[]; recurrence?: string; channel?: string }) => {
    if (!editingItem) return;
    try {
      const res = await fetch(`/api/v1/items/${editingItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Client-Id": tabId, "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        showToast("Changes saved");
        fetchData();
        setEditingItem(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCapture = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete this capture?",
      description: "Original raw capture and extracted data will be removed.",
      confirmLabel: "Delete Capture",
      variant: "danger",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        try {
          const res = await fetch(`/api/v1/captures/${id}`, {
            method: "DELETE",
            headers: { "X-Client-Id": tabId },
          });
          if (res.ok) {
            setCaptures((prev) => prev.filter((c) => c.id !== id));
            showToast("Capture deleted");
          }
        } catch (err) {
          console.error(err);
        }
      },
    });
  };

  const handleRetryCapture = async (captureId: string) => {
    try {
      setRetryingCaptureId(captureId);
      const res = await fetch(`/api/v1/captures/${captureId}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
          "X-Client-Id": tabId,
        },
      });
      if (!res.ok) throw new Error("Retry request failed");
      showToast("AI enrichment retry initiated");
      deduplicatedRefetch();
    } catch (err: any) {
      console.error("Retry capture error:", err);
      showToast("Failed to initiate AI retry");
    } finally {
      setTimeout(() => setRetryingCaptureId(null), 1000);
    }
  };

  const getStatusIcon = (status: string, metadata?: any) => {
    if (status === "completed" && metadata?.aiEnrichmentFailed) {
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    }
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
      case "processing":
        return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
      case "fallback_pending_retry":
        return <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />;
      case "failed":
        return <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-stone-400" />;
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // MORE BOTTOM SHEET HANDLERS & NAVIGATION
  // ────────────────────────────────────────────────────────────────────────────
  const closeMore = () => {
    setIsMoreOpen(false);
    if (typeof window !== "undefined" && window.history.state?.modal === "more-sheet") {
      window.history.back();
    }
    setTimeout(() => {
      moreBtnRef.current?.focus();
    }, 50);
  };

  const openMore = () => {
    setIsMoreOpen(true);
    if (typeof window !== "undefined") {
      window.history.pushState({ modal: "more-sheet" }, "");
    }
  };

  // Android back gesture & popstate listener
  useEffect(() => {
    const handlePopState = () => {
      if (isMoreOpen) {
        setIsMoreOpen(false);
        moreBtnRef.current?.focus();
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isMoreOpen]);

  // Escape key & focus trap for More bottom sheet
  useEffect(() => {
    if (!isMoreOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMore();
      }
      if (e.key === "Tab" && moreSheetRef.current) {
        const focusable = moreSheetRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMoreOpen]);

  // Swipe-down gesture detection on More sheet
  const touchStartY = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchCurrentY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchCurrentY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (touchStartY.current !== null && touchCurrentY.current !== null) {
      const diff = touchCurrentY.current - touchStartY.current;
      if (diff > 60) {
        closeMore();
      }
    }
    touchStartY.current = null;
    touchCurrentY.current = null;
  };

  // Tab list definitions filtered once
  const allDestinations = [
    { id: "priority", label: "Priority", icon: Sparkles, color: "text-amber-500", adminOnly: false },
    { id: "timeline", label: "Timeline", icon: Clock, color: "text-blue-500", adminOnly: false },
    { id: "captures", label: "Inbox", icon: Inbox, color: "text-emerald-500", count: captures.length, adminOnly: false },
    { id: "ask", label: "Ask", icon: Bot, color: "text-indigo-500", adminOnly: true },
    { id: "graph", label: "Graph", icon: Network, color: "text-purple-500", adminOnly: true },
    { id: "family", label: "Family", icon: Users, color: "text-emerald-500", badge: familyUnreadCount, adminOnly: false },
  ] as const;

  const visibleDestinations = allDestinations.filter((dest) => !dest.adminOnly || isAdmin);

  // Arrow key navigation between destinations (roving tabindex)
  const handleTabKeyDown = (e: React.KeyboardEvent, tabId: string) => {
    const currentIndex = visibleDestinations.findIndex((d) => d.id === tabId);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % visibleDestinations.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + visibleDestinations.length) % visibleDestinations.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = visibleDestinations.length - 1;
    } else {
      return;
    }
    const nextDestination = visibleDestinations[nextIndex];
    setActiveTab(nextDestination.id as any);
    document.getElementById(`tab-${nextDestination.id}`)?.focus();
  };

  const isMoreActive = activeTab === "graph" || activeTab === "family";
  const formattedDate = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7]">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] px-4 py-2.5 rounded-full shadow-2xl text-xs font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          {toastMessage}
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────
          UNIFIED NAVIGATION CHROME (Option B) - One DOM restyled by CSS
          Under 600px: Fixed bottom bar, 64px + safe area; top phone header
          600-839px (or landscape phone): 80px rail
          840px+: 256px sidebar
          ──────────────────────────────────────────────────────────────────── */}
      <header className="w-[80px] app-chrome">
        {/* Brand & Actions Container */}
        <div className="chrome-top-bar">
          {/* Brand section */}
          <div className="brand-container">
            <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center text-white shrink-0 shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="brand-title text-xl font-serif font-bold tracking-tight text-[#1C1917] dark:text-[#FDFBF7]">
                LifeLoop
              </h1>
              <p className="landscape-hide text-[11px] sm:text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">
                {formattedDate}
              </p>
            </div>
          </div>

          {/* Settings & Profile Actions */}
          <div className="actions-container">
            <button
              id="theme-toggle-btn"
              type="button"
              onClick={toggleTheme}
              className="touch-target-48 min-w-[48px] min-h-[48px] flex items-center justify-center p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#78716C] dark:text-[#A8A29E] shrink-0"
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? (
                <Sun className="w-5 h-5 text-amber-400" />
              ) : (
                <Moon className="w-5 h-5 text-[#78716C]" />
              )}
            </button>

            {user && (
              <div className="relative shrink-0">
                <button
                  ref={profileBtnRef}
                  id="user-profile-menu-btn"
                  type="button"
                  onClick={() => {
                    if (isProfileMenuOpen) {
                      setIsProfileMenuOpen(false);
                    } else {
                      updateProfileMenuPosition();
                      setIsProfileMenuOpen(true);
                    }
                  }}
                  className="touch-target-48 min-w-[48px] min-h-[48px] flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-100 dark:bg-stone-800 hover:bg-stone-200/80 dark:hover:bg-stone-700/80 border border-stone-200 dark:border-stone-700 text-xs font-medium cursor-pointer transition-colors max-w-[160px]"
                  title={`Account menu (${user.email})`}
                  aria-expanded={isProfileMenuOpen}
                  aria-haspopup="menu"
                >
                  <div className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xs font-bold uppercase shrink-0">
                    {user.email ? user.email[0] : "U"}
                  </div>
                  <span className="hidden sm:inline truncate text-xs text-stone-700 dark:text-stone-300 max-w-[80px]">
                    {user.email}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-stone-400 shrink-0 transition-transform duration-200 ${isProfileMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Profile popover dropdown */}
                {isProfileMenuOpen && typeof document !== "undefined" && createPortal(
                  <div
                    ref={profileMenuRef}
                    id="profile-popover"
                    role="menu"
                    aria-label="Account menu"
                    tabIndex={-1}
                    style={profileMenuStyles}
                    className="bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-2xl shadow-xl py-1.5 animate-in fade-in transition-all"
                  >
                    <div className="px-3.5 py-2.5 border-b border-[#F5F5F4] dark:border-[#383330]">
                      <p className="text-[10px] font-semibold text-[#A8A29E] uppercase tracking-wider">Signed in as</p>
                      <p className="text-xs font-medium text-[#1C1917] dark:text-[#FDFBF7] truncate mt-0.5">{user.email}</p>
                    </div>
                    <div className="p-1.5 space-y-0.5">
                      <button
                        id="profile-theme-btn"
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          toggleTheme();
                          setIsProfileMenuOpen(false);
                          profileBtnRef.current?.focus();
                        }}
                        className="touch-target-48 min-h-[48px] w-full flex items-center gap-2 px-3 py-2 text-xs text-[#1C1917] dark:text-[#FDFBF7] hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors text-left"
                        title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                        aria-label={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                      >
                        {theme === "dark" ? (
                          <>
                            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                            <span className="font-medium">Light Mode</span>
                          </>
                        ) : (
                          <>
                            <Moon className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E] shrink-0" />
                            <span className="font-medium">Dark Mode</span>
                          </>
                        )}
                      </button>
                      <button
                        id="profile-preferences-btn"
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          setIsPreferencesOpen(true);
                          profileBtnRef.current?.focus();
                        }}
                        className="touch-target-48 min-h-[48px] w-full flex items-center gap-2 px-3 py-2 text-xs text-[#1C1917] dark:text-[#FDFBF7] hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors text-left"
                        title="Reminder Preferences"
                        aria-label="Reminder Preferences"
                      >
                        <Settings className="w-4 h-4 text-amber-500 shrink-0" />
                        <span className="font-medium">Preferences</span>
                      </button>
                      <button
                        id="logout-btn"
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          logout();
                        }}
                        className="touch-target-48 min-h-[48px] w-full flex items-center gap-2 px-3 py-2 text-xs text-[#78716C] hover:text-red-600 dark:hover:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors text-left"
                        title="Log Out"
                        aria-label="Log Out"
                      >
                        <LogOut className="w-4 h-4 text-red-500 shrink-0" />
                        <span className="font-medium">Log out</span>
                      </button>
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tablist navigation (Non-admin: 4 items directly; Admin: 4 items + More button on phone; Graph & Family in More sheet / inline) */}
        <nav aria-label="Main Destinations" className="chrome-tablist">
          <div role="tablist" className="contents">
            {/* 1. Priority */}
            <button
              type="button"
              id="tab-priority"
              role="tab"
              aria-selected={activeTab === "priority"}
              aria-controls="panel-priority"
              tabIndex={activeTab === "priority" ? 0 : -1}
              onKeyDown={(e) => handleTabKeyDown(e, "priority")}
              onClick={() => setActiveTab("priority")}
              className={`chrome-tab-item touch-target-48 ${
                activeTab === "priority"
                  ? "bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] shadow-xs font-semibold"
                  : "text-[#57534E] dark:text-[#D6D3D1] hover:text-[#1C1917] dark:hover:text-white"
              }`}
            >
              <Sparkles className="w-5 h-5 text-amber-500 shrink-0" />
              <span>Priority</span>
            </button>

            {/* 2. Timeline */}
            <button
              type="button"
              id="tab-timeline"
              role="tab"
              aria-selected={activeTab === "timeline"}
              aria-controls="panel-timeline"
              tabIndex={activeTab === "timeline" ? 0 : -1}
              onKeyDown={(e) => handleTabKeyDown(e, "timeline")}
              onClick={() => setActiveTab("timeline")}
              className={`chrome-tab-item touch-target-48 ${
                activeTab === "timeline"
                  ? "bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] shadow-xs font-semibold"
                  : "text-[#57534E] dark:text-[#D6D3D1] hover:text-[#1C1917] dark:hover:text-white"
              }`}
            >
              <Clock className="w-5 h-5 text-blue-500 shrink-0" />
              <span>Timeline</span>
            </button>

            {/* 3. Inbox (Captures) */}
            <button
              type="button"
              id="tab-captures"
              role="tab"
              aria-selected={activeTab === "captures"}
              aria-controls="panel-captures"
              tabIndex={activeTab === "captures" ? 0 : -1}
              onKeyDown={(e) => handleTabKeyDown(e, "captures")}
              onClick={() => setActiveTab("captures")}
              className={`chrome-tab-item touch-target-48 ${
                activeTab === "captures"
                  ? "bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] shadow-xs font-semibold"
                  : "text-[#57534E] dark:text-[#D6D3D1] hover:text-[#1C1917] dark:hover:text-white"
              }`}
            >
              <div className="relative inline-flex shrink-0">
                <Inbox className="w-5 h-5 text-emerald-500 shrink-0" />
                {captures.length > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center leading-none pointer-events-none shadow-xs">
                    {captures.length > 99 ? "99+" : captures.length}
                  </span>
                )}
              </div>
              <span>Inbox</span>
            </button>

            {/* 4. Ask (Admin only) */}
            {isAdmin && (
              <button
                type="button"
                id="tab-ask"
                role="tab"
                aria-selected={activeTab === "ask"}
                aria-controls="panel-ask"
                tabIndex={activeTab === "ask" ? 0 : -1}
                onKeyDown={(e) => handleTabKeyDown(e, "ask")}
                onClick={() => {
                  setActiveTab("ask");
                  setActiveEntity(null);
                }}
                className={`chrome-tab-item touch-target-48 ${
                  activeTab === "ask"
                    ? "bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] shadow-xs font-semibold"
                    : "text-[#57534E] dark:text-[#D6D3D1] hover:text-[#1C1917] dark:hover:text-white"
                }`}
              >
                <Bot className="w-5 h-5 text-indigo-500 shrink-0" />
                <span>Ask</span>
              </button>
            )}

            {/* If Non-Admin, Family is rendered directly in tablist (4 items total, no More button) */}
            {!isAdmin && (
              <button
                type="button"
                id="tab-family"
                role="tab"
                aria-selected={activeTab === "family"}
                aria-controls="panel-family"
                tabIndex={activeTab === "family" ? 0 : -1}
                onKeyDown={(e) => handleTabKeyDown(e, "family")}
                onClick={() => {
                  setActiveTab("family");
                  setActiveEntity(null);
                }}
                className={`chrome-tab-item touch-target-48 ${
                  activeTab === "family"
                    ? "bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] shadow-xs font-semibold"
                    : "text-[#57534E] dark:text-[#D6D3D1] hover:text-[#1C1917] dark:hover:text-white"
                }`}
              >
                <div className="relative inline-flex shrink-0">
                  <Users className="w-5 h-5 text-emerald-500 shrink-0" />
                  {familyUnreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none pointer-events-none shadow-xs">
                      {familyUnreadCount > 9 ? "9+" : familyUnreadCount}
                    </span>
                  )}
                </div>
                <span>Family</span>
              </button>
            )}
          </div>

          {/* 5. More button (Admin only, phone only, outside tablist — reached by Tab after the tabs) */}
          {isAdmin && (
            <button
              type="button"
              id="tab-more"
              ref={moreBtnRef}
              aria-haspopup="dialog"
              aria-expanded={isMoreOpen}
              aria-controls="more-sheet-wrapper"
              aria-label="More navigation options"
              onClick={() => {
                if (isMoreOpen) closeMore();
                else openMore();
              }}
              className={`chrome-tab-item touch-target-48 ${
                isMoreActive
                  ? "bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] shadow-xs font-semibold"
                  : "text-[#57534E] dark:text-[#D6D3D1] hover:text-[#1C1917] dark:hover:text-white"
              }`}
            >
              <MoreHorizontal className={`w-5 h-5 shrink-0 ${isMoreActive ? "text-amber-500" : ""}`} />
              <span>More</span>
            </button>
          )}
        </nav>

        {/* Graph & Family Container (Admin only: More sheet on phone, inline in rail/sidebar) */}
        {isAdmin && (
          <div
            id="more-sheet-wrapper"
            className={isMoreOpen ? "sheet-open" : ""}
            role={isMoreOpen ? "dialog" : undefined}
            aria-modal={isMoreOpen ? "true" : undefined}
            aria-labelledby={isMoreOpen ? "more-sheet-title" : undefined}
          >
            {/* Backdrop for phone bottom sheet */}
            <div
              id="more-sheet-backdrop"
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
              onClick={closeMore}
              aria-hidden="true"
            />

            {/* Bottom sheet content */}
            <div
              id="more-sheet-content"
              className="bg-white dark:bg-[#1C1917] rounded-t-3xl p-4 relative z-10"
              ref={moreSheetRef}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              {/* Swipe handle for phone */}
              <div id="more-sheet-handle" className="w-12 h-1.5 bg-stone-300 dark:bg-stone-700 rounded-full mx-auto mb-4" />

              {/* Header for phone sheet */}
              <div id="more-sheet-header" className="flex items-center justify-between mb-4">
                <h3 id="more-sheet-title" className="text-base font-semibold text-[#1C1917] dark:text-[#FDFBF7]">
                  More Views
                </h3>
                <button
                  type="button"
                  onClick={closeMore}
                  className="touch-target-48 min-w-[48px] min-h-[48px] p-2 text-stone-500 hover:text-stone-900 dark:hover:text-white rounded-full flex items-center justify-center"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 5. Graph Tab & 6. Family Tab */}
              <div role="tablist" aria-label="More Views Tabs" className="flex flex-col">
                <button
                  type="button"
                  id="tab-graph"
                  role="tab"
                  aria-selected={activeTab === "graph"}
                  aria-controls="panel-graph"
                  tabIndex={activeTab === "graph" ? 0 : -1}
                  onKeyDown={(e) => handleTabKeyDown(e, "graph")}
                  onClick={() => {
                    setActiveTab("graph");
                    setActiveEntity(null);
                    if (isMoreOpen) closeMore();
                  }}
                  className={`chrome-tab-item touch-target-48 ${
                    activeTab === "graph"
                      ? "bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] shadow-xs font-semibold"
                      : "text-[#57534E] dark:text-[#D6D3D1] hover:text-[#1C1917] dark:hover:text-white"
                  }`}
                >
                  <Network className="w-5 h-5 text-purple-500 shrink-0" />
                  <span>Graph</span>
                </button>

                <button
                  type="button"
                  id="tab-family"
                  role="tab"
                  aria-selected={activeTab === "family"}
                  aria-controls="panel-family"
                  tabIndex={activeTab === "family" ? 0 : -1}
                  onKeyDown={(e) => handleTabKeyDown(e, "family")}
                  onClick={() => {
                    setActiveTab("family");
                    setActiveEntity(null);
                    if (isMoreOpen) closeMore();
                  }}
                  className={`chrome-tab-item touch-target-48 ${
                    activeTab === "family"
                      ? "bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] shadow-xs font-semibold"
                      : "text-[#57534E] dark:text-[#D6D3D1] hover:text-[#1C1917] dark:hover:text-white"
                  }`}
                >
                  <div className="relative inline-flex shrink-0">
                    <Users className="w-5 h-5 text-emerald-500 shrink-0" />
                    {familyUnreadCount > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none pointer-events-none shadow-xs">
                        {familyUnreadCount > 9 ? "9+" : familyUnreadCount}
                      </span>
                    )}
                  </div>
                  <span>Family</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ────────────────────────────────────────────────────────────────────
          MAIN CONTENT AREA
          Search scrolls with content (not sticky).
          Same search element in every mode.
          ──────────────────────────────────────────────────────────────────── */}
      <main className="main-viewport max-w-4xl mx-auto px-4 sm:px-6 pt-4 pb-8 space-y-6">
        {/* Search Bar - Single element in every mode, scrolls with feed */}
        <div className="relative w-full">
          <Search className="w-4 h-4 text-[#A8A29E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id="search-input"
            type="text"
            placeholder="Search bills, renewals, tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 min-h-[48px] py-2 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl text-base placeholder:text-[#A8A29E] text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-amber-500 transition-all shadow-xs"
          />
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20 text-[#A8A29E]">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading LifeLoop...
          </div>
        )}

        {!loading && items.length === 0 && captures.length === 0 && (
          <div className="text-center py-24 bg-white/40 dark:bg-[#23201E]/40 rounded-3xl border border-dashed border-[#E7E5E4] dark:border-[#383330] p-8">
            <h3 className="text-lg font-serif text-[#1C1917] dark:text-[#FDFBF7] mb-1">
              Your LifeLoop is peaceful and clear.
            </h3>
            <p className="text-sm text-[#78716C] dark:text-[#A8A29E] max-w-md mx-auto">
              Tap the <strong>+ Capture</strong> button to deposit a bill, insurance renewal, reminder, or thought.
            </p>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 1: PRIORITY HOME SCREEN                        */}
        {/* Order: 1. Needs Attention -> 2. Today -> 3. Upcoming */}
        {/*        -> 4. Waiting For Placeholder                */}
        {/* ---------------------------------------------------- */}
        {!loading && activeTab === "priority" && (
          <div
            role="tabpanel"
            id="panel-priority"
            aria-labelledby="tab-priority"
            tabIndex={0}
            className="focus:outline-none space-y-8"
          >
            {/* Family Sharing Banner (Conditional) */}
            {!isFamilyBannerDismissed && (familyUnreadCount > 0 || items.some(i => (i.metadata as any)?.isFamilyShared)) && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded-xl p-3.5 flex items-center justify-between text-xs gap-3">
                <div className="flex items-center gap-2.5 text-amber-900 dark:text-amber-200 min-w-0">
                  <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0">
                    <Users className="w-4 h-4" />
                  </div>
                  <span className="truncate">
                    <strong>Family Hub:</strong> {familyUnreadCount > 0 ? `${familyUnreadCount} unread shared activity items.` : "Shared circle items are synced and active."}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => { setActiveTab("family"); setActiveEntity(null); }}
                    className="text-amber-800 dark:text-amber-300 font-semibold hover:underline"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFamilyBannerDismissed(true)}
                    className="p-1 text-amber-700/60 dark:text-amber-400/60 hover:text-amber-900 dark:hover:text-amber-200 rounded"
                    title="Dismiss alert"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Reminders / Due Today Carousel */}
            {(() => {
              const reminderItems = [...timeline.needsAttention, ...timeline.today].filter(
                (item) => item.status !== "completed"
              );
              if (reminderItems.length === 0) return null;
              return (
                <section id="section-reminders-carousel" className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-stone-800 dark:text-stone-200">
                      <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <h2 className="text-xs font-semibold uppercase tracking-wider">
                        Reminders & Due Today ({reminderItems.length})
                      </h2>
                    </div>
                  </div>

                  <div className="flex gap-3 overflow-x-auto no-scrollbar py-1">
                    {reminderItems.map((item) => {
                      // KEY FIX: "urgent" (past due date) is overdue.
                      // "review" (pending_review) is NEVER shown as overdue—
                      // even if badgeVariant was previously "urgent" for review items.
                      const isPendingReview = item.status === "pending_review";
                      const isOverdue = !isPendingReview && (
                        item.badgeVariant === "urgent" ||
                        (item.dueDate && new Date(item.dueDate).getTime() <= now.getTime())
                      );
                      const isToday = !isOverdue && !isPendingReview && item.dueDate && new Date(item.dueDate).toDateString() === now.toDateString();
                      return (
                        <div
                          key={`carousel-${item.id}`}
                          className={`p-3.5 rounded-xl bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] shadow-sm hover:shadow-md transition-all flex flex-col justify-between ${
                            reminderItems.length === 1
                              ? "w-full"
                              : "min-w-[250px] sm:min-w-[270px] max-w-[290px] shrink-0"
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-1.5 mb-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${
                                isPendingReview
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60"
                                  : isOverdue
                                  ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60"
                                  : isToday
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60"
                                  : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60"
                              }`}>
                                {isPendingReview ? "Needs Review" : isOverdue ? "Overdue" : isToday ? "Today" : "Upcoming"}
                              </span>
                              {item.dueDate && (
                                <span className="text-[11px] text-[#A8A29E] flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {new Date(item.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                </span>
                              )}
                            </div>
                            <h4 className="text-xs sm:text-sm font-semibold text-[#1C1917] dark:text-[#FDFBF7] line-clamp-2">
                              {item.title}
                            </h4>
                          </div>

                          <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-[#F5F5F4] dark:border-[#383330]">
                            <button
                              type="button"
                              onClick={() => handleToggleComplete(item.id, true)}
                              className="touch-target-48 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-800"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Done
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSnooze(item.id, 1)}
                              className="touch-target-48 inline-flex items-center gap-1 text-[11px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-white"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              +1d
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingItem(item)}
                              className="touch-target-48 text-[11px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-white"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })()}

            {/* 1. NEEDS ATTENTION */}
            {timeline.needsAttention.length > 0 && (
              <section id="section-needs-attention" className="space-y-3">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider">
                    Needs Attention ({timeline.needsAttention.length})
                  </h2>
                </div>
                <div className="space-y-2.5">
                  {timeline.needsAttention.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 2. TODAY */}
            <section id="section-today" className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
                  <CheckCircle className="w-4 h-4" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider">
                    Today ({timeline.today.filter(i => i.status !== "pending_review").length})
                  </h2>
                </div>
              </div>

              {timeline.today.filter(i => i.status !== "pending_review").length === 0 ? (
                <div className="py-5 px-4 bg-white/50 dark:bg-[#23201E]/50 rounded-2xl border border-[#E7E5E4] dark:border-[#383330] text-xs text-[#78716C] dark:text-[#A8A29E]">
                  Nothing due today. You are completely on track!
                </div>
              ) : (
                <div className="space-y-2.5">
                  {timeline.today.filter(i => i.status !== "pending_review").map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* 3. UPCOMING */}
            <section id="section-upcoming" className="space-y-3">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                <Calendar className="w-4 h-4" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Upcoming ({[...timeline.tomorrow, ...timeline.thisWeek, ...timeline.upcoming].filter(i => i.status !== "pending_review").length})
                </h2>
              </div>

              {[...timeline.tomorrow, ...timeline.thisWeek, ...timeline.upcoming].filter(i => i.status !== "pending_review").length === 0 ? (
                <div className="py-5 px-4 bg-white/50 dark:bg-[#23201E]/50 rounded-2xl border border-[#E7E5E4] dark:border-[#383330] text-xs text-[#78716C] dark:text-[#A8A29E]">
                  No upcoming deadlines detected yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {[...timeline.tomorrow, ...timeline.thisWeek, ...timeline.upcoming].filter(i => i.status !== "pending_review").map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* 4. WAITING FOR SECTION */}
            {timeline.waitingFor.length > 0 && (
              <section id="section-waiting-for" className="space-y-3">
                <div className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
                  <Hourglass className="w-4 h-4" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider">
                    Waiting For ({timeline.waitingFor.length})
                  </h2>
                </div>

                <div className="space-y-2.5">
                  {timeline.waitingFor.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 2: CHRONOLOGICAL LIFE TIMELINE                  */}
        {/* ---------------------------------------------------- */}
        {!loading && activeTab === "timeline" && (
          <div
            role="tabpanel"
            id="panel-timeline"
            aria-labelledby="tab-timeline"
            tabIndex={0}
            className="focus:outline-none space-y-8"
          >
            {/* OVERDUE / ATTENTION */}
            {timeline.needsAttention.filter(i => !i.dueDate || new Date(i.dueDate).getTime() <= now.getTime()).length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Overdue / Needs Attention ({timeline.needsAttention.filter(i => !i.dueDate || new Date(i.dueDate).getTime() <= now.getTime()).length})
                </h2>
                <div className="space-y-2.5 pl-3 border-l-2 border-rose-200 dark:border-rose-900/60">
                  {timeline.needsAttention.filter(i => !i.dueDate || new Date(i.dueDate).getTime() <= now.getTime()).map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* TODAY */}
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                Today ({timeline.today.length})
              </h2>
              {timeline.today.length === 0 ? (
                <p className="text-xs text-[#78716C] italic pl-4">No events scheduled today</p>
              ) : (
                <div className="space-y-2.5 pl-3 border-l-2 border-rose-200 dark:border-rose-900/60">
                  {timeline.today.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* TOMORROW */}
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                Tomorrow ({timeline.tomorrow.length})
              </h2>
              {timeline.tomorrow.length === 0 ? (
                <p className="text-xs text-[#78716C] italic pl-4">No events tomorrow</p>
              ) : (
                <div className="space-y-2.5 pl-3 border-l-2 border-blue-200 dark:border-blue-900/60">
                  {timeline.tomorrow.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* THIS WEEK */}
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500" />
                This Week ({timeline.thisWeek.length})
              </h2>
              {timeline.thisWeek.length === 0 ? (
                <p className="text-xs text-[#78716C] italic pl-4">Clear rest of the week</p>
              ) : (
                <div className="space-y-2.5 pl-3 border-l-2 border-indigo-200 dark:border-indigo-900/60">
                  {timeline.thisWeek.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* UPCOMING */}
            <div className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-stone-400" />
                Upcoming / Long-Term Horizon ({timeline.upcoming.length})
              </h2>
              {timeline.upcoming.length === 0 ? (
                <p className="text-xs text-[#78716C] italic pl-4">No long-term items</p>
              ) : (
                <div className="space-y-2.5 pl-3 border-l-2 border-stone-200 dark:border-stone-800">
                  {timeline.upcoming.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* WAITING FOR */}
            {timeline.waitingFor.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  Waiting For ({timeline.waitingFor.length})
                </h2>
                <div className="space-y-2.5 pl-3 border-l-2 border-purple-200 dark:border-purple-900/60">
                  {timeline.waitingFor.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* PAST / COMPLETED */}
            {timeline.past.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-stone-200 dark:border-stone-800">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Past / Completed History ({timeline.past.length})
                </h2>
                <div className="space-y-2.5 pl-3 border-l-2 border-stone-200 dark:border-stone-800">
                  {timeline.past.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
                      onConfirmAI={handleConfirmAI}
                      userTimezone={userTimezone}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 3: RAW CAPTURES INBOX                           */}
        {/* ---------------------------------------------------- */}
        {!loading && activeTab === "captures" && (
          <div
            role="tabpanel"
            id="panel-captures"
            aria-labelledby="tab-captures"
            tabIndex={0}
            className="focus:outline-none space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A8A29E]">
                Raw Captures ({captures.length})
              </h2>
              <p className="text-xs text-[#78716C]">
                Original input text & files are preserved permanently
              </p>
            </div>

            {captures.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#78716C]">
                No captures yet. Tap Capture below!
              </div>
            ) : (
              <div className="space-y-3">
                {captures.map((capture) => (
                  <div
                    key={capture.id}
                    className="bg-white dark:bg-[#23201E] p-4 rounded-2xl border border-[#E7E5E4] dark:border-[#383330] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                          {capture.type}
                        </span>
                        {getStatusIcon(capture.processingStatus, capture.metadata)}
                        <span className="text-[11px] text-[#A8A29E]">
                          {capture.processingStatus === "fallback_pending_retry"
                            ? "enriching with AI..."
                            : (capture.metadata as any)?.aiEnrichmentFailed
                            ? "saved (AI unavailable)"
                            : capture.processingStatus}
                        </span>
                      </div>

                      {capture.type === "text" ? (
                        <p className="text-sm font-medium text-[#1C1917] dark:text-[#FDFBF7] truncate">
                          {capture.rawPayload}
                        </p>
                      ) : (
                        <div className="flex items-center gap-3">
                          {capture.type === "image" && (
                            <div className="w-10 h-10 rounded-lg bg-stone-100 overflow-hidden flex-shrink-0">
                              <img
                                src={capture.rawPayload}
                                alt="upload"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                          <p className="text-sm font-medium truncate">
                            {capture.originalFilename || "Attached File"}
                          </p>
                        </div>
                      )}

                      <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E] mt-1">
                        {new Date(capture.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {((capture.metadata as any)?.aiEnrichmentFailed || capture.processingStatus === "failed") && (
                        <button
                          type="button"
                          onClick={() => handleRetryCapture(capture.id)}
                          disabled={retryingCaptureId === capture.id}
                          className="touch-target-48 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors shadow-xs"
                          title="Retry AI extraction"
                        >
                          <Sparkles className={`w-3.5 h-3.5 ${retryingCaptureId === capture.id ? "animate-spin" : ""}`} />
                          <span>{retryingCaptureId === capture.id ? "Retrying..." : "Retry AI"}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteCapture(capture.id)}
                        className="touch-target-48 text-xs text-stone-400 hover:text-red-500 transition-colors p-2"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 4: ASK MY LIFE (RAG / AI)                       */}
        {/* ---------------------------------------------------- */}
        {!loading && isAdmin && activeTab === "ask" && (
          <div
            role="tabpanel"
            id="panel-ask"
            aria-labelledby="tab-ask"
            tabIndex={0}
            className="focus:outline-none"
          >
            <AskView 
              onEditItem={setEditingItem}
              onToggleComplete={handleToggleComplete}
              onSnooze={handleSnooze}
              onDelete={handleDeleteItem}
            />
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 5: LIFE GRAPH (Entities)                        */}
        {/* ---------------------------------------------------- */}
        {!loading && isAdmin && activeTab === "graph" && (
          <div
            role="tabpanel"
            id="panel-graph"
            aria-labelledby="tab-graph"
            tabIndex={0}
            className="focus:outline-none"
          >
            {activeEntity ? (
              <EntityDetailView 
                entity={activeEntity}
                onBack={() => setActiveEntity(null)}
                onEditItem={setEditingItem}
                onToggleComplete={handleToggleComplete}
                onSnooze={handleSnooze}
                onDelete={handleDeleteItem}
              />
            ) : (
              <LifeGraphView 
                onOpenEntity={setActiveEntity}
              />
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 6: FAMILY                                        */}
        {/* ---------------------------------------------------- */}
        {activeTab === "family" && (
          <div
            role="tabpanel"
            id="panel-family"
            aria-labelledby="tab-family"
            tabIndex={0}
            className="focus:outline-none"
          >
            <FamilyPage />
          </div>
        )}
      </main>

      {/* ────────────────────────────────────────────────────────────────────
          FLOATING ACTION BUTTON (Quick Capture)
          Above bottom bar on phones (calc(64px + 16px + safe area)), 16px on rail/sidebar
          Hidden on Ask tab
          ──────────────────────────────────────────────────────────────────── */}
      <div className={`fab-button-container ${activeTab === "ask" ? "hidden" : ""}`}>
        <button
          ref={captureBtnRef}
          id="global-capture-btn"
          type="button"
          onClick={() => setIsCaptureOpen(true)}
          className="touch-target-48 min-w-[48px] min-h-[48px] flex items-center justify-center gap-2 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] p-3.5 sm:px-5 sm:py-3.5 rounded-full shadow-2xl hover:scale-105 active:scale-95 transition-all duration-150 border border-black/10 dark:border-white/10 text-xs font-semibold cursor-pointer"
          title="Quick Capture"
          aria-label="Quick Capture"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
          <span className="hidden sm:inline font-semibold">Capture</span>
        </button>
      </div>

      {/* ────────────────────────────────────────────────────────────────────
          MODALS
          ──────────────────────────────────────────────────────────────────── */}
      <CaptureDialog
        isOpen={isCaptureOpen}
        isAdmin={isAdmin}
        onClose={() => {
          setIsCaptureOpen(false);
          setTimeout(() => {
            captureBtnRef.current?.focus();
          }, 50);
        }}
        onSubmit={handleCaptureSubmit}
      />

      <PreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => {
          setIsPreferencesOpen(false);
          setTimeout(() => {
            profileBtnRef.current?.focus();
          }, 50);
        }}
      />

      <InstallModal
        isOpen={isInstallOpen}
        onClose={() => setIsInstallOpen(false)}
      />

      {editingItem && (
        <ItemEditModal
          isOpen={true}
          onClose={() => setEditingItem(null)}
          item={editingItem}
          onSave={handleSaveItemEdit}
          userTimezone={(user as any)?.settings?.timezone || (user as any)?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        cancelLabel={confirmDialog.cancelLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />

      {activeReminderBanner && (
        <ReminderBanner
          reminder={activeReminderBanner}
          onOpenItem={(itemId) => {
            setActiveReminderBanner(null);
            if (itemId) {
              const target = items.find((i) => i.id === itemId);
              if (target) {
                setEditingItem(target);
              }
            }
          }}
          onDismiss={() => setActiveReminderBanner(null)}
        />
      )}
    </div>
  );
}
