import React, { useState, useEffect } from "react";
import { ArrowLeft, Plus, Link as LinkIcon, Edit3, X, Unlink } from "lucide-react";
import { TimelineItem } from "../../../shared/utils/timeline";
import { ItemCard } from "./ItemCard";
import { getTabClientId } from "../../utils/tabId";

interface EntityDetailViewProps {
  entity: TimelineItem;
  onBack: () => void;
  onEditItem: (item: TimelineItem) => void;
  onToggleComplete: (id: string, completed: boolean) => void;
  onSnooze: (id: string, days: number) => void;
  onDelete: (id: string) => void;
}

export function EntityDetailView({
  entity,
  onBack,
  onEditItem,
  onToggleComplete,
  onSnooze,
  onDelete,
}: EntityDetailViewProps) {
  const [relations, setRelations] = useState<any[]>([]);
  const [rawRelations, setRawRelations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [availableItems, setAvailableItems] = useState<any[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [connecting, setConnecting] = useState(false);

  const fetchConnections = () => {
    setLoading(true);
    fetch(`/api/v1/relations/${entity.id}`)
      .then((res) => res.json())
      .then(async (data) => {
        const rels = data.relations || [];
        setRawRelations(rels);
        const relatedItemIds = rels.map((r: any) =>
          r.sourceItemId === entity.id ? r.targetItemId : r.sourceItemId
        );

        if (relatedItemIds.length > 0) {
          const itemsRes = await fetch("/api/v1/items");
          const itemsData = await itemsRes.json();
          const connectedItems = (itemsData.items || []).filter((i: any) =>
            relatedItemIds.includes(i.id)
          );
          setRelations(connectedItems);
        } else {
          setRelations([]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchConnections();
  }, [entity.id]);

  const handleOpenConnect = async () => {
    setShowConnectModal(true);
    try {
      const res = await fetch("/api/v1/items");
      const data = await res.json();
      const allItems = data.items || [];
      const connectedIds = new Set(
        rawRelations.map((r: any) =>
          r.sourceItemId === entity.id ? r.targetItemId : r.sourceItemId
        )
      );
      connectedIds.add(entity.id);
      const candidates = allItems.filter((i: any) => !connectedIds.has(i.id));
      setAvailableItems(candidates);
      if (candidates.length > 0) {
        setSelectedItemId(candidates[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/v1/relations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": getTabClientId() },
        body: JSON.stringify({
          sourceItemId: selectedItemId,
          targetItemId: entity.id,
          relationshipType: "related_to",
        }),
      });
      if (res.ok) {
        setShowConnectModal(false);
        fetchConnections();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (targetItemId: string) => {
    const rel = rawRelations.find(
      (r) =>
        (r.sourceItemId === entity.id && r.targetItemId === targetItemId) ||
        (r.targetItemId === entity.id && r.sourceItemId === targetItemId)
    );
    if (!rel) return;
    try {
      await fetch(`/api/v1/relations/${rel.id}`, {
        method: "DELETE",
        headers: { "X-Client-Id": getTabClientId() },
      });
      fetchConnections();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#1C1917] dark:hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Graph
      </button>

      <div className="bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] rounded-3xl p-6 shadow-sm">
        <div className="flex justify-between items-start mb-6">
          <div>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900/50 text-blue-700 dark:text-blue-400 mb-2">
              {entity.itemType}
            </span>
            <h2 className="text-2xl font-serif text-[#1C1917] dark:text-[#FDFBF7]">
              {entity.title}
            </h2>
            {entity.metadata?.description && (
              <p className="text-sm text-[#78716C] dark:text-[#A8A29E] mt-1">
                {entity.metadata.description}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onEditItem(entity)}
              className="p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg transition-colors"
              title="Edit Entity"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="pt-6 border-t border-[#E7E5E4] dark:border-[#383330]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FDFBF7] flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-stone-400" /> Connected Items (
              {relations.length})
            </h3>
            <button
              onClick={handleOpenConnect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-xl transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Connect Item
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-stone-400 text-sm">
              Loading connections...
            </div>
          ) : relations.length === 0 ? (
            <div className="py-8 bg-stone-50 dark:bg-stone-900/50 border border-dashed border-stone-200 dark:border-stone-800 rounded-2xl text-center">
              <p className="text-sm text-stone-500">No connected items yet.</p>
              <p className="text-xs text-stone-400 mt-1">
                Capture documents, maintenance receipts, or bills mentioning this entity, or click "+ Connect Item".
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {relations.map((rel) => (
                <div key={rel.id} className="relative group">
                  <ItemCard
                    item={rel}
                    onToggleComplete={onToggleComplete}
                    onSnooze={onSnooze}
                    onEdit={onEditItem}
                    onDelete={onDelete}
                  />
                  <button
                    onClick={() => handleDisconnect(rel.id)}
                    title="Disconnect from this entity"
                    className="absolute top-3 right-24 px-2 py-1 text-[11px] font-medium text-stone-400 hover:text-red-500 bg-stone-50 dark:bg-stone-800 hover:bg-red-50 dark:hover:bg-red-950/30 border border-stone-200 dark:border-stone-700 rounded-md transition-all opacity-0 group-hover:opacity-100 flex items-center gap-1"
                  >
                    <Unlink className="w-3 h-3" />
                    <span>Unlink</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Connect Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-[#292524] rounded-2xl shadow-2xl border border-[#E7E5E4] dark:border-[#44403C]">
            <div className="flex items-center justify-between p-5 border-b border-[#E7E5E4] dark:border-[#44403C]">
              <div className="flex items-center gap-2">
                <LinkIcon size={18} className="text-blue-600 dark:text-blue-400" />
                <h2 className="font-semibold text-[#1C1917] dark:text-[#FDFBF7]">
                  Connect Item to {entity.title}
                </h2>
              </div>
              <button
                onClick={() => setShowConnectModal(false)}
                className="p-1 rounded-lg hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] transition-colors"
              >
                <X size={18} className="text-[#78716C]" />
              </button>
            </div>

            <form onSubmit={handleConnect} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">
                  Select an item to connect:
                </label>
                {availableItems.length === 0 ? (
                  <p className="text-xs text-[#78716C] italic py-2">
                    No other unlinked items available in your vault.
                  </p>
                ) : (
                  <select
                    value={selectedItemId}
                    onChange={(e) => setSelectedItemId(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 bg-[#F5F5F4] dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                  >
                    {availableItems.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.title} ({it.itemType})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="px-4 py-2 text-sm text-[#78716C] hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connecting || availableItems.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors"
                >
                  {connecting ? "Connecting..." : "Connect"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
