import React, { useEffect } from "react";
import { Bell, X } from "lucide-react";

export interface ReminderBannerProps {
  reminder: {
    id: string;
    title: string;
    itemId?: string;
  };
  onOpenItem: (itemId?: string) => void;
  onDismiss: () => void;
  autoDismissMs?: number;
}

export function ReminderBanner({
  reminder,
  onOpenItem,
  onDismiss,
  autoDismissMs = 8000,
}: ReminderBannerProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [reminder.id, onDismiss, autoDismissMs]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="reminder-banner"
      className="fixed top-0 left-0 right-0 z-[100] px-4 pt-[calc(env(safe-area-inset-top,0px)+8px)] pb-2 flex justify-center pointer-events-none"
    >
      <div
        onClick={() => onOpenItem(reminder.itemId)}
        data-testid="reminder-banner-content"
        className="pointer-events-auto touch-target-48 min-h-[48px] max-w-md w-full bg-stone-900/95 dark:bg-[#1C1917]/95 text-stone-50 dark:text-[#FDFBF7] backdrop-blur-md px-4 py-2.5 rounded-2xl shadow-xl border border-stone-800 dark:border-stone-700/60 flex items-center justify-between gap-3 cursor-pointer select-none transition-all hover:scale-[1.01] active:scale-[0.99]"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium tracking-wide uppercase text-stone-400 dark:text-stone-400">
              LifeLoop Reminder
            </div>
            <div className="text-sm font-semibold truncate">
              {reminder.title}
            </div>
          </div>
        </div>

        <button
          type="button"
          aria-label="Dismiss reminder"
          data-testid="dismiss-reminder-banner-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="touch-target-48 min-w-[36px] min-h-[36px] flex items-center justify-center text-stone-400 hover:text-white rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
