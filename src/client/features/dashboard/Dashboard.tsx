import React, { useState, useEffect, useRef } from "react";
import { 
  Plus, 
  Settings, 
  Search, 
  Loader2, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  AlertTriangle,
  Calendar,
  Hourglass,
  Layers,
  Inbox,
  Sparkles,
  Bell,
  CheckCircle,
  FileText,
  Smartphone,
  Bot,
  Network,
  Users,
  LogOut,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { CaptureDialog } from "./CaptureDialog";
import { ItemCard } from "./ItemCard";
import { ItemEditModal } from "./ItemEditModal";
import { PreferencesModal } from "./PreferencesModal";
import { InstallModal } from "./InstallModal";
import { AskView } from "./AskView";
import { LifeGraphView } from "./LifeGraphView";
import { EntityDetailView } from "./EntityDetailView";
import { groupItemsIntoTimeline, TimelineItem, TimelineGrouping } from "../../../shared/utils/timeline";
import { FamilyPage } from "../family/FamilyPage";

interface Capture {
  id: string;
  type: string;
  rawPayload: string;
  originalFilename: string | null;
  processingStatus: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
}

export function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<"priority" | "timeline" | "captures" | "ask" | "graph" | "family">("priority");
  const [familyUnreadCount, setFamilyUnreadCount] = useState(0);
  const [isFamilyBannerDismissed, setIsFamilyBannerDismissed] = useState(false);
  const [activeEntity, setActiveEntity] = useState<TimelineItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Modals & Menus
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TimelineItem | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    if (isProfileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isProfileMenuOpen]);

  // Data
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Tab bar scroll affordance indicators
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const tabBarRef = useRef<HTMLDivElement>(null);

  const checkTabBarScroll = () => {
    if (tabBarRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabBarRef.current;
      setCanScrollLeft(scrollLeft > 6);
      setCanScrollRight(scrollWidth > clientWidth && scrollLeft < scrollWidth - clientWidth - 6);
    }
  };

  useEffect(() => {
    checkTabBarScroll();
    // Re-check after layout paint and font render
    const t1 = setTimeout(checkTabBarScroll, 50);
    const t2 = setTimeout(checkTabBarScroll, 200);
    const t3 = setTimeout(checkTabBarScroll, 600);
    window.addEventListener("resize", checkTabBarScroll);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener("resize", checkTabBarScroll);
    };
  }, [captures.length, items.length]);

  // Ensure active tab is smoothly visible into view
  useEffect(() => {
    if (tabBarRef.current) {
      const activeEl = tabBarRef.current.querySelector<HTMLElement>(`#tab-${activeTab}`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
      }
      setTimeout(checkTabBarScroll, 350);
    }
  }, [activeTab]);


  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const fetchData = async () => {
    try {
      const [capRes, itemRes] = await Promise.all([
        fetch("/api/v1/captures"),
        fetch("/api/v1/items"),
      ]);

      if (capRes.ok) {
        const data = await capRes.json();
        setCaptures(data.captures || []);
      }
      if (itemRes.ok) {
        const data = await itemRes.json();
        const rawItems = (data.items || []).map((i: any) => ({
          ...i,
          dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : null,
          snoozedUntil: i.snoozedUntil ? new Date(i.snoozedUntil).toISOString() : null,
          completedAt: i.completedAt ? new Date(i.completedAt).toISOString() : null,
          createdAt: new Date(i.createdAt).toISOString(),
        }));
        setItems(rawItems);
      }
    } catch (e) {
      console.error("Failed to load dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  // Filter items by search query
  const filteredItems = searchQuery
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          i.itemType.toLowerCase().includes(searchQuery.toLowerCase()) ||
          JSON.stringify(i.metadata || {}).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items;

  // Intelligently compute Life Timeline grouping
  const timeline: TimelineGrouping = groupItemsIntoTimeline(filteredItems, new Date());

  // Capture submission handler
  const handleCaptureSubmit = async (data: { type: string; payload: string | File }) => {
    const formData = new FormData();
    formData.append("type", data.type);
    formData.append("source", "web");

    if (typeof data.payload === "string") {
      formData.append("rawPayload", data.payload);
    } else {
      formData.append("file", data.payload);
    }

    const res = await fetch("/api/v1/captures", { method: "POST", body: formData });
    if (res.ok) {
      showToast("Captured! LifeLoop AI is organizing it in the background.");
      fetchData();
    }
  };

  // Toggle complete
  const handleToggleComplete = async (id: string, completed: boolean) => {
    // Optimistic UI update
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: completed ? "completed" : "active" } : i))
    );

    try {
      await fetch(`/api/v1/items/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
    try {
      await fetch(`/api/v1/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      showToast("Confirmed into LifeLoop!");
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Delete item
  const handleDeleteItem = async (id: string) => {
    if (!confirm("Delete this life item?")) return;
    try {
      await fetch(`/api/v1/items/${id}`, { method: "DELETE" });
      showToast("Item deleted");
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Save Item Edit & Reminders
  const handleSaveItemEdit = async (
    updated: Partial<TimelineItem> & {
      reminderOffsets?: number[];
      recurrence?: string;
      channel?: string;
    }
  ) => {
    if (!updated.id) return;

    // 1. Update item
    await fetch(`/api/v1/items/${updated.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: updated.title,
        itemType: updated.itemType,
        dueDate: updated.dueDate,
        status: updated.status,
        metadata: updated.metadata,
      }),
    });

    // 2. If reminders offsets requested and dueDate present, create them
    if (updated.dueDate && updated.reminderOffsets && updated.reminderOffsets.length > 0) {
      await fetch("/api/v1/reminders/standard-relative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: updated.id,
          offsets: updated.reminderOffsets,
          channel: updated.channel || "web",
        }),
      });
    }

    showToast("Changes saved");
    fetchData();
  };

  // Delete raw capture
  const handleDeleteCapture = async (id: string) => {
    if (!confirm("Delete this capture?")) return;
    await fetch(`/api/v1/captures/${id}`, { method: "DELETE" });
    fetchData();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
      case "processing":
        return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
      case "completed":
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
      case "failed":
        return <XCircle className="w-3.5 h-3.5 text-rose-500" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-stone-400" />;
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] pb-32 transition-colors w-full max-w-full overflow-x-clip min-w-0">
      {/* Floating Toast notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] px-4 py-2.5 rounded-full text-xs font-medium shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <header className="w-full sticky top-0 z-20 backdrop-blur-md bg-[#FDFBF7]/95 dark:bg-[#1C1917]/95 border-b border-[#E7E5E4]/60 dark:border-[#2E2A27]/60">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-3.5 sm:pt-6 pb-3 sm:pb-4 flex flex-col gap-2.5 sm:gap-3.5">
          {/* Row 1: Brand & User Profile Cluster */}
          <div className="w-full flex items-center justify-between gap-2 min-w-0">
            <div className="shrink min-w-0">
              <h1 className="text-xl sm:text-2xl font-normal font-serif tracking-tight text-[#1C1917] dark:text-[#FDFBF7]">
                LifeLoop
              </h1>
              <p className="text-[11px] sm:text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">
                {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </p>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 justify-end min-w-0">
              {/* Settings button adjusted just before the profile button */}
              <button
                id="reminder-preferences-btn"
                onClick={() => setIsPreferencesOpen(true)}
                className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0 text-[#78716C] dark:text-[#A8A29E] flex items-center justify-center min-w-[36px] min-h-[36px]"
                title="Reminder Preferences"
                aria-label="Reminder Preferences"
              >
                <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {/* Profile badge with dropdown popover showing Preferences and Logout */}
              {user && (
                <div className="relative shrink min-w-0" ref={profileMenuRef}>
                  <button
                    id="user-profile-menu-btn"
                    onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                    className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 hover:bg-stone-200/80 dark:hover:bg-stone-700/80 border border-stone-200 dark:border-stone-700 text-xs font-medium max-w-[95px] sm:max-w-[160px] min-w-0 cursor-pointer transition-colors"
                    title={`Account menu (${user.email})`}
                    aria-expanded={isProfileMenuOpen}
                    aria-haspopup="true"
                  >
                    <div className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                      {user.email ? user.email[0] : "U"}
                    </div>
                    <span className="truncate min-w-0 flex-1 text-[11px] sm:text-xs text-stone-700 dark:text-stone-300">
                      {user.email}
                    </span>
                    <ChevronDown className={`w-3 h-3 text-stone-400 shrink-0 transition-transform duration-200 ${isProfileMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Popover Dropdown */}
                  {isProfileMenuOpen && (
                    <div
                      id="profile-popover"
                      className="absolute right-0 top-full mt-2 w-52 sm:w-56 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-2xl shadow-xl py-1.5 z-50 animate-in fade-in slide-in-from-top-2"
                    >
                      <div className="px-3.5 py-2.5 border-b border-[#F5F5F4] dark:border-[#383330]">
                        <p className="text-[10px] font-semibold text-[#A8A29E] uppercase tracking-wider">Signed in as</p>
                        <p className="text-xs font-medium text-[#1C1917] dark:text-[#FDFBF7] truncate mt-0.5">{user.email}</p>
                      </div>
                      <div className="p-1.5 space-y-0.5">
                        <button
                          id="profile-preferences-btn"
                          onClick={() => {
                            setIsProfileMenuOpen(false);
                            setIsPreferencesOpen(true);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#1C1917] dark:text-[#FDFBF7] hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors text-left"
                          title="Reminder Preferences"
                          aria-label="Reminder Preferences"
                        >
                          <Settings className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="font-medium">Preferences</span>
                        </button>
                        <button
                          id="logout-btn"
                          onClick={() => {
                            setIsProfileMenuOpen(false);
                            logout();
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#78716C] hover:text-red-600 dark:hover:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors text-left"
                          title="Log Out"
                          aria-label="Log Out"
                        >
                          <LogOut className="w-4 h-4 text-red-500 shrink-0" />
                          <span className="font-medium">Log out</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Segmented Filter Tabs (adjusts width according to screen width with touch scroll affordances) */}
          <div className="relative w-full">
            {/* Left Scroll Button */}
            {canScrollLeft && (
              <button
                type="button"
                onClick={() => {
                  tabBarRef.current?.scrollBy({ left: -140, behavior: "smooth" });
                }}
                className="absolute -left-1.5 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-white dark:bg-[#292524] shadow-md border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-700 dark:text-stone-200 hover:scale-110 active:scale-95 transition-transform"
                title="Scroll tabs left"
                aria-label="Scroll tabs left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            <div 
              ref={tabBarRef}
              onScroll={checkTabBarScroll}
              className="w-full overflow-x-auto no-scrollbar bg-stone-200/70 dark:bg-stone-800/70 p-1 rounded-xl text-xs font-medium scroll-smooth"
            >
              <div className="flex items-center gap-1 min-w-max sm:min-w-0 sm:w-full pr-8 sm:pr-0">
                <button
                  id="tab-priority"
                  onClick={() => setActiveTab("priority")}
                  className={`px-2.5 sm:px-3 py-1.5 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap sm:flex-1 ${
                    activeTab === "priority"
                      ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm rounded-lg font-semibold"
                      : "text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white rounded-lg"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  Priority
                </button>
                <button
                  id="tab-timeline"
                  onClick={() => setActiveTab("timeline")}
                  className={`px-2.5 sm:px-3 py-1.5 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap sm:flex-1 ${
                    activeTab === "timeline"
                      ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm rounded-lg font-semibold"
                      : "text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white rounded-lg"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  Timeline
                </button>
                <button
                  id="tab-captures"
                  onClick={() => setActiveTab("captures")}
                  className={`px-2.5 sm:px-3 py-1.5 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap sm:flex-1 ${
                    activeTab === "captures"
                      ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm rounded-lg font-semibold"
                      : "text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white rounded-lg"
                  }`}
                >
                  <Inbox className="w-3.5 h-3.5 text-emerald-500" />
                  Inbox
                  {captures.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-stone-300 dark:bg-stone-700 font-bold">
                      {captures.length}
                    </span>
                  )}
                </button>
                <button
                  id="tab-ask"
                  onClick={() => { setActiveTab("ask"); setActiveEntity(null); }}
                  className={`px-2.5 sm:px-3 py-1.5 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap sm:flex-1 ${
                    activeTab === "ask"
                      ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm rounded-lg font-semibold"
                      : "text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white rounded-lg"
                  }`}
                >
                  <Bot className="w-3.5 h-3.5 text-indigo-500" />
                  Ask
                </button>
                <button
                  id="tab-graph"
                  onClick={() => { setActiveTab("graph"); setActiveEntity(null); }}
                  className={`px-2.5 sm:px-3 py-1.5 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap sm:flex-1 ${
                    activeTab === "graph"
                      ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm rounded-lg font-semibold"
                      : "text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white rounded-lg"
                  }`}
                >
                  <Network className="w-3.5 h-3.5 text-purple-500" />
                  Graph
                </button>
                <button
                  id="tab-family"
                  onClick={() => { setActiveTab("family"); setActiveEntity(null); }}
                  className={`relative px-2.5 sm:px-3 py-1.5 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap sm:flex-1 ${
                    activeTab === "family"
                      ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm rounded-lg font-semibold"
                      : "text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white rounded-lg"
                  }`}
                >
                  <Users className="w-3.5 h-3.5 text-emerald-500" />
                  Family
                  {familyUnreadCount > 0 && (
                    <span className="ml-1 px-1.5 py-0.2 bg-red-500 text-white text-[9px] font-bold rounded-full">
                      {familyUnreadCount > 9 ? "9+" : familyUnreadCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Right Scroll Button */}
            {canScrollRight && (
              <button
                type="button"
                onClick={() => {
                  tabBarRef.current?.scrollBy({ left: 140, behavior: "smooth" });
                }}
                className="absolute -right-1.5 top-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full bg-white dark:bg-[#292524] shadow-md border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-700 dark:text-stone-200 hover:scale-110 active:scale-95 transition-transform"
                title="Scroll tabs right"
                aria-label="Scroll tabs right"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Row 3: Search Bar located directly under the tab bar */}
          <div className="relative w-full">
            <Search className="w-4 h-4 text-[#A8A29E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="search-input"
              type="text"
              placeholder="Search bills, renewals, tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl text-xs placeholder:text-[#A8A29E] text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-amber-500 transition-all shadow-xs"
            />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="px-4 sm:px-6 max-w-4xl mx-auto mt-6 space-y-6 sm:space-y-8">
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
          <div className="space-y-8">
            {/* Family Sharing Banner (Conditional) */}
            {!isFamilyBannerDismissed && (familyUnreadCount > 0 || items.some(i => i.isFamilyShared || (i.metadata as any)?.isFamilyShared)) && (
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
                    onClick={() => { setActiveTab("family"); setActiveEntity(null); }}
                    className="text-amber-800 dark:text-amber-300 font-semibold hover:underline"
                  >
                    View
                  </button>
                  <button
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
                      const isOverdue = item.badgeVariant === "urgent" || (item.dueDate && new Date(item.dueDate).getTime() < Date.now());
                      const isToday = !isOverdue && item.dueDate && new Date(item.dueDate).toDateString() === new Date().toDateString();
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
                                isOverdue
                                  ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60"
                                  : isToday
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60"
                                  : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60"
                              }`}>
                                {isOverdue ? "Overdue" : isToday ? "Today" : "Upcoming"}
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
                              onClick={() => handleToggleComplete(item.id, true)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-800"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Done
                            </button>
                            <button
                              onClick={() => handleSnooze(item.id, 1)}
                              className="inline-flex items-center gap-1 text-[11px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-white"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              +1d
                            </button>
                            <button
                              onClick={() => setEditingItem(item)}
                              className="text-[11px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-white"
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

            {/* 1. NEEDS ATTENTION (Urgent, Overdue, AI Review) */}
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
                    Today ({timeline.today.length})
                  </h2>
                </div>
              </div>

              {timeline.today.length === 0 ? (
                <div className="py-5 px-4 bg-white/50 dark:bg-[#23201E]/50 rounded-2xl border border-[#E7E5E4] dark:border-[#383330] text-xs text-[#78716C] dark:text-[#A8A29E]">
                  Nothing due today. You are completely on track!
                </div>
              ) : (
                <div className="space-y-2.5">
                  {timeline.today.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
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
                  Upcoming ({timeline.tomorrow.length + timeline.thisWeek.length + timeline.upcoming.length})
                </h2>
              </div>

              {timeline.tomorrow.length === 0 &&
              timeline.thisWeek.length === 0 &&
              timeline.upcoming.length === 0 ? (
                <div className="py-5 px-4 bg-white/50 dark:bg-[#23201E]/50 rounded-2xl border border-[#E7E5E4] dark:border-[#383330] text-xs text-[#78716C] dark:text-[#A8A29E]">
                  No upcoming deadlines detected yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {[...timeline.tomorrow, ...timeline.thisWeek, ...timeline.upcoming].map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onToggleComplete={handleToggleComplete}
                      onSnooze={handleSnooze}
                      onEdit={setEditingItem}
                      onDelete={handleDeleteItem}
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
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 2: CHRONOLOGICAL LIFE TIMELINE                  */}
        {/* Sections: Today, Tomorrow, This Week, Upcoming, Past */}
        {/* ---------------------------------------------------- */}
        {!loading && activeTab === "timeline" && (
          <div className="space-y-8">
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
                    />
                  ))}
                </div>
              )}
            </div>

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
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 3: RAW CAPTURES INBOX                           */}
        {/* Original unparsed sources & media files             */}
        {/* ---------------------------------------------------- */}
        {!loading && activeTab === "captures" && (
          <div className="space-y-4">
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
                        {getStatusIcon(capture.processingStatus)}
                        <span className="text-[11px] text-[#A8A29E]">
                          {capture.processingStatus}
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
                      <button
                        onClick={() => handleDeleteCapture(capture.id)}
                        className="text-xs text-stone-400 hover:text-red-500 transition-colors p-1"
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
        {!loading && activeTab === "ask" && (
           <AskView 
             onEditItem={setEditingItem}
             onToggleComplete={handleToggleComplete}
             onSnooze={handleSnooze}
             onDelete={handleDeleteItem}
           />
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 5: LIFE GRAPH (Entities)                        */}
        {/* ---------------------------------------------------- */}
        {!loading && activeTab === "graph" && (
           activeEntity ? (
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
           )
        )}

        {/* ---------------------------------------------------- */}
        {/* VIEW 6: FAMILY                                        */}
        {/* ---------------------------------------------------- */}
        {activeTab === "family" && (
          <FamilyPage />
        )}
      </main>

      {/* 5. CAPTURE BUTTON (Floating Action Button) */}
      <div className="fixed bottom-6 right-6 z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <button
          id="global-capture-btn"
          onClick={() => setIsCaptureOpen(true)}
          className="flex items-center gap-2 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] p-3.5 sm:px-5 sm:py-3.5 rounded-full shadow-2xl hover:scale-105 active:scale-95 transition-all duration-150 border border-black/10 dark:border-white/10 text-xs font-semibold"
          title="Quick Capture"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
          <span className="hidden sm:inline font-semibold">Capture</span>
        </button>
      </div>

      {/* 6. MODALS */}
      <CaptureDialog
        isOpen={isCaptureOpen}
        onClose={() => setIsCaptureOpen(false)}
        onSubmit={handleCaptureSubmit}
      />

      <PreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
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
        />
      )}
    </div>
  );
}
