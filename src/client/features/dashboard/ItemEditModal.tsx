import React, { useState, useEffect } from "react";
import { X, Calendar, Bell, DollarSign, Clock, Tag } from "lucide-react";
import { TimelineItem } from "../../../shared/utils/timeline";

interface ItemEditModalProps {
  item: TimelineItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: Partial<TimelineItem> & { reminderOffsets?: number[]; recurrence?: string; channel?: string }) => Promise<void>;
  userTimezone?: string;
}

export function formatDateForDateInput(d: Date | string | null | undefined, timezone?: string): string {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "";
  if (timezone) {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const parts = formatter.formatToParts(date);
      const year = parts.find((p) => p.type === "year")?.value;
      const month = parts.find((p) => p.type === "month")?.value;
      const day = parts.find((p) => p.type === "day")?.value;
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fallback to local getters if timezone string is invalid
    }
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ItemEditModal({ item, isOpen, onClose, onSave, userTimezone }: ItemEditModalProps) {
  if (!isOpen || !item) return null;

  const [title, setTitle] = useState(item.title);
  const [itemType, setItemType] = useState(item.itemType || "task");
  
  // Format initial dueDate to YYYY-MM-DD in user's profile timezone
  const rawDate = item.dueDate || (item.metadata as any)?.dueDate || (item.metadata as any)?.expiryDate;
  const initialDateStr = formatDateForDateInput(rawDate, userTimezone);
  const [dueDate, setDueDate] = useState(initialDateStr);
  const [isDueDateModified, setIsDueDateModified] = useState(false);
  
  const [amount, setAmount] = useState(item.metadata?.amount?.toString() || "");
  const [currency, setCurrency] = useState(item.metadata?.currency || "INR");
  const [waitingFor, setWaitingFor] = useState(item.metadata?.waitingFor || "");
  const [recurrence, setRecurrence] = useState("none");
  const [channel, setChannel] = useState("web");
  
  // Relative reminder offset checkboxes
  const [selectedOffsets, setSelectedOffsets] = useState<number[]>([-7, -1, 0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(item.title);
    setItemType(item.itemType || "task");
    const d = item.dueDate || (item.metadata as any)?.dueDate || (item.metadata as any)?.expiryDate;
    setDueDate(formatDateForDateInput(d, userTimezone));
    setIsDueDateModified(false);
    setAmount(item.metadata?.amount?.toString() || "");
    setCurrency(item.metadata?.currency || "INR");
    setWaitingFor(item.metadata?.waitingFor || "");
  }, [item, userTimezone]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const toggleOffset = (offset: number) => {
    setSelectedOffsets((prev) =>
      prev.includes(offset) ? prev.filter((o) => o !== offset) : [...prev, offset]
    );
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updatedMetadata = {
        ...(item.metadata || {}),
        ...(amount ? { amount: parseFloat(amount) } : {}),
        currency,
        ...(waitingFor ? { waitingFor } : {}),
        ...(isDueDateModified ? (dueDate ? { dueDate } : { dueDate: null }) : {}),
      };

      const payload: Partial<TimelineItem> & { reminderOffsets?: number[]; recurrence?: string; channel?: string } = {
        id: item.id,
        title,
        itemType,
        status: item.status === "pending_review" ? "active" : item.status,
        metadata: updatedMetadata,
        reminderOffsets: selectedOffsets,
        recurrence,
        channel,
      };

      if (isDueDateModified) {
        payload.dueDate = dueDate || null;
      }

      await onSave(payload);
      onClose();
    } catch (err) {
      console.error("Failed to save item edit:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id="item-edit-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        id="item-edit-modal-card"
        className="bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] w-full max-w-lg rounded-3xl shadow-2xl p-6 sm:p-7 overflow-y-auto max-h-[90vh]"
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#F5F5F4] dark:border-[#332F2C]">
          <h3 className="text-lg font-serif tracking-tight text-[#1C1917] dark:text-[#FDFBF7]">
            Edit Life Item
          </h3>
          <button
            id="item-edit-close-btn"
            aria-label="Close edit item"
            onClick={onClose}
            className="p-1.5 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="mt-5 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5">
              Title
            </label>
            <input
              id="edit-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-2 focus:ring-[#1C1917] dark:focus:ring-white transition-all text-sm"
            />
          </div>

          {/* Type & Due Date grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5">
                Category
              </label>
              <select
                id="edit-type-select"
                value={itemType}
                onChange={(e) => setItemType(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] text-sm focus:outline-none focus:ring-2 focus:ring-[#1C1917] dark:focus:ring-white"
              >
                <option value="payment">Payment / Bill</option>
                <option value="renewal">Renewal / Expiry</option>
                <option value="subscription">Subscription</option>
                <option value="appointment">Appointment</option>
                <option value="warranty">Warranty</option>
                <option value="waiting_for">Waiting For</option>
                <option value="task">Task / To-do</option>
                <option value="deadline">Deadline</option>
                <option value="purchase">Purchase</option>
                <option value="document">Document</option>
                <option value="reminder">Reminder</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5">
                Due Date / Deadline
              </label>
              <input
                id="edit-duedate-input"
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  setIsDueDateModified(true);
                }}
                className="w-full px-3 py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] text-sm focus:outline-none focus:ring-2 focus:ring-[#1C1917] dark:focus:ring-white"
              />
            </div>
          </div>

          {/* Conditional: Payment / Subscription Amount */}
          {(itemType === "payment" || itemType === "subscription" || itemType === "purchase") && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5">
                  Amount
                </label>
                <input
                  id="edit-amount-input"
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 2840"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] text-sm focus:outline-none focus:ring-2 focus:ring-[#1C1917] dark:focus:ring-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5">
                  Currency
                </label>
                <select
                  id="edit-currency-select"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] text-sm focus:outline-none focus:ring-2 focus:ring-[#1C1917] dark:focus:ring-white"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
            </div>
          )}

          {/* Conditional: Waiting for candidate */}
          {itemType === "waiting_for" && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5">
                Waiting on (Person / Entity)
              </label>
              <input
                id="edit-waitingfor-input"
                type="text"
                value={waitingFor}
                onChange={(e) => setWaitingFor(e.target.value)}
                placeholder="e.g. Architect, Landlord, Client"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-[#1C1917] dark:text-[#FDFBF7] text-sm focus:outline-none focus:ring-2 focus:ring-[#1C1917] dark:focus:ring-white"
              />
            </div>
          )}

          {/* Reminder Configuration Section */}
          {dueDate && (
            <div className="pt-2 border-t border-[#F5F5F4] dark:border-[#332F2C]">
              <div className="flex items-center gap-2 mb-3 text-[#1C1917] dark:text-[#FDFBF7]">
                <Bell className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-wider">
                  Remind Me Before Deadline
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "30 days before", offset: -30 },
                  { label: "7 days before", offset: -7 },
                  { label: "1 day before", offset: -1 },
                  { label: "On the day", offset: 0 },
                ].map(({ label, offset }) => (
                  <button
                    key={offset}
                    type="button"
                    onClick={() => toggleOffset(offset)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border text-center transition-all ${
                      selectedOffsets.includes(offset)
                        ? "bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] border-[#1C1917] dark:border-[#FDFBF7]"
                        : "bg-stone-50 dark:bg-stone-800/60 border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Recurrence & Channel */}
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#78716C] dark:text-[#A8A29E] mb-1">
                    Recurrence
                  </label>
                  <select
                    id="edit-recurrence-select"
                    value={recurrence}
                    onChange={(e) => setRecurrence(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-xs text-[#1C1917] dark:text-[#FDFBF7]"
                  >
                    <option value="none">One-time (No recurrence)</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#78716C] dark:text-[#A8A29E] mb-1">
                    Channel
                  </label>
                  <select
                    id="edit-channel-select"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-xs text-[#1C1917] dark:text-[#FDFBF7]"
                  >
                    <option value="web">Web Notification</option>
                    <option value="ios">iOS Notification (APNs)</option>
                    <option value="android">Android Notification (FCM)</option>
                    <option value="email">Email Notification</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#F5F5F4] dark:border-[#332F2C]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-[#78716C] hover:text-[#1C1917] dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              id="save-item-btn"
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-full bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] text-sm font-medium shadow hover:opacity-90 transition-opacity"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
