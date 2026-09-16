import React, { useState, useEffect } from "react";
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
  LogOut
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
  const [activeEntity, setActiveEntity] = useState<TimelineItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TimelineItem | null>(null);

  // Data
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] pb-32 transition-colors">
      {/* Floating Toast notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] px-4 py-2.5 rounded-full text-xs font-medium shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <header className="px-6 pt-10 pb-4 max-w-4xl mx-auto flex flex-col gap-5 sticky top-0 bg-[#FDFBF7]/90 dark:bg-[#1C1917]/90 backdrop-blur-md z-20 border-b border-[#E7E5E4]/60 dark:border-[#2E2A27]/60">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif tracking-tight text-[#1C1917] dark:text-[#FDFBF7]">
              LifeLoop
            </h1>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="install-iphone-btn"
              onClick={() => setIsInstallOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1C1917] dark:bg-[#FDFBF7] text-[#FDFBF7] dark:text-[#1C1917] rounded-full text-xs font-medium hover:opacity-90 shadow-sm transition-all"
              title="Install LifeLoop on iPhone / Real Device"
            >
              <Smartphone className="w-3.5 h-3.5 text-amber-400 dark:text-amber-600" />
              <span>Install on iPhone</span>
            </button>

            <button
              id="reminder-preferences-btn"
              onClick={() => setIsPreferencesOpen(true)}
              className="p-2 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              title="Reminder Preferences"
            >
              <Settings className="w-5 h-5" />
            </button>

            {/* Profile badge & Log Out */}
            {user && (
              <div className="flex items-center gap-1.5 pl-2 border-l border-stone-300 dark:border-stone-700">
                <div 
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-medium border border-stone-200 dark:border-stone-700 max-w-[170px]"
                  title={`Logged in as ${user.email}`}
                >
                  <div className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                    {user.email ? user.email[0] : "U"}
                  </div>
                  <span className="truncate">{user.email}</span>
                </div>

                <button
                  id="logout-btn"
                  onClick={logout}
                  className="p-1.5 text-[#78716C] hover:text-red-600 dark:hover:text-red-400 rounded-full hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  title="Log Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Search Bar & View Navigation */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Tabs */}
          <div 
            className="flex items-center bg-stone-200/70 dark:bg-stone-800/70 p-1 rounded-xl text-xs font-medium text-stone-600 dark:text-stone-300 overflow-x-auto w-full sm:w-auto"
            style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
          >
            <style>{`.hide-scroll::-webkit-scrollbar { display: none; }`}</style>
            <div className="flex items-center gap-1 hide-scroll min-w-max">
              <button
                id="tab-priority"
                onClick={() => setActiveTab("priority")}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === "priority"
                    ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm font-semibold"
                    : "hover:text-[#1C1917] dark:hover:text-white"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Home
              </button>
              <button
                id="tab-timeline"
                onClick={() => setActiveTab("timeline")}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === "timeline"
                    ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm font-semibold"
                    : "hover:text-[#1C1917] dark:hover:text-white"
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-blue-500" />
                Timeline
              </button>
              <button
                id="tab-captures"
                onClick={() => setActiveTab("captures")}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === "captures"
                    ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm font-semibold"
                    : "hover:text-[#1C1917] dark:hover:text-white"
                }`}
              >
                <Inbox className="w-3.5 h-3.5 text-emerald-500" />
                Inbox
                {captures.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-stone-300 dark:bg-stone-700">
                    {captures.length}
                  </span>
                )}
              </button>
              <button
                id="tab-ask"
                onClick={() => { setActiveTab("ask"); setActiveEntity(null); }}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === "ask"
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm font-semibold"
                    : "hover:text-indigo-600 dark:hover:text-indigo-400"
                }`}
              >
                <Bot className={`w-3.5 h-3.5 ${activeTab === 'ask' ? 'text-white' : 'text-indigo-500'}`} />
                Ask AI
              </button>
              <button
                id="tab-graph"
                onClick={() => { setActiveTab("graph"); setActiveEntity(null); }}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === "graph"
                    ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm font-semibold"
                    : "hover:text-[#1C1917] dark:hover:text-white"
                }`}
              >
                <Network className="w-3.5 h-3.5 text-purple-500" />
                Entities
              </button>
              <button
                id="tab-family"
                onClick={() => { setActiveTab("family"); setActiveEntity(null); }}
                className={`relative px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === "family"
                    ? "bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] shadow-sm font-semibold"
                    : "hover:text-[#1C1917] dark:hover:text-white"
                }`}
              >
                <Users className="w-3.5 h-3.5 text-emerald-500" />
                Family
                {familyUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {familyUnreadCount > 9 ? "9+" : familyUnreadCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="search-input"
              type="text"
              placeholder="Search bills, renewals, tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl text-xs bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-[#1C1917] dark:focus:ring-white transition-all"
            />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="px-6 max-w-4xl mx-auto mt-6 space-y-8">
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
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40">
        <button
          id="global-capture-btn"
          onClick={() => setIsCaptureOpen(true)}
          className="flex items-center gap-2 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] px-7 py-4 rounded-full shadow-2xl hover:scale-105 active:scale-95 transition-all duration-150 border border-black/10 dark:border-white/10"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
          <span className="font-medium tracking-wide text-sm">Capture</span>
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
