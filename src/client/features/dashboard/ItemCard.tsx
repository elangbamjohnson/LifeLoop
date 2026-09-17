import React, { useState } from "react";
import { 
  Check, 
  Clock, 
  Calendar, 
  Bell, 
  Edit3, 
  Trash2, 
  ChevronDown, 
  AlertCircle,
  Hourglass,
  Tag,
  CreditCard,
  RefreshCw,
  FileText,
  ShieldCheck,
  ShoppingBag,
  UserCheck,
  Sparkles
} from "lucide-react";
import { TimelineItem } from "../../../shared/utils/timeline";

interface ItemCardProps {
  key?: React.Key;
  item: TimelineItem;
  onToggleComplete: (id: string, completed: boolean) => void;
  onSnooze: (id: string, days: number) => void;
  onEdit: (item: TimelineItem) => void;
  onDelete: (id: string) => void;
  onConfirmAI?: (id: string) => void;
}

export const ItemCard: React.FC<ItemCardProps> = ({
  item,
  onToggleComplete,
  onSnooze,
  onEdit,
  onDelete,
  onConfirmAI,
}) => {
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const isCompleted = item.status === "completed";
  const isPendingReview = item.status === "pending_review";

  // Type-specific icon
  const getTypeIcon = (type: string) => {
    switch (type) {
      case "payment":
        return <CreditCard className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />;
      case "renewal":
      case "subscription":
        return <RefreshCw className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />;
      case "appointment":
        return <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />;
      case "warranty":
        return <ShieldCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
      case "waiting_for":
        return <Hourglass className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />;
      case "purchase":
        return <ShoppingBag className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />;
      case "document":
        return <FileText className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />;
      case "reminder":
        return <Bell className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
      default:
        return <Tag className="w-3.5 h-3.5 text-[#78716C]" />;
    }
  };

  // Badge styling
  const getBadgeClass = (variant?: string) => {
    switch (variant) {
      case "urgent":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800/60";
      case "today":
        return "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800/60 font-semibold";
      case "upcoming":
        return "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800/60";
      case "completed":
        return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700";
      default:
        return "bg-stone-100 text-stone-700 dark:bg-stone-800/60 dark:text-stone-300 border-stone-200 dark:border-stone-700/60";
    }
  };

  const amount = item.metadata?.amount;
  const currency = item.metadata?.currency || "INR";
  const currencySymbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "₹";

  // Specialized UI for Waiting For items
  if (item.itemType === "waiting_for" && !isPendingReview) {
    const person = item.metadata?.waitingFor || item.metadata?.person || "Someone";
    const isOverdue = item.badgeVariant === "urgent";
    
    return (
      <div
        id={`item-card-${item.id}`}
        className={`group relative bg-white dark:bg-[#292524] border ${
          isCompleted
            ? "border-[#E7E5E4] dark:border-[#44403C] opacity-60"
            : isOverdue
            ? "border-amber-300 dark:border-amber-700/80 bg-amber-50/20 dark:bg-amber-950/10"
            : "border-[#E7E5E4] dark:border-[#44403C] hover:border-[#D6D3D1] dark:hover:border-[#57534E]"
        } rounded-xl p-4 transition-all duration-150 shadow-sm hover:shadow-md`}
      >
        <div className="flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <div>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded border border-purple-200 dark:border-purple-900/50 text-purple-700 dark:text-purple-400 mb-2">
                <Hourglass className="w-3 h-3" />
                Waiting For
              </span>
              <h3 className="text-sm font-semibold text-[#78716C] dark:text-[#A8A29E]">{person}</h3>
              <p className={`text-base font-medium leading-snug ${isCompleted ? 'line-through text-[#A8A29E]' : 'text-[#1C1917] dark:text-[#FDFBF7]'}`}>
                {item.title}
              </p>
              <div className="mt-1 flex items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
                {isCompleted ? (
                   <span>Received {item.completedAt ? new Date(item.completedAt).toLocaleDateString() : ''}</span>
                ) : isOverdue ? (
                   <span className="text-amber-700 dark:text-amber-400 font-medium">
                     {person}'s {item.title.toLowerCase()} is overdue by {item.badgeText?.match(/\d+/)?.[0] || '1'} day{item.badgeText?.match(/\d+/)?.[0] === '1' ? '' : 's'}.
                   </span>
                ) : (
                   <span>Expected {item.dueDate ? new Date(item.dueDate).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : 'Soon'}</span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
               <button onClick={() => onEdit(item)} className="p-1.5 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5" title="Edit"><Edit3 className="w-4 h-4" /></button>
               <button onClick={() => onDelete(item.id)} className="p-1.5 text-[#78716C] hover:text-red-600 rounded-lg hover:bg-black/5 dark:hover:bg-white/5" title="Delete"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
          
          {!isCompleted && (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <button 
                onClick={() => onToggleComplete(item.id, true)} 
                className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 rounded-lg text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors flex items-center gap-1.5"
              >
                 <Check className="w-3.5 h-3.5" /> Received
              </button>
              
              <div className="relative">
                <button 
                  onClick={() => setShowSnoozeMenu(!showSnoozeMenu)} 
                  className="px-3 py-1.5 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700/60 rounded-lg text-xs font-medium hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors flex items-center gap-1.5"
                >
                   <Clock className="w-3.5 h-3.5" /> Remind me later
                </button>
                {showSnoozeMenu && (
                  <div className="absolute left-0 top-full mt-1.5 w-36 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl shadow-lg py-1 z-30 text-xs">
                    <div className="px-3 py-1 text-[10px] font-semibold text-[#A8A29E] uppercase tracking-wider">Snooze for</div>
                    <button onClick={() => { onSnooze(item.id, 1); setShowSnoozeMenu(false); }} className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7]">+1 Day (Tomorrow)</button>
                    <button onClick={() => { onSnooze(item.id, 3); setShowSnoozeMenu(false); }} className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7]">+3 Days</button>
                    <button onClick={() => { onSnooze(item.id, 7); setShowSnoozeMenu(false); }} className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7]">Next Week (+7d)</button>
                  </div>
                )}
              </div>
              
              <button 
                onClick={() => {
                  console.log("Analytics Event: FEATURE_USAGE", { feature: "WAITING_FOR_FOLLOW_UP", itemId: item.id });
                  window.location.href = `mailto:?subject=Following up regarding ${item.title}&body=Hi ${person},%0D%0A%0D%0AJust following up on this.`;
                }} 
                className="px-3 py-1.5 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-lg text-xs font-medium hover:opacity-90 transition-opacity ml-auto"
              >
                 Follow up
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      id={`item-card-${item.id}`}
      className={`group relative bg-white dark:bg-[#292524] border ${
        isPendingReview
          ? "border-amber-300 dark:border-amber-700/80 bg-amber-50/30 dark:bg-amber-950/10"
          : isCompleted
          ? "border-[#E7E5E4] dark:border-[#44403C] opacity-60"
          : "border-[#E7E5E4] dark:border-[#44403C] hover:border-[#D6D3D1] dark:hover:border-[#57534E]"
      } rounded-xl p-4 transition-all duration-150 shadow-sm hover:shadow-md`}
    >
      <div className="flex items-start gap-3.5">
        {/* Checkbox button */}
        {!isPendingReview ? (
          <button
            id={`toggle-complete-${item.id}`}
            onClick={() => onToggleComplete(item.id, !isCompleted)}
            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
              isCompleted
                ? "bg-[#1C1917] dark:bg-[#FDFBF7] border-[#1C1917] dark:border-[#FDFBF7] text-white dark:text-[#1C1917]"
                : "border-[#D6D3D1] dark:border-[#57534E] hover:border-[#1C1917] dark:hover:border-[#FDFBF7]"
            }`}
            title={isCompleted ? "Mark incomplete" : "Mark complete"}
          >
            {isCompleted && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
          </button>
        ) : (
          <div className="mt-0.5 text-amber-500">
            <AlertCircle className="w-5 h-5" />
          </div>
        )}

        {/* Core content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {/* Category Pill */}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
              {getTypeIcon(item.itemType)}
              <span>{item.itemType.replace("_", " ")}</span>
            </span>

            {/* Countdown / Context Badge */}
            {item.badgeText && (
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border ${getBadgeClass(
                  item.badgeVariant
                )}`}
              >
                {item.badgeText}
              </span>
            )}

            {/* Confidence Warning if AI review */}
            {isPendingReview && item.confidenceScore !== null && (
              <span className="text-[11px] text-amber-700 dark:text-amber-400 font-mono">
                {Math.round((item.confidenceScore || 0) * 100)}% confidence
              </span>
            )}
          </div>

          {/* Title */}
          <h4
            className={`text-base font-medium leading-snug tracking-tight ${
              isCompleted
                ? "line-through text-[#A8A29E] dark:text-[#78716C]"
                : "text-[#1C1917] dark:text-[#FDFBF7]"
            }`}
          >
            {item.title}
          </h4>

          {/* Relation Suggestion */}
          {item.metadata?.relationPrompt && (
             <div className="mt-2 p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/50 rounded-lg flex items-center justify-between gap-3 animate-in fade-in zoom-in duration-300">
               <span className="text-xs text-blue-800 dark:text-blue-300 flex-1 leading-snug">
                 <Sparkles className="w-3.5 h-3.5 inline mr-1" />
                 {item.metadata.relationPrompt}
               </span>
               <button 
                  onClick={() => {
                     // We will implement relation confirmation via an event handler or API call
                     fetch('/api/v1/relations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                           sourceItemId: item.id,
                           targetItemId: item.metadata?.suggestedRelationTargetId,
                           relationshipType: "belongs_to"
                        })
                     }).then(() => {
                        // Optimistically remove the prompt
                        onEdit({ ...item, metadata: { ...item.metadata, relationPrompt: undefined } } as any);
                     });
                  }}
                  className="shrink-0 px-3 py-1 bg-white dark:bg-[#1C1917] border border-blue-200 dark:border-blue-800 rounded-md text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors"
               >
                 Confirm
               </button>
             </div>
          )}

          {/* Extracted Details & Amounts */}
          <div className="mt-1 flex items-center gap-3 text-xs text-[#78716C] dark:text-[#A8A29E] flex-wrap">
            {amount !== undefined && amount !== null && (
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                {currencySymbol}
                {Number(amount).toLocaleString()}
              </span>
            )}

            {item.metadata?.object && <span>Object: {item.metadata.object}</span>}
            {item.metadata?.waitingFor && <span>Waiting on: {item.metadata.waitingFor}</span>}
            {item.metadata?.location && <span>📍 {item.metadata.location}</span>}

            {item.snoozedUntil && (
              <span className="flex items-center gap-1 text-stone-500">
                <Clock className="w-3 h-3" />
                Snoozed until {new Date(item.snoozedUntil).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Actions bar */}
        <div className="flex items-center gap-1 self-start sm:self-center ml-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {isPendingReview ? (
            <div className="flex items-center gap-1.5">
              <button
                id={`confirm-review-${item.id}`}
                onClick={() => onConfirmAI && onConfirmAI(item.id)}
                className="text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                Confirm
              </button>
              <button
                id={`edit-review-${item.id}`}
                onClick={() => onEdit(item)}
                className="p-1.5 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                title="Edit item"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                id={`delete-review-${item.id}`}
                onClick={() => onDelete(item.id)}
                className="p-1.5 text-stone-400 hover:text-red-600 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                title="Reject and delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {/* Snooze Dropdown */}
              <div className="relative">
                <button
                  id={`snooze-btn-${item.id}`}
                  onClick={() => setShowSnoozeMenu(!showSnoozeMenu)}
                  className="p-1.5 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  title="Snooze"
                >
                  <Clock className="w-4 h-4" />
                </button>

                {showSnoozeMenu && (
                  <div
                    id={`snooze-menu-${item.id}`}
                    className="absolute right-0 top-full mt-1.5 w-36 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl shadow-lg py-1 z-30 text-xs"
                  >
                    <div className="px-3 py-1 text-[10px] font-semibold text-[#A8A29E] uppercase tracking-wider">
                      Snooze for
                    </div>
                    <button
                      onClick={() => {
                        onSnooze(item.id, 1);
                        setShowSnoozeMenu(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7]"
                    >
                      +1 Day (Tomorrow)
                    </button>
                    <button
                      onClick={() => {
                        onSnooze(item.id, 3);
                        setShowSnoozeMenu(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7]"
                    >
                      +3 Days
                    </button>
                    <button
                      onClick={() => {
                        onSnooze(item.id, 7);
                        setShowSnoozeMenu(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7]"
                    >
                      Next Week (+7d)
                    </button>
                  </div>
                )}
              </div>

              {/* Edit button */}
              <button
                id={`edit-item-${item.id}`}
                onClick={() => onEdit(item)}
                className="p-1.5 text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                title="Edit item"
              >
                <Edit3 className="w-4 h-4" />
              </button>

              {/* Delete button */}
              <button
                id={`delete-item-${item.id}`}
                onClick={() => onDelete(item.id)}
                className="p-1.5 text-[#78716C] hover:text-red-600 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                title="Delete item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
