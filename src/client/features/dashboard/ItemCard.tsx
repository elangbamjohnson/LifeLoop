import React, { useState } from "react";
import { 
  Check, 
  Clock, 
  Calendar, 
  Bell, 
  AlertCircle,
  Hourglass, 
  Tag, 
  CreditCard, 
  RefreshCw, 
  FileText, 
  ShieldCheck, 
  ShoppingBag, 
  UserCheck, 
  Sparkles,
  Car,
  Users,
  Paperclip
} from "lucide-react";
import { TimelineItem } from "../../../shared/utils/timeline";
import { ItemCardActions } from "./ItemCardActions";
import { getTabClientId } from "../../utils/tabId";

interface ItemCardProps {
  key?: React.Key;
  item: TimelineItem;
  onToggleComplete: (id: string, completed: boolean) => void;
  onSnooze: (id: string, days: number) => void;
  onEdit: (item: TimelineItem) => void;
  onDelete: (id: string) => void;
  onConfirmAI?: (id: string) => void;
}

export const ItemCard: React.FC<ItemCardProps> = React.memo(({
  item,
  onToggleComplete,
  onSnooze,
  onEdit,
  onDelete,
  onConfirmAI,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isCompleted = item.status === "completed";
  const isPendingReview = item.status === "pending_review";

  // Category theme helper
  const getCategoryTheme = (type: string) => {
    switch (type.toLowerCase()) {
      case "payment":
      case "bill":
      case "financial":
        return {
          pillClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
          icon: <CreditCard className="w-3.5 h-3.5" />,
          label: "Financial"
        };
      case "document":
        return {
          pillClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
          icon: <FileText className="w-3.5 h-3.5" />,
          label: "Document"
        };
      case "vehicle":
      case "car":
      case "warranty":
        return {
          pillClass: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
          icon: <Car className="w-3.5 h-3.5" />,
          label: type.toLowerCase() === "warranty" ? "Warranty" : "Vehicle"
        };
      case "renewal":
      case "subscription":
      case "task":
      case "appointment":
      case "reminder":
        return {
          pillClass: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
          icon: type === "appointment" ? <Calendar className="w-3.5 h-3.5" /> : type === "reminder" ? <Bell className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />,
          label: type === "renewal" ? "Renewal" : type === "subscription" ? "Subscription" : type === "appointment" ? "Appointment" : "Task"
        };
      case "waiting_for":
      case "person":
      case "memory":
      case "personal":
        return {
          pillClass: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
          icon: type === "waiting_for" ? <Hourglass className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />,
          label: type === "waiting_for" ? "Waiting For" : "Personal"
        };
      default:
        return {
          pillClass: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
          icon: <Tag className="w-3.5 h-3.5" />,
          label: type.replace("_", " ")
        };
    }
  };

  const amount = item.metadata?.amount;
  const currency = item.metadata?.currency || "INR";
  const currencySymbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "₹";
  const policyNumber = item.metadata?.policyNumber || item.metadata?.policy_number || item.metadata?.policyNo;
  const vin = item.metadata?.vin || item.metadata?.vinNumber;
  const location = item.metadata?.location;
  const descriptionText = item.metadata?.description || item.metadata?.notes || item.metadata?.rawPayload || null;
  const isFamilyShared = Boolean(item.metadata?.familyShared || item.metadata?.sharedWithFamily || item.metadata?.isShared);

  const rawTags = item.metadata?.tags;
  const tags: string[] = Array.isArray(rawTags) 
    ? rawTags 
    : typeof rawTags === "string" 
    ? rawTags.split(",").map(t => t.trim()).filter(Boolean)
    : [];

  const categoryTheme = getCategoryTheme(item.itemType);

  // Due Date alert pill variant
  const getDueDatePill = () => {
    if (!item.badgeText && !item.dueDate) return null;
    const text = item.badgeText || (item.dueDate ? `Due ${new Date(item.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : null);
    if (!text) return null;

    let className = "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700/60";
    if (item.badgeVariant === "urgent") {
      // Genuinely overdue (past due date)
      className = "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900";
    } else if (item.badgeVariant === "review") {
      // Pending AI confirmation – amber, NOT red
      className = "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900";
    } else if (item.badgeVariant === "today") {
      className = "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900";
    } else if (item.badgeVariant === "upcoming") {
      className = "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60";
    }

    return { text, className };
  };

  const dueDatePill = getDueDatePill();
  const hasStructuredFields = Boolean(amount !== undefined && amount !== null) || Boolean(item.dueDate) || Boolean(policyNumber) || Boolean(vin) || Boolean(location) || Boolean(item.snoozedUntil);

  // Specialized UI for Waiting For items
  if (item.itemType === "waiting_for" && !isPendingReview) {
    const person = item.metadata?.waitingFor || item.metadata?.person || "Someone";
    // Only "urgent" (past due date) counts as overdue — not "review" (pending confirmation)
    const isOverdue = item.badgeVariant === "urgent";
    
    return (
      <div
        id={`item-card-${item.id}`}
        onClick={() => setIsExpanded(!isExpanded)}
        className={`group relative bg-white dark:bg-[#292524] rounded-2xl p-3.5 sm:p-4 border cursor-pointer ${
          isCompleted
            ? "border-[#E7E5E4] dark:border-[#383330] opacity-60"
            : isOverdue
            ? "border-amber-300 dark:border-amber-700/80 bg-amber-50/20 dark:bg-amber-950/10"
            : "border-[#E7E5E4] dark:border-[#44403C] hover:border-[#D6D3D1] dark:hover:border-[#57534E]"
        } transition-all shadow-sm hover:shadow`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-900/50 mb-1.5">
                <Hourglass className="w-3 h-3" />
                Waiting For
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xs font-semibold text-[#78716C] dark:text-[#A8A29E]">{person}</h3>
                <span className="text-xs text-[#A8A29E]">•</span>
                <h4
                  className={`text-base font-medium leading-snug tracking-tight ${
                    isCompleted
                      ? "line-through text-[#A8A29E] dark:text-[#78716C]"
                      : "text-[#1C1917] dark:text-[#FDFBF7]"
                  }`}
                >
                  {item.title}
                </h4>
              </div>
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
            
            {/* Quick Action Buttons (Always Visible, Never Auto-Hidden) + Chevron */}
            <ItemCardActions
              item={item}
              variant="waiting_for_header"
              isExpanded={isExpanded}
              onToggleExpand={() => setIsExpanded(!isExpanded)}
              onToggleComplete={onToggleComplete}
              onSnooze={onSnooze}
              onEdit={onEdit}
              onDelete={onDelete}
              onConfirmAI={onConfirmAI}
            />
          </div>
          
          {/* Expanded Actions & Details */}
          {isExpanded && !isCompleted && (
            <ItemCardActions
              item={item}
              variant="waiting_for_expanded"
              onToggleComplete={onToggleComplete}
              onSnooze={onSnooze}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      id={`item-card-${item.id}`}
      onClick={() => setIsExpanded(!isExpanded)}
      className={`group relative bg-white dark:bg-[#292524] rounded-2xl p-3.5 sm:p-4 border cursor-pointer ${
        isPendingReview
          ? "border-amber-300 dark:border-amber-700/80 bg-amber-50/20 dark:bg-amber-950/10"
          : isCompleted
          ? "border-[#E7E5E4] dark:border-[#383330] opacity-60"
          : "border-[#E7E5E4] dark:border-[#44403C] hover:border-[#D6D3D1] dark:hover:border-[#57534E]"
      } transition-all shadow-sm hover:shadow`}
    >
      {/* 1. Header Row (Status, Category, Timestamp & Always-Visible Actions) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${categoryTheme.pillClass}`}>
            {categoryTheme.icon}
            <span className="capitalize">{categoryTheme.label}</span>
          </span>

          {/* AI Confidence / Status Badge */}
          {isPendingReview ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              Needs Review {item.confidenceScore !== null ? `(${Math.round((item.confidenceScore || 0) * 100)}%)` : ""}
            </span>
          ) : isCompleted ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
              Completed
            </span>
          ) : null}

          {/* Timestamp / Date */}
          <span className="text-[11px] text-[#57534E] dark:text-[#D6D3D1] ml-1">
            {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        </div>

        {/* Right Side: Quick Action Buttons (Always Visible, Never Auto-Hidden) + Chevron */}
        <ItemCardActions
          item={item}
          variant="standard_header"
          isExpanded={isExpanded}
          onToggleExpand={() => setIsExpanded(!isExpanded)}
          onToggleComplete={onToggleComplete}
          onSnooze={onSnooze}
          onEdit={onEdit}
          onDelete={onDelete}
          onConfirmAI={onConfirmAI}
        />
      </div>

      {/* 2. Main Title & Due Date Row (Compact & Essential) */}
      <div className="flex items-start gap-3 mt-2.5">
        {!isPendingReview ? (
          <ItemCardActions
            item={item}
            variant="complete_toggle"
            onToggleComplete={onToggleComplete}
            onSnooze={onSnooze}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ) : (
          <div className="mt-0.5 text-amber-500 shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {(item.metadata?.waitingFor || item.metadata?.person) && (
              <>
                <h3 className="text-xs font-semibold text-[#78716C] dark:text-[#A8A29E]">
                  {item.metadata?.waitingFor || item.metadata?.person}
                </h3>
                <span className="text-xs text-[#A8A29E]">•</span>
              </>
            )}
            <h4
              className={`text-base font-medium leading-snug tracking-tight ${
                isCompleted
                  ? "line-through text-[#A8A29E] dark:text-[#78716C]"
                  : "text-[#1C1917] dark:text-[#FDFBF7]"
              }`}
            >
              {item.title}
            </h4>

            {/* Due Date Alert Pill */}
            {dueDatePill && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 ${dueDatePill.className}`}>
                <Calendar className="w-3 h-3" />
                <span>{dueDatePill.text}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Expandable Complete Information Container */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-[#F5F5F4] dark:border-[#383330] space-y-3 animate-in fade-in duration-200">
          {/* Detailed Description / Notes */}
          {descriptionText && (
            <p className="text-xs sm:text-sm text-[#57534E] dark:text-[#D6D3D1] leading-relaxed font-normal">
              {descriptionText}
            </p>
          )}

          {/* Relation Suggestion (if pending link) */}
          {item.metadata?.relationPrompt && (
            <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/50 rounded-lg flex items-center justify-between gap-3 animate-in fade-in zoom-in duration-300">
              <span className="text-xs text-blue-800 dark:text-blue-300 flex-1 leading-snug">
                <Sparkles className="w-3.5 h-3.5 inline mr-1" />
                {item.metadata.relationPrompt}
              </span>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  fetch('/api/v1/relations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Client-Id': getTabClientId() },
                    body: JSON.stringify({
                      sourceItemId: item.id,
                      targetItemId: item.metadata?.suggestedRelationTargetId,
                      relationshipType: "belongs_to"
                    })
                  }).then(() => {
                    onEdit({ ...item, metadata: { ...item.metadata, relationPrompt: undefined } } as any);
                  });
                }}
                className="shrink-0 px-3 py-1 bg-white dark:bg-[#1C1917] border border-blue-200 dark:border-blue-800 rounded-md text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors"
              >
                Confirm
              </button>
            </div>
          )}

          {/* Key-Value Structured Metadata Grid */}
          {hasStructuredFields && (
            <div className="pt-2 border-t border-[#F5F5F4] dark:border-[#383330] grid grid-cols-2 gap-2">
              {amount !== undefined && amount !== null && (
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-[#57534E] dark:text-[#A8A29E]">Amount Due</span>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    {currencySymbol}{Number(amount).toLocaleString()}
                  </p>
                </div>
              )}
              {item.dueDate && (
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-[#57534E] dark:text-[#A8A29E]">Deadline</span>
                  <p className={`text-xs font-medium ${item.badgeVariant === "urgent" ? "text-rose-600 dark:text-rose-400" : "text-[#292524] dark:text-[#E7E5E4]"}`}>
                    {new Date(item.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              )}
              {policyNumber && (
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-[#57534E] dark:text-[#A8A29E]">Policy #</span>
                  <p className="text-xs font-medium text-[#292524] dark:text-[#E7E5E4] truncate">{policyNumber}</p>
                </div>
              )}
              {vin && (
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-[#57534E] dark:text-[#A8A29E]">VIN / Asset #</span>
                  <p className="text-xs font-medium text-[#292524] dark:text-[#E7E5E4] truncate">{vin}</p>
                </div>
              )}
              {location && (
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-[#57534E] dark:text-[#A8A29E]">Location</span>
                  <p className="text-xs font-medium text-[#292524] dark:text-[#E7E5E4] truncate">{location}</p>
                </div>
              )}
              {item.snoozedUntil && (
                <div>
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-[#57534E] dark:text-[#A8A29E]">Snoozed Until</span>
                  <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E] flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(item.snoozedUntil).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Footer Row: Tags, Family Sharing & Attachment */}
          <div className="pt-2 border-t border-[#F5F5F4] dark:border-[#383330] flex items-center justify-between gap-2 text-xs flex-wrap">
            <div className="flex flex-wrap gap-1.5 items-center">
              {tags.map((tag: string, idx: number) => (
                <span key={idx} className="px-2 py-0.5 rounded-md bg-[#F5F5F4] dark:bg-[#1C1917] text-stone-600 dark:text-stone-400 text-[11px] font-normal">
                  #{tag.replace(/^#/, '')}
                </span>
              ))}
              {tags.length === 0 && (
                <span className="px-2 py-0.5 rounded-md bg-[#F5F5F4] dark:bg-[#1C1917] text-stone-600 dark:text-stone-400 text-[11px] font-normal">
                  #{item.itemType}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isFamilyShared && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full">
                  <Users className="w-3 h-3" />
                  Family
                </span>
              )}
              {item.metadata?.fileUrl && (
                <a 
                  href={item.metadata.fileUrl} 
                  target="_blank" 
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[11px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-white underline-offset-2 hover:underline"
                >
                  <Paperclip className="w-3 h-3" />
                  <span>Attachment</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});


