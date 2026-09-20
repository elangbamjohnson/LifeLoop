import React, { useEffect, useRef } from "react";
import { AlertTriangle, AlertCircle, Info, X } from "lucide-react";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus Cancel button first on open & restore previous focus on close
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement as HTMLElement;

    const timer = setTimeout(() => {
      cancelBtnRef.current?.focus();
    }, 50);

    // Push history state for Android back gesture
    if (typeof window !== "undefined") {
      window.history.pushState({ modal: "confirm-dialog" }, "");
    }

    const handlePopState = () => {
      onCancel();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }

      // Focus trap
      if (e.key === "Tab" && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("keydown", handleKeyDown);
      setTimeout(() => {
        previousActiveElement.current?.focus();
      }, 50);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case "danger":
        return {
          icon: <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400 shrink-0" />,
          iconBg: "bg-rose-100 dark:bg-rose-950/50",
          confirmBtn:
            "bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white focus-visible:ring-rose-500",
        };
      case "warning":
        return {
          icon: <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0" />,
          iconBg: "bg-amber-100 dark:bg-amber-950/50",
          confirmBtn:
            "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white focus-visible:ring-amber-500",
        };
      case "info":
      default:
        return {
          icon: <Info className="w-6 h-6 text-blue-600 dark:text-blue-400 shrink-0" />,
          iconBg: "bg-blue-100 dark:bg-blue-950/50",
          confirmBtn:
            "bg-[#1C1917] dark:bg-[#FDFBF7] hover:opacity-90 active:scale-95 text-white dark:text-[#1C1917] focus-visible:ring-stone-500",
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div
      id="confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
        paddingLeft: "max(1rem, env(safe-area-inset-left, 0px))",
        paddingRight: "max(1rem, env(safe-area-inset-right, 0px))",
      }}
    >
      {/* Backdrop */}
      <div
        id="confirm-dialog-backdrop"
        onClick={onCancel}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        aria-hidden="true"
      />

      {/* Dialog container */}
      <div
        id="confirm-dialog-card"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? "confirm-dialog-description" : undefined}
        className="relative w-full max-w-md bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] rounded-3xl shadow-2xl p-6 z-10 animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-2xl ${styles.iconBg} shrink-0`}>
            {styles.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h2
              id="confirm-dialog-title"
              className="text-base sm:text-lg font-semibold text-[#1C1917] dark:text-[#FDFBF7] leading-snug"
            >
              {title}
            </h2>
            {description && (
              <p
                id="confirm-dialog-description"
                className="text-xs sm:text-sm text-[#78716C] dark:text-[#A8A29E] mt-1.5 leading-relaxed"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="touch-target-48 min-w-[48px] min-h-[48px] -mr-2 -mt-2 p-2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Actions: 48px touch targets, >=8px gap, cancel focused first */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#F5F5F4] dark:border-[#383330]">
          <button
            type="button"
            id="confirm-dialog-cancel-btn"
            ref={cancelBtnRef}
            onClick={onCancel}
            className="touch-target-48 min-h-[48px] min-w-[80px] px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold text-stone-600 dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#FDFBF7] bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            id="confirm-dialog-confirm-btn"
            onClick={onConfirm}
            className={`touch-target-48 min-h-[48px] min-w-[80px] px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 ${styles.confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
