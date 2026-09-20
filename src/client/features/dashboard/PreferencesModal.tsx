import React, { useState, useEffect, useRef } from "react";
import { X, Bell, Globe, Moon, ShieldCheck, Check, Loader2 } from "lucide-react";

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PreferencesModal({ isOpen, onClose }: PreferencesModalProps) {
  const [autoReminders, setAutoReminders] = useState(false);
  const [channels, setChannels] = useState<string[]>(["web"]);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("08:00");
  const [permissionStatus, setPermissionStatus] = useState<string>(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    fetch("/api/v1/reminders/preferences")
      .then((res) => res.json())
      .then((data) => {
        if (data?.preferences) {
          setAutoReminders(data.preferences.autoReminders ?? false);
          setChannels(data.preferences.channels || ["web"]);
          setTimezone(data.preferences.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
          setQuietHoursEnabled(data.preferences.quietHoursEnabled ?? false);
          setQuietHoursStart(data.preferences.quietHoursStart || "22:00");
          setQuietHoursEnd(data.preferences.quietHoursEnd || "08:00");
        }
      })
      .catch(console.error);
  }, [isOpen]);

  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Escape key handler & focus restoration
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      setTimeout(() => {
        previousActiveElement.current?.focus();
      }, 50);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const requestWebPermission = async () => {
    if (typeof Notification !== "undefined") {
      const perm = await Notification.requestPermission();
      setPermissionStatus(perm);
      if (perm === "granted" && !channels.includes("web")) {
        setChannels([...channels, "web"]);
      }
    }
  };

  const toggleChannel = (ch: string) => {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);

    try {
      const res = await fetch("/api/v1/reminders/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoReminders,
          channels,
          timezone,
          quietHoursEnabled,
          quietHoursStart,
          quietHoursEnd,
        }),
      });

      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => {
          setSavedSuccess(false);
          onClose();
        }, 800);
      }
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{
        paddingTop: "max(1rem, var(--safe-top, 0px))",
        paddingBottom: "var(--safe-bottom, 0px)",
      }}
    >
      {/* Backdrop */}
      <div
        id="preferences-modal-backdrop"
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div
        id="preferences-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-modal-title"
        className="relative w-full flex flex-col bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] shadow-2xl max-w-md md:max-w-xl max-h-[90vh] rounded-t-3xl sm:rounded-3xl overflow-hidden z-10 animate-in slide-in-from-bottom-5 sm:zoom-in-95 duration-200"
      >
        {/* Header Section */}
        <div className="p-5 pb-4 sm:p-7 sm:pb-4 border-b border-[#F5F5F4] dark:border-[#332F2C] shrink-0">
          {/* Mobile handle indicator */}
          <div className="sm:hidden w-10 h-1 bg-stone-300 dark:bg-stone-700 rounded-full mx-auto mb-3.5" />
          <div className="flex items-center justify-between gap-3">
            <h3
              id="preferences-modal-title"
              className="font-serif font-normal tracking-tight text-[#1C1917] dark:text-[#FDFBF7] flex items-center gap-2.5 text-lg sm:text-xl"
            >
              <Bell className="w-5 h-5 text-amber-500 shrink-0" />
              Reminder Preferences
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="touch-target-48 min-w-[48px] min-h-[48px] -mr-2 p-2 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              title="Close"
              aria-label="Close preferences"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Scrollable Form Content */}
          <div className="overflow-y-auto overscroll-contain flex-1 p-5 sm:p-7 space-y-6">
          {/* Section A: Master Toggle Card (Switch Row) */}
          <div
            id="auto-reminders-row"
            role="switch"
            tabIndex={0}
            aria-checked={autoReminders}
            aria-label="Automatic Reminders"
            onClick={() => setAutoReminders(!autoReminders)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                setAutoReminders(!autoReminders);
              }
            }}
            className="touch-target-48 min-h-[48px] p-4 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 flex items-center justify-between gap-4 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 transition-colors hover:bg-stone-100/70 dark:hover:bg-stone-800/80"
          >
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-[#1C1917] dark:text-[#FDFBF7] block">
                Automatic Reminders
              </span>
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5 leading-relaxed">
                Automatically schedule 30d, 7d, 1d reminders when AI detects a deadline.
              </p>
            </div>
            {/* Visual switch: 48px width x 28px height */}
            <div
              aria-hidden="true"
              className={`w-12 h-7 rounded-full transition-colors flex items-center p-0.5 shrink-0 ${
                autoReminders ? "bg-[#1C1917] dark:bg-[#FDFBF7]" : "bg-stone-300 dark:bg-stone-700"
              }`}
            >
              <div
                className={`w-[22px] h-[22px] rounded-full bg-white dark:bg-[#1C1917] transition-transform duration-200 shadow-sm ${
                  autoReminders ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
          </div>

          {/* Section B: Delivery Channels */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-3">
              Delivery Channels
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                { id: "web", name: "In-App / Push", desc: "Native browser notification banners" },
                { id: "email", name: "Email Digest", desc: "Actionable morning summary" },
              ].map((ch) => (
                <div
                  key={ch.id}
                  onClick={() => toggleChannel(ch.id)}
                  className={`touch-target-48 min-h-[48px] p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                    channels.includes(ch.id)
                      ? "border-[#1C1917] dark:border-[#FDFBF7] bg-white dark:bg-[#292524] shadow-xs"
                      : "border-[#E7E5E4] dark:border-[#44403C] hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="text-xs font-medium text-[#1C1917] dark:text-[#FDFBF7] truncate">
                      {ch.name}
                    </div>
                    <div className="text-[11px] text-[#78716C] dark:text-[#A8A29E] truncate">
                      {ch.desc}
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                      channels.includes(ch.id)
                        ? "bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] border-transparent"
                        : "border-[#D6D3D1] dark:border-[#57534E]"
                    }`}
                  >
                    {channels.includes(ch.id) && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>
              ))}
            </div>

            {/* Browser Permission Prompt Helper */}
            {typeof Notification !== "undefined" && permissionStatus !== "granted" && (
              <div className="mt-2.5">
                <button
                  type="button"
                  id="grant-notification-permission-btn"
                  onClick={requestWebPermission}
                  className="touch-target-48 min-h-[48px] px-2 text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Grant browser notification permissions
                </button>
              </div>
            )}
          </div>

          {/* Section C: Timezone & Locale */}
          <div>
            <label htmlFor="preferences-timezone-input" className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-amber-500" /> Timezone & Locale
            </label>
            <input
              id="preferences-timezone-input"
              aria-label="Timezone & Locale"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3.5 py-2.5 min-h-[48px] rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-base text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <p className="text-[11px] text-stone-600 dark:text-[#A8A29E] mt-1 leading-normal">
              Ensures notifications arrive at the exact local hour across daylight-saving shifts.
            </p>
          </div>

          {/* Section D: Quiet Hours (Start & End Time Picker with Switch Row) */}
          <div className="pt-3 border-t border-[#F5F5F4] dark:border-[#332F2C]">
            <div
              id="quiet-hours-row"
              role="switch"
              tabIndex={0}
              aria-checked={quietHoursEnabled}
              aria-label="Quiet Hours"
              onClick={() => setQuietHoursEnabled(!quietHoursEnabled)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setQuietHoursEnabled(!quietHoursEnabled);
                }
              }}
              className="touch-target-48 min-h-[48px] py-2 px-1 flex items-center justify-between gap-4 cursor-pointer select-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            >
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-amber-500 shrink-0" />
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] block">
                    Quiet Hours
                  </span>
                  <span className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                    Pause notifications during sleeping hours
                  </span>
                </div>
              </div>
              {/* Visual switch: 48px wide x 28px high */}
              <div
                data-testid="quiet-hours-visual-switch"
                aria-hidden="true"
                className={`w-12 h-7 rounded-full transition-colors flex items-center p-0.5 shrink-0 ${
                  quietHoursEnabled ? "bg-amber-600 dark:bg-amber-500" : "bg-stone-300 dark:bg-stone-700"
                }`}
              >
                <div
                  className={`w-[22px] h-[22px] rounded-full bg-white dark:bg-[#1C1917] transition-transform duration-200 shadow-sm ${
                    quietHoursEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </div>
            </div>

            {quietHoursEnabled && (
              <div className="grid grid-cols-2 gap-3 mt-3 animate-in fade-in duration-200">
                <div>
                  <label className="block text-[11px] text-stone-600 dark:text-[#A8A29E] mb-1 font-medium">Start Time</label>
                  <input
                    type="time"
                    value={quietHoursStart}
                    onChange={(e) => setQuietHoursStart(e.target.value)}
                    className="w-full px-3 py-2.5 min-h-[48px] rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-base text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-stone-600 dark:text-[#A8A29E] mb-1 font-medium">End Time</label>
                  <input
                    type="time"
                    value={quietHoursEnd}
                    onChange={(e) => setQuietHoursEnd(e.target.value)}
                    className="w-full px-3 py-2.5 min-h-[48px] rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-base text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>
            )}
          </div>

          </div>

          {/* Section 4: Footer Actions */}
          <div className="border-t border-[#F5F5F4] dark:border-[#332F2C] flex items-center justify-end gap-3 p-4 sm:px-7 shrink-0 bg-stone-50/80 dark:bg-stone-900/80 backdrop-blur-sm">
            <button
              type="button"
              id="preferences-cancel-btn"
              onClick={onClose}
              className="touch-target-48 min-h-[48px] px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold text-stone-600 dark:text-stone-300 hover:text-[#1C1917] dark:hover:text-[#FDFBF7] bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="preferences-save-btn"
              disabled={saving}
              className="touch-target-48 min-h-[48px] px-6 py-2.5 rounded-full bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] text-xs sm:text-sm font-semibold shadow-xs hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 w-full sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Saved!</span>
                </>
              ) : (
                "Save Preferences"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
