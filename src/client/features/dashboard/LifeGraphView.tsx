import React, { useState, useEffect } from "react";
import { Network, Home, Car, User, FileText, ChevronRight, Sparkles, Folder } from "lucide-react";
import { TimelineItem } from "../../../shared/utils/timeline";

interface LifeGraphViewProps {
  onOpenEntity: (item: TimelineItem) => void;
}

export function LifeGraphView({ onOpenEntity }: LifeGraphViewProps) {
  const [entities, setEntities] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/items")
      .then((res) => res.json())
      .then((data) => {
        const items = data.items || [];
        const entityTypes = ["person", "vehicle", "home", "subscription"];
        setEntities(items.filter((i: any) => entityTypes.includes(i.itemType)));
        setLoading(false);
      });
  }, []);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "person": return <User className="w-5 h-5 text-blue-500" />;
      case "vehicle": return <Car className="w-5 h-5 text-emerald-500" />;
      case "home": return <Home className="w-5 h-5 text-amber-500" />;
      default: return <Folder className="w-5 h-5 text-stone-500" />;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-[#A8A29E]">
        <div className="w-8 h-8 rounded-full border-2 border-stone-300 border-t-stone-600 animate-spin mb-4" />
        <p className="text-sm">Loading your Life Graph...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-2 bg-purple-100 dark:bg-purple-900/40 rounded-xl text-purple-600 dark:text-purple-400">
          <Network className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-[#1C1917] dark:text-[#FDFBF7]">Life Graph</h2>
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">Your connected entities and context</p>
        </div>
      </div>

      {entities.length === 0 ? (
        <div className="bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] rounded-2xl p-8 text-center">
          <Sparkles className="w-8 h-8 text-stone-300 dark:text-stone-700 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FDFBF7] mb-1">No entities found</h3>
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">Capture things like "Bought a Honda City" or "Moved to 123 Main St" to start building your graph.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {entities.map(entity => (
            <button
              key={entity.id}
              onClick={() => onOpenEntity(entity)}
              className="flex items-center justify-between p-4 bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] rounded-2xl hover:border-blue-300 dark:hover:border-blue-800 transition-colors group text-left shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-stone-50 dark:bg-stone-900 rounded-lg">
                   {getTypeIcon(entity.itemType)}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#1C1917] dark:text-[#FDFBF7]">{entity.title}</h4>
                  <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E] uppercase tracking-wider">{entity.itemType}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-stone-300 dark:text-stone-600 group-hover:text-blue-500 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
