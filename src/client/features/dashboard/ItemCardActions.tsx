import React, { useState } from "react";
import { Check, Clock, Edit3, Trash2, ChevronDown } from "lucide-react";
import { TimelineItem } from "../../../shared/utils/timeline";

export interface ItemCardActionsProps {
  item: TimelineItem;
  variant: "waiting_for_header" | "waiting_for_expanded" | "standard_header" | "complete_toggle";
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onToggleComplete: (id: string, completed: boolean) => void;
  onSnooze: (id: string, days: number) => void;
  onEdit: (item: TimelineItem) => void;
  onDelete: (id: string) => void;
  onConfirmAI?: (id: string) => void;
}

export const ItemCardActions: React.FC<ItemCardActionsProps> = ({
  item,
  variant,
  isExpanded = false,
  onToggleExpand,
  onToggleComplete,
  onSnooze,
  onEdit,
  onDelete,
  onConfirmAI,
}) => {
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const isCompleted = item.status === "completed";
  const isPendingReview = item.status === "pending_review";
  const person = item.metadata?.waitingFor || item.metadata?.person || "Someone";

  // Variant 1: Complete Toggle Checkbox (next to main title in standard card)
  if (variant === "complete_toggle") {
    return (
      <button
        id={`toggle-complete-${item.id}`}
        type="button"
        aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleComplete(item.id, !isCompleted);
        }}
        className="touch-target-48 w-12 h-12 -ml-3.5 -mt-3.5 flex items-center justify-center shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        title={isCompleted ? "Mark incomplete" : "Mark complete"}
      >
        <div
          className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
            isCompleted
              ? "bg-emerald-600 border-emerald-600 text-white"
              : "border-[#D6D3D1] dark:border-[#57534E] hover:border-[#1C1917] dark:hover:border-[#FDFBF7]"
          }`}
        >
          {isCompleted && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
        </div>
      </button>
    );
  }

  // Variant 2: Waiting For Header Quick Actions (Edit, Delete, Chevron)
  if (variant === "waiting_for_header") {
    return (
      <div
        className="flex items-center gap-2 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          id={`edit-item-${item.id}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(item);
          }}
          className="touch-target-48 w-12 h-12 flex items-center justify-center text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
          title="Edit"
          aria-label="Edit item"
        >
          <Edit3 className="w-4 h-4" />
        </button>
        <button
          id={`delete-item-${item.id}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
          className="touch-target-48 w-12 h-12 flex items-center justify-center text-[#78716C] hover:text-red-600 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          title="Delete"
          aria-label="Delete item"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        {onToggleExpand && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="touch-target-48 w-12 h-12 flex items-center justify-center text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-white rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
            title={isExpanded ? "Collapse" : "Expand"}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
        )}
      </div>
    );
  }

  // Variant 3: Waiting For Expanded Action Row (Received, Snooze dropdown, Follow-up)
  if (variant === "waiting_for_expanded") {
    return (
      <div
        className="flex flex-wrap items-center gap-2 mt-2 pt-2.5 border-t border-[#F5F5F4] dark:border-[#383330] animate-in fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          id={`toggle-complete-${item.id}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(item.id, true);
          }}
          className="touch-target-48 min-h-[48px] px-4 py-2 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <Check className="w-4 h-4" /> Received
        </button>

        <div className="relative">
          <button
            id={`snooze-btn-${item.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowSnoozeMenu(!showSnoozeMenu);
            }}
            className="touch-target-48 min-h-[48px] px-4 py-2 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700/60 rounded-xl text-xs font-semibold hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
          >
            <Clock className="w-4 h-4" /> Remind me later
          </button>
          {showSnoozeMenu && (
            <div
              id={`snooze-menu-${item.id}`}
              className="absolute left-0 top-full mt-1.5 w-44 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl shadow-lg py-1 z-30 text-xs"
            >
              <div className="px-3 py-1 text-[10px] font-semibold text-[#A8A29E] uppercase tracking-wider">
                Snooze for
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSnooze(item.id, 1);
                  setShowSnoozeMenu(false);
                }}
                className="touch-target-48 min-h-[48px] w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7] flex items-center"
              >
                +1 Day (Tomorrow)
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSnooze(item.id, 3);
                  setShowSnoozeMenu(false);
                }}
                className="touch-target-48 min-h-[48px] w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7] flex items-center"
              >
                +3 Days
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSnooze(item.id, 7);
                  setShowSnoozeMenu(false);
                }}
                className="touch-target-48 min-h-[48px] w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7] flex items-center"
              >
                Next Week (+7d)
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            console.log("Analytics Event: FEATURE_USAGE", {
              feature: "WAITING_FOR_FOLLOW_UP",
              itemId: item.id,
            });
            window.location.href = `mailto:?subject=Following up regarding ${item.title}&body=Hi ${person},%0D%0A%0D%0AJust following up on this.`;
          }}
          className="touch-target-48 min-h-[48px] px-4 py-2 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity ml-auto flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
        >
          Follow up
        </button>
      </div>
    );
  }

  // Variant 4: Standard Header Quick Actions (Review mode OR Regular mode: Snooze, Edit, Delete, Chevron)
  return (
    <div
      className="flex items-center gap-2 shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      {isPendingReview ? (
        <div className="flex items-center gap-2">
          <button
            id={`confirm-review-${item.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onConfirmAI && onConfirmAI(item.id);
            }}
            className="touch-target-48 min-h-[48px] px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-xl transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            Confirm
          </button>
          <button
            id={`edit-review-${item.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(item);
            }}
            className="touch-target-48 w-12 h-12 flex items-center justify-center text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
            title="Edit item"
            aria-label="Edit item"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            id={`delete-review-${item.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
            className="touch-target-48 w-12 h-12 flex items-center justify-center text-stone-400 hover:text-red-600 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            title="Reject and delete"
            aria-label="Reject and delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {/* Snooze Dropdown */}
          <div className="relative">
            <button
              id={`snooze-btn-${item.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowSnoozeMenu(!showSnoozeMenu);
              }}
              className="touch-target-48 w-12 h-12 flex items-center justify-center text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
              title="Snooze"
              aria-label="Snooze item"
            >
              <Clock className="w-4 h-4" />
            </button>

            {showSnoozeMenu && (
              <div
                id={`snooze-menu-${item.id}`}
                className="absolute right-0 top-full mt-1.5 w-44 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl shadow-lg py-1 z-30 text-xs"
              >
                <div className="px-3 py-1 text-[10px] font-semibold text-[#A8A29E] uppercase tracking-wider">
                  Snooze for
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSnooze(item.id, 1);
                    setShowSnoozeMenu(false);
                  }}
                  className="touch-target-48 min-h-[48px] w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7] flex items-center"
                >
                  +1 Day (Tomorrow)
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSnooze(item.id, 3);
                    setShowSnoozeMenu(false);
                  }}
                  className="touch-target-48 min-h-[48px] w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7] flex items-center"
                >
                  +3 Days
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSnooze(item.id, 7);
                    setShowSnoozeMenu(false);
                  }}
                  className="touch-target-48 min-h-[48px] w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-[#1C1917] dark:text-[#FDFBF7] flex items-center"
                >
                  Next Week (+7d)
                </button>
              </div>
            )}
          </div>

          {/* Edit button */}
          <button
            id={`edit-item-${item.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(item);
            }}
            className="touch-target-48 w-12 h-12 flex items-center justify-center text-[#78716C] hover:text-[#1C1917] dark:hover:text-white rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
            title="Edit item"
            aria-label="Edit item"
          >
            <Edit3 className="w-4 h-4" />
          </button>

          {/* Delete button */}
          <button
            id={`delete-item-${item.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
            className="touch-target-48 w-12 h-12 flex items-center justify-center text-[#78716C] hover:text-red-600 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            title="Delete item"
            aria-label="Delete item"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Expand / Collapse Indicator Chevron */}
      {onToggleExpand && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="touch-target-48 w-12 h-12 flex items-center justify-center text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-white rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
          title={isExpanded ? "Collapse" : "Expand"}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </button>
      )}
    </div>
  );
};
