import React, { useState, useRef } from "react";
import { Mic, Camera, FileUp, Type, X, Send } from "lucide-react";

interface CaptureDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { type: string; payload: string | File }) => Promise<void>;
}

export function CaptureDialog({ isOpen, onClose, onSubmit }: CaptureDialogProps) {
  const [activeTab, setActiveTab] = useState<"text" | "media">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text && !file) return;

    setLoading(true);
    setErrorMessage(null);
    try {
      if (activeTab === "text" && text) {
        await onSubmit({ type: "text", payload: text });
      } else if (activeTab === "media" && file) {
        // Simple type inference
        let type = "document";
        if (file.type.startsWith("image/")) type = "image";
        if (file.type.startsWith("audio/")) type = "audio";
        
        await onSubmit({ type, payload: file });
      }
      setText("");
      setFile(null);
      onClose();
    } catch (error) {
      console.error("Submit error", error);
      setErrorMessage("Failed to save capture. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-0" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      
      <div className="relative w-full max-w-lg bg-[#FDFBF7] dark:bg-[#1C1917] rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-8 duration-300">
        <div className="flex items-center justify-between p-4 border-b border-[#E7E5E4] dark:border-[#292524]">
          <div className="flex gap-2 p-1 bg-[#E7E5E4]/50 dark:bg-[#292524] rounded-xl">
            <button
              onClick={() => setActiveTab("text")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === "text" 
                  ? "bg-white dark:bg-[#44403C] text-black dark:text-white shadow-sm" 
                  : "text-[#78716C] hover:text-black dark:hover:text-white"
              }`}
            >
              <Type className="w-4 h-4 inline-block mr-2" />
              Text
            </button>
            <button
              onClick={() => setActiveTab("media")}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === "media" 
                  ? "bg-white dark:bg-[#44403C] text-black dark:text-white shadow-sm" 
                  : "text-[#78716C] hover:text-black dark:hover:text-white"
              }`}
            >
              <Camera className="w-4 h-4 inline-block mr-2" />
              Media
            </button>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-[#78716C] hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div role="alert" className="mx-4 mt-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs rounded-xl flex items-center justify-between">
            <span>{errorMessage}</span>
            <button type="button" onClick={() => setErrorMessage(null)} className="text-rose-500 hover:text-rose-700 p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6">
          {activeTab === "text" ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What's on your mind? Drop any thought, task, or note here..."
              className="w-full h-40 bg-transparent text-lg resize-none outline-none text-[#1C1917] dark:text-[#FDFBF7] placeholder:text-[#A8A29E]"
              autoFocus
            />
          ) : (
            <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-[#E7E5E4] dark:border-[#44403C] rounded-2xl bg-white/50 dark:bg-black/20">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                accept="image/*,audio/*,.pdf,.doc,.docx"
              />
              {file ? (
                <div className="text-center">
                  <p className="font-medium text-[#1C1917] dark:text-[#FDFBF7]">{file.name}</p>
                  <p className="text-sm text-[#78716C]">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="mt-2 text-sm text-red-500 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 p-4 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white transition-colors"
                  >
                    <div className="w-12 h-12 flex items-center justify-center rounded-full bg-[#E7E5E4] dark:bg-[#292524]">
                      <FileUp className="w-6 h-6" />
                    </div>
                    <span className="text-sm font-medium">Upload File</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={loading || (activeTab === "text" && !text) || (activeTab === "media" && !file)}
              className="flex items-center gap-2 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] px-6 py-3 rounded-full font-medium hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Save to LifeLoop
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
