import React, { useEffect, useState } from "react";
import { Bell, X, CheckCheck, Users, Share2, UserPlus } from "lucide-react";

interface FamilyNotification {
  id: string;
  familyId: string | null;
  type: string;
  payload: any;
  isRead: number;
  createdAt: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  invite_received: <UserPlus size={14} className="text-blue-500" />,
  member_joined: <Users size={14} className="text-emerald-500" />,
  item_shared: <Share2 size={14} className="text-purple-500" />,
  item_updated: <Bell size={14} className="text-amber-500" />,
};

const TYPE_LABELS: Record<string, (p: any) => string> = {
  invite_received: (p) => `You've been invited to join "${p.familyName || "a family"}"`,
  member_joined: (p) => `${p.email || "Someone"} joined the family`,
  item_shared: (p) => `"${p.itemTitle || "An item"}" was shared in category: ${p.category || ""}`,
  item_updated: (p) => `"${p.itemTitle || "A shared item"}" was updated`,
};

interface Props {
  onClose: () => void;
  onNotificationAction?: () => void;
}

export function FamilyNotifications({ onClose, onNotificationAction }: Props) {
  const [notifications, setNotifications] = useState<FamilyNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = () => {
    setLoading(true);
    fetch("/api/v1/families/notifications")
      .then((r) => r.json())
      .then((d) => setNotifications(d.notifications ?? []))
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleRead = async (id: string) => {
    await fetch(`/api/v1/families/notifications/${id}/read`, { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: 1 } : n));
    onNotificationAction?.();
  };

  const handleAcceptInvite = (token: string) => {
    window.location.href = `/accept-invite?token=${token}`;
  };

  return (
    <div className="absolute right-0 top-full mt-2 w-[360px] bg-white dark:bg-[#292524] rounded-2xl shadow-2xl border border-[#E7E5E4] dark:border-[#44403C] z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E7E5E4] dark:border-[#44403C]">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-[#78716C]" />
          <span className="font-semibold text-sm text-[#1C1917] dark:text-[#FDFBF7]">Family Notifications</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] transition-colors">
          <X size={16} className="text-[#78716C]" />
        </button>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 border-2 border-[#A8A29E] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-[#A8A29E] gap-2">
            <CheckCheck size={20} />
            <p className="text-sm">No notifications yet</p>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-4 py-3 border-b border-[#F5F5F4] dark:border-[#3C3C3C] last:border-0 transition-colors ${n.isRead ? "opacity-60" : "bg-blue-50/30 dark:bg-blue-900/10"}`}
            >
              <div className="mt-0.5 p-1.5 bg-[#F5F5F4] dark:bg-[#3C3C3C] rounded-lg shrink-0">
                {TYPE_ICONS[n.type] ?? <Bell size={14} className="text-[#A8A29E]" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#1C1917] dark:text-[#FDFBF7] leading-snug">
                  {(TYPE_LABELS[n.type] ?? (() => n.type))(n.payload)}
                </p>
                <p className="text-xs text-[#A8A29E] mt-0.5">
                  {new Date(n.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
                {n.type === "invite_received" && n.payload?.inviteToken && !n.isRead && (
                  <button
                    onClick={() => handleAcceptInvite(n.payload.inviteToken)}
                    className="mt-2 text-xs px-3 py-1.5 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-lg font-medium hover:bg-[#292524] transition-colors"
                  >
                    View Invite
                  </button>
                )}
              </div>
              {!n.isRead && (
                <button
                  onClick={() => handleRead(n.id)}
                  title="Mark as read"
                  className="shrink-0 p-1 rounded-lg hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] transition-colors"
                >
                  <CheckCheck size={14} className="text-[#A8A29E] hover:text-emerald-500 transition-colors" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
