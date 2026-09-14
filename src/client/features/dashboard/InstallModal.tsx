import React, { useState } from "react";
import { 
  X, 
  Smartphone, 
  Share, 
  PlusSquare, 
  Copy, 
  Check, 
  ExternalLink,
  Download,
  Sparkles,
  ArrowRight
} from "lucide-react";
import { usePWAInstall } from "../../hooks/usePWAInstall";

interface InstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallModal: React.FC<InstallModalProps> = ({ isOpen, onClose }) => {
  const { isInstallable, install } = usePWAInstall();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Use current window URL or canonical preview URL
  const currentUrl = typeof window !== "undefined" ? window.location.origin : "";

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(currentUrl)}&bgcolor=FDFBF7&color=1C1917`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-[#FDFBF7] dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#2E2A27] rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between border-b border-[#E7E5E4] dark:border-[#2E2A27]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1C1917] dark:bg-[#FDFBF7] flex items-center justify-center text-amber-400 dark:text-stone-900 shadow-md">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-serif font-semibold text-[#1C1917] dark:text-[#FDFBF7]">
                Install on iPhone
              </h2>
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">
                Test LifeLoop directly on your real device
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-full hover:bg-stone-200/50 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Quick Install if Chromium/Android detected */}
          {isInstallable && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Direct Install Available
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                  Browser supports 1-tap installation
                </p>
              </div>
              <button
                onClick={install}
                className="px-3.5 py-1.5 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] text-xs font-medium rounded-xl flex items-center gap-1.5 shadow-sm hover:opacity-90"
              >
                <Download className="w-3.5 h-3.5" />
                Install Now
              </button>
            </div>
          )}

          {/* iPhone Safari Step by Step Guide */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#78716C] dark:text-[#A8A29E]">
                Steps for iPhone (Safari)
              </h3>
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 rounded-full">
                Full Screen PWA
              </span>
            </div>

            {/* Step 1: Open in Safari */}
            <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-stone-100 dark:bg-stone-900/60 border border-stone-200/60 dark:border-stone-800">
              <div className="w-6 h-6 rounded-full bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                1
              </div>
              <div className="space-y-1.5 text-xs text-stone-700 dark:text-stone-300 flex-1">
                <p className="font-semibold text-stone-900 dark:text-stone-100">
                  Open LifeLoop in Safari on your iPhone
                </p>
                <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-relaxed">
                  Make sure you are using <strong>Apple Safari</strong> (Chrome on iOS does not support adding to home screen).
                </p>
                
                {/* Copy or scan link */}
                <div className="pt-2 flex flex-col sm:flex-row items-center gap-2">
                  <div className="flex-1 w-full flex items-center justify-between bg-white dark:bg-stone-950 px-3 py-1.5 rounded-xl border border-stone-200 dark:border-stone-800 text-[11px] font-mono truncate">
                    <span className="truncate mr-2 text-stone-600 dark:text-stone-400">{currentUrl}</span>
                    <button
                      onClick={handleCopyUrl}
                      className="text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white flex items-center gap-1 font-sans shrink-0 font-medium text-xs ml-1"
                      title="Copy URL"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-emerald-600 text-[11px]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span className="text-[11px]">Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2: Share button */}
            <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-stone-100 dark:bg-stone-900/60 border border-stone-200/60 dark:border-stone-800">
              <div className="w-6 h-6 rounded-full bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                2
              </div>
              <div className="space-y-1 text-xs text-stone-700 dark:text-stone-300 flex-1">
                <p className="font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                  Tap the Safari <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-mono text-[11px]"><Share className="w-3 h-3 mr-1 inline" /> Share</span> button
                </p>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Located in the bottom toolbar of Safari on iPhone (or top bar on iPad).
                </p>
              </div>
            </div>

            {/* Step 3: Add to Home Screen */}
            <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-stone-100 dark:bg-stone-900/60 border border-stone-200/60 dark:border-stone-800">
              <div className="w-6 h-6 rounded-full bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                3
              </div>
              <div className="space-y-1 text-xs text-stone-700 dark:text-stone-300 flex-1">
                <p className="font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                  Scroll down & select <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-800 font-semibold text-[11px]"><PlusSquare className="w-3 h-3 mr-1 inline" /> Add to Home Screen</span>
                </p>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Tap <strong>Add</strong> in the top right corner.
                </p>
              </div>
            </div>

            {/* Step 4: Launch */}
            <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
              <div className="w-6 h-6 rounded-full bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                4
              </div>
              <div className="space-y-1 text-xs text-emerald-900 dark:text-emerald-200 flex-1">
                <p className="font-semibold">
                  Launch LifeLoop from your iPhone Home Screen
                </p>
                <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
                  The app will open full-screen with native gestures, camera capture, offline caching, and zero browser chrome!
                </p>
              </div>
            </div>
          </div>

          {/* QR Code Option */}
          <div className="p-4 rounded-2xl bg-stone-100 dark:bg-stone-900/60 border border-stone-200/60 dark:border-stone-800 flex items-center gap-4">
            <div className="p-1.5 bg-white rounded-xl shadow-sm border border-stone-200 dark:border-stone-700 shrink-0">
              <img 
                src={qrUrl} 
                alt="Scan to open on iPhone" 
                className="w-20 h-20 rounded-lg object-contain"
                loading="lazy"
              />
            </div>
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Scan with iPhone Camera
              </p>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 leading-relaxed">
                Open your iPhone Camera app, point it at this QR code, and tap the yellow Safari link banner to open LifeLoop immediately.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-stone-50 dark:bg-stone-900 border-t border-[#E7E5E4] dark:border-[#2E2A27] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl hover:opacity-90 transition-opacity"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
