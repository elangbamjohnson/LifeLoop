import React, { useState, useEffect } from "react";
import { ArrowLeft, Plus, Link as LinkIcon, FileText, Calendar, DollarSign, Edit3, Trash2 } from "lucide-react";
import { TimelineItem } from "../../../shared/utils/timeline";
import { ItemCard } from "./ItemCard";

interface EntityDetailViewProps {
  entity: TimelineItem;
  onBack: () => void;
  onEditItem: (item: TimelineItem) => void;
  onToggleComplete: (id: string, completed: boolean) => void;
  onSnooze: (id: string, days: number) => void;
  onDelete: (id: string) => void;
}

export function EntityDetailView({ entity, onBack, onEditItem, onToggleComplete, onSnooze, onDelete }: EntityDetailViewProps) {
  const [relations, setRelations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/relations/${entity.id}`)
      .then(res => res.json())
      .then(async (data) => {
        // Fetch the actual item details for each relation
        const rels = data.relations || [];
        const relatedItemIds = rels.map((r: any) => r.sourceItemId === entity.id ? r.targetItemId : r.sourceItemId);
        
        if (relatedItemIds.length > 0) {
           const itemsRes = await fetch('/api/v1/items');
           const itemsData = await itemsRes.json();
           const connectedItems = itemsData.items.filter((i: any) => relatedItemIds.includes(i.id));
           setRelations(connectedItems);
        } else {
           setRelations([]);
        }
        setLoading(false);
      });
  }, [entity.id]);

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#1C1917] dark:hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Graph
      </button>

      <div className="bg-white dark:bg-[#23201E] border border-[#E7E5E4] dark:border-[#383330] rounded-3xl p-6 shadow-sm">
        <div className="flex justify-between items-start mb-6">
           <div>
             <span className="inline-flex items-center gap-1 text-[11px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900/50 text-blue-700 dark:text-blue-400 mb-2">
               {entity.itemType}
             </span>
             <h2 className="text-2xl font-serif text-[#1C1917] dark:text-[#FDFBF7]">{entity.title}</h2>
             {entity.metadata?.description && (
                <p className="text-sm text-[#78716C] dark:text-[#A8A29E] mt-1">{entity.metadata.description}</p>
             )}
           </div>
           
           <div className="flex gap-2">
              <button onClick={() => onEditItem(entity)} className="p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg transition-colors"><Edit3 className="w-4 h-4" /></button>
           </div>
        </div>
        
        <div className="pt-6 border-t border-[#E7E5E4] dark:border-[#383330]">
           <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FDFBF7] flex items-center gap-2">
                 <LinkIcon className="w-4 h-4 text-stone-400" /> Connected Items
              </h3>
           </div>
           
           {loading ? (
             <div className="py-8 text-center text-stone-400 text-sm">Loading connections...</div>
           ) : relations.length === 0 ? (
             <div className="py-8 bg-stone-50 dark:bg-stone-900/50 border border-dashed border-stone-200 dark:border-stone-800 rounded-2xl text-center">
                <p className="text-sm text-stone-500">No connected items yet.</p>
                <p className="text-xs text-stone-400 mt-1">Capture documents, bills, or tasks and mention this entity to connect them.</p>
             </div>
           ) : (
             <div className="space-y-3">
               {relations.map(rel => (
                 <ItemCard 
                    key={rel.id} 
                    item={rel} 
                    onToggleComplete={onToggleComplete} 
                    onSnooze={onSnooze} 
                    onEdit={onEditItem} 
                    onDelete={onDelete} 
                 />
               ))}
             </div>
           )}
        </div>
      </div>
    </div>
  );
}
