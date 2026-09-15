import React, { useEffect, useState } from "react";
import { X, Share2 } from "lucide-react";

interface UserItem {
  id: string;
  title: string;
  itemType: string;
  status: string;
}

interface Props {
  familyId: string;
  onClose: () => void;
  onShared: () => void;
}

const CATEGORIES = [
  { value: "bills", label: "💳 Bills & Payments" },
  { value: "school_events", label: "🎒 School Events" },
  { value: "appointments", label: "📅 Appointments" },
  { value: "shopping", label: "🛒 Shopping" },
  { value: "documents", label: "📄 Documents" },
  { value: "reminders", label: "🔔 Household Reminders" },
  { value: "vehicle", label: "🚗 Vehicle Information" },
];

export function ShareItemModal({ familyId, onClose, onShared }: Props) {
  const [myItems, setMyItems] = useState<UserItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [category, setCategory] = useState("bills");
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingItems, setFetchingItems] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/v1/items")
      .then((r) => r.json())
      .then((d) => setMyItems(d.items ?? []))
      .catch(() => setMyItems([]))
      .finally(() => setFetchingItems(false));
  }, []);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/families/${familyId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: selectedItemId, category, canEdit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to share item");
      onShared();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#292524] rounded-2xl shadow-2xl border border-[#E7E5E4] dark:border-[#44403C]">
        <div className="flex items-center justify-between p-5 border-b border-[#E7E5E4] dark:border-[#44403C]">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-[#78716C] dark:text-[#A8A29E]" />
            <h2 className="font-semibold text-[#1C1917] dark:text-[#FDFBF7]">Share an Item</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] transition-colors">
            <X size={18} className="text-[#78716C]" />
          </button>
        </div>

        <form onSubmit={handleShare} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">Select an item to share</label>
            {fetchingItems ? (
              <div className="h-10 bg-[#F5F5F4] dark:bg-[#1C1917] rounded-xl animate-pulse" />
            ) : (
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-[#F5F5F4] dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A8A29E] transition-all"
              >
                <option value="">— choose an item —</option>
                {myItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} ({item.itemType})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#F5F5F4] dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A8A29E] transition-all"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => setCanEdit(!canEdit)}
              className={`w-10 h-6 rounded-full transition-colors relative ${canEdit ? "bg-[#1C1917] dark:bg-[#FDFBF7]" : "bg-[#D6D3D1] dark:bg-[#44403C]"}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white dark:bg-[#1C1917] transition-transform ${canEdit ? "translate-x-5" : "translate-x-1"}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-[#44403C] dark:text-[#D6D3D1]">Allow editing</p>
              <p className="text-xs text-[#A8A29E]">Family members can mark this item as complete or update it</p>
            </div>
          </label>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] text-[#44403C] dark:text-[#D6D3D1] hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedItemId}
              className="flex-1 py-2.5 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors disabled:opacity-50"
            >
              {loading ? "Sharing…" : "Share Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
