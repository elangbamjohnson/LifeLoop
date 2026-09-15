import React, { useState } from "react";
import { X, Users } from "lucide-react";

interface Props {
  onClose: () => void;
  onCreated: (family: any) => void;
}

export function CreateFamilyModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/families", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create family");
      onCreated(data.family);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-[#292524] rounded-2xl shadow-2xl border border-[#E7E5E4] dark:border-[#44403C]">
        <div className="flex items-center justify-between p-5 border-b border-[#E7E5E4] dark:border-[#44403C]">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-[#78716C] dark:text-[#A8A29E]" />
            <h2 className="font-semibold text-[#1C1917] dark:text-[#FDFBF7]">Create a Family</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] transition-colors">
            <X size={18} className="text-[#78716C]" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">
              Family name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Johnsons"
              className="w-full px-4 py-2.5 bg-[#F5F5F4] dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A8A29E] transition-all"
              required
              autoFocus
            />
          </div>
          <p className="text-xs text-[#A8A29E]">
            You'll be the owner of this family. You can invite members after creating it.
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-2.5 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create Family"}
          </button>
        </form>
      </div>
    </div>
  );
}
