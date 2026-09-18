import React, { useState, useEffect } from "react";
import { X, Bell, Globe, Moon, ShieldCheck, Check, Loader2 } from "lucide-react";
import { useDeviceSimulator } from "../simulator/DeviceSimulator";

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PreferencesModal({ isOpen, onClose }: PreferencesModalProps) {
  if (!isOpen) return null;

  const { mode, isMobileMode } = useDeviceSimulator();
  const [isWindowMobile, setIsWindowMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsWindowMobile(window.innerWidth < 640);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Truly mobile if either simulated as mobile, or full-window with width < 640px
  const isMobile = isMobileMode || (mode === "full" && isWindowMobile);

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
  }, []);

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
    try {
      await fetch("/api/v1/reminders/preferences", {
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
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 700);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      id="preferences-modal-backdrop"
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-center animate-in fade-in duration-200 ${
        isMobile ? "items-end p-0" : "items-center p-4 sm:p-6"
      }`}
    >
      <div
        id="preferences-modal-card"
        className={`w-full overflow-y-auto overscroll-contain no-scrollbar bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] shadow-2xl pb-0 ${
          isMobile
            ? "max-w-lg max-h-[92vh] rounded-t-3xl p-5"
            : "max-w-md md:max-w-xl max-h-[85vh] rounded-3xl p-7"
        }`}
      >
        {/* Mobile bottom sheet drag handle */}
        {isMobile && (
          <div className="w-10 h-1 bg-stone-300 dark:bg-stone-700 rounded-full mx-auto mb-3.5" />
        )}

        {/* Header Section */}
        <div className="flex items-center justify-between pb-4 border-b border-[#F5F5F4] dark:border-[#332F2C] gap-3">
          <h3 className={`font-serif font-normal tracking-tight text-[#1C1917] dark:text-[#FDFBF7] flex items-center gap-2.5 ${
            isMobile ? "text-lg" : "text-xl"
          }`}>
            <Bell className="w-5 h-5 text-amber-500 shrink-0" />
            Reminder Preferences
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
            title="Close"
            aria-label="Close preferences"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-6">
          {/* Section A: Master Toggle Card */}
          <div className="p-4 sm:p-4.5 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium text-[#1C1917] dark:text-[#FDFBF7] block">
                  Automatic Reminders
                </label>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5 leading-relaxed">
                  Automatically schedule 30d, 7d, 1d reminders when AI detects a deadline.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoReminders}
                onClick={() => setAutoReminders(!autoReminders)}
                className={`w-11 h-6 rounded-full transition-colors flex items-center p-0.5 shrink-0 ${
                  autoReminders ? "bg-[#1C1917] dark:bg-[#FDFBF7]" : "bg-stone-300 dark:bg-stone-700"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white dark:bg-[#1C1917] transition-transform shadow-sm ${
                    autoReminders ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Section B: Channel Selector (Web, Email, iOS APNs, Android FCM) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-2.5">
              Notification Channels
            </label>
            <div className={`grid gap-2.5 ${isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
              {[
                { id: "web", name: "Web Notifications", desc: "Browser alert & in-app banner" },
                { id: "email", name: "Email Notifications", desc: "Future-ready email digest" },
                { id: "ios", name: "iOS (APNs)", desc: "Apple Push Notifications" },
                { id: "android", name: "Android (FCM)", desc: "Google Firebase Messaging" },
              ].map((ch) => (
                <div
                  key={ch.id}
                  onClick={() => toggleChannel(ch.id)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer select-none transition-all active:scale-[0.99] ${
                    channels.includes(ch.id)
                      ? "border-[#1C1917] dark:border-[#FDFBF7] bg-stone-50 dark:bg-stone-800/70"
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
                  onClick={requestWebPermission}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Grant browser notification permissions
                </button>
              </div>
            )}
          </div>

          {/* Section C: Timezone & Locale */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-amber-500" /> Timezone & Locale
            </label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2.5 sm:py-2 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-xs text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <p className="text-[11px] text-[#78716C] mt-1 leading-normal">
              Ensures notifications arrive at the exact local hour across daylight-saving shifts.
            </p>
          </div>

          {/* Section D: Quiet Hours (Start & End Time Picker) */}
          <div className="pt-3 border-t border-[#F5F5F4] dark:border-[#332F2C]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] flex items-center gap-1.5">
                <Moon className="w-3.5 h-3.5 text-amber-500" /> Quiet Hours
              </span>
              <button
                type="button"
                onClick={() => setQuietHoursEnabled(!quietHoursEnabled)}
                className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                  quietHoursEnabled
                    ? "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                    : "text-[#78716C] border-stone-200 dark:border-stone-700 hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {quietHoursEnabled ? "Enabled" : "Disabled"}
              </button>
            </div>

            {quietHoursEnabled && (
              <div className="grid grid-cols-2 gap-3 mt-2 animate-in fade-in duration-200">
                <div>
                  <label className="block text-[11px] text-[#78716C] mb-1 font-medium">Start Time</label>
                  <input
                    type="time"
                    value={quietHoursStart}
                    onChange={(e) => setQuietHoursStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-xs text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#78716C] mb-1 font-medium">End Time</label>
                  <input
                    type="time"
                    value={quietHoursEnd}
                    onChange={(e) => setQuietHoursEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-xs text-[#1C1917] dark:text-[#FDFBF7] focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 4: Footer Actions (Sticky on Mobile, Clean on Tablet) */}
          <div className={`sticky bottom-0 z-20 bg-white/95 dark:bg-[#23201E]/95 backdrop-blur-md border-t border-[#F5F5F4] dark:border-[#332F2C] flex items-center justify-end gap-3 mt-6 ${
            isMobile ? "-mx-5 p-4 rounded-b-none" : "-mx-7 p-5 rounded-b-3xl"
          }`}>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs text-[#78716C] hover:text-[#1C1917] dark:hover:text-white font-medium transition-colors shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`px-6 py-2.5 rounded-full bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] text-xs font-medium shadow hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                isMobile ? "w-full" : "w-full sm:w-auto"
              }`}
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

