import React, { useState, useEffect } from "react";
import { X, Bell, Globe, Moon, ShieldCheck, Check } from "lucide-react";

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PreferencesModal({ isOpen, onClose }: PreferencesModalProps) {
  if (!isOpen) return null;

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

  return (
    <div
      id="preferences-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        id="preferences-modal-card"
        className="bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] w-full max-w-md rounded-3xl shadow-2xl p-6 sm:p-7 overflow-y-auto max-h-[90vh]"
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#F5F5F4] dark:border-[#332F2C]">
          <h3 className="text-lg font-serif tracking-tight text-[#1C1917] dark:text-[#FDFBF7] flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-500" />
            Reminder Preferences
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-5 space-y-6">
          {/* Automatic Reminders Setting */}
          <div className="p-4 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700">
            <div className="flex items-start justify-between gap-3">
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
                className={`w-11 h-6 rounded-full transition-colors flex items-center p-0.5 ${
                  autoReminders ? "bg-[#1C1917] dark:bg-[#FDFBF7]" : "bg-stone-300 dark:bg-stone-700"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white dark:bg-[#1C1917] transition-transform ${
                    autoReminders ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Active Channels */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-2">
              Notification Channels
            </label>
            <div className="space-y-2">
              {[
                { id: "web", name: "Web Notifications", desc: "Browser alert & in-app banner" },
                { id: "email", name: "Email Notifications", desc: "Future-ready email digest" },
                { id: "ios", name: "iOS (APNs)", desc: "Apple Push Notifications" },
                { id: "android", name: "Android (FCM)", desc: "Google Firebase Messaging" },
              ].map((ch) => (
                <div
                  key={ch.id}
                  onClick={() => toggleChannel(ch.id)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                    channels.includes(ch.id)
                      ? "border-[#1C1917] dark:border-[#FDFBF7] bg-stone-50 dark:bg-stone-800/70"
                      : "border-[#E7E5E4] dark:border-[#44403C] hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <div>
                    <div className="text-xs font-medium text-[#1C1917] dark:text-[#FDFBF7]">
                      {ch.name}
                    </div>
                    <div className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                      {ch.desc}
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded-md border flex items-center justify-center ${
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
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Grant browser notification permissions
                </button>
              </div>
            )}
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] mb-1.5 flex items-center gap-1">
              <Globe className="w-3.5 h-3.5" /> Timezone
            </label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-xs text-[#1C1917] dark:text-[#FDFBF7]"
            />
            <p className="text-[11px] text-[#78716C] mt-1">
              Ensures notifications arrive at the exact local hour across daylight-saving shifts.
            </p>
          </div>

          {/* Quiet Hours */}
          <div className="pt-2 border-t border-[#F5F5F4] dark:border-[#332F2C]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E] flex items-center gap-1">
                <Moon className="w-3.5 h-3.5" /> Quiet Hours
              </span>
              <button
                type="button"
                onClick={() => setQuietHoursEnabled(!quietHoursEnabled)}
                className={`text-xs font-medium ${
                  quietHoursEnabled ? "text-amber-600 dark:text-amber-400" : "text-[#78716C]"
                }`}
              >
                {quietHoursEnabled ? "Enabled" : "Disabled"}
              </button>
            </div>

            {quietHoursEnabled && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="block text-[11px] text-[#78716C] mb-1">Start</label>
                  <input
                    type="time"
                    value={quietHoursStart}
                    onChange={(e) => setQuietHoursStart(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-xs text-[#1C1917] dark:text-[#FDFBF7]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#78716C] mb-1">End</label>
                  <input
                    type="time"
                    value={quietHoursEnd}
                    onChange={(e) => setQuietHoursEnd(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#E7E5E4] dark:border-[#44403C] bg-white dark:bg-[#1C1917] text-xs text-[#1C1917] dark:text-[#FDFBF7]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#F5F5F4] dark:border-[#332F2C]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-[#78716C] hover:text-[#1C1917] dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-full bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] text-xs font-medium shadow hover:opacity-90 transition-all flex items-center gap-1.5"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> Saved!
                </>
              ) : saving ? (
                "Saving..."
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
