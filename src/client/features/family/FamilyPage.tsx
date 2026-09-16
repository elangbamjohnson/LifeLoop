import React, { useEffect, useState, useCallback } from "react";
import {
  Users, UserPlus, Share2, Trash2, Crown, Shield, Eye, User,
  ChevronDown, Plus, Bell, RefreshCw,
} from "lucide-react";
import { CreateFamilyModal } from "./CreateFamilyModal";
import { InviteMemberModal } from "./InviteMemberModal";
import { ShareItemModal } from "./ShareItemModal";
import { FamilyNotifications } from "./FamilyNotifications";

interface Family {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

interface FamilyMember {
  id: string;
  userId: string | null;
  invitedEmail: string;
  role: string;
  status: string;
  joinedAt: string | null;
}

interface SharedItem {
  id: string;
  category: string;
  canEdit: number;
  sharedByUserId: string;
  createdAt: string;
  item: {
    id: string;
    title: string;
    itemType: string;
    status: string;
    dueDate: string | null;
    userId: string;
  };
}

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  bills: { label: "Bills & Payments", icon: "💳" },
  school_events: { label: "School Events", icon: "🎒" },
  appointments: { label: "Appointments", icon: "📅" },
  shopping: { label: "Shopping", icon: "🛒" },
  documents: { label: "Documents", icon: "📄" },
  reminders: { label: "Household Reminders", icon: "🔔" },
  vehicle: { label: "Vehicle Information", icon: "🚗" },
};

const ROLE_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  owner: { icon: <Crown size={12} />, label: "Owner", color: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20" },
  admin: { icon: <Shield size={12} />, label: "Admin", color: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20" },
  member: { icon: <User size={12} />, label: "Member", color: "text-[#44403C] bg-[#F5F5F4] dark:text-[#D6D3D1] dark:bg-[#3C3C3C]" },
  view_only: { icon: <Eye size={12} />, label: "View-only", color: "text-[#78716C] bg-[#F5F5F4] dark:text-[#A8A29E] dark:bg-[#3C3C3C]" },
};

export function FamilyPage() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [sharedItems, setSharedItems] = useState<SharedItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [showCreateFamily, setShowCreateFamily] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const selectedFamily = families.find((f) => f.id === selectedFamilyId) ?? null;

  const fetchFamilies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/families");
      const data = await res.json();
      const list: Family[] = data.families ?? [];
      setFamilies(list);
      if (list.length > 0 && !selectedFamilyId) {
        setSelectedFamilyId(list[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedFamilyId]);

  const fetchFamilyDetails = useCallback(async (id: string) => {
    setLoadingDetails(true);
    try {
      const [detailRes, sharedRes] = await Promise.all([
        fetch(`/api/v1/families/${id}`),
        fetch(`/api/v1/families/${id}/shared`),
      ]);
      const detail = await detailRes.json();
      const sharedData = await sharedRes.json();
      setMembers(detail.members ?? []);
      setSharedItems(sharedData.sharedItems ?? []);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/families/notifications");
      const data = await res.json();
      const unread = (data.notifications ?? []).filter((n: any) => !n.isRead).length;
      setUnreadCount(unread);
    } catch {/* ignore */}
  }, []);

  useEffect(() => { fetchFamilies(); fetchUnreadCount(); }, []);
  useEffect(() => { if (selectedFamilyId) fetchFamilyDetails(selectedFamilyId); }, [selectedFamilyId]);

  const handleRemoveMember = async (memberId: string) => {
    if (!selectedFamilyId) return;
    if (!window.confirm("Remove this member from the family?")) return;
    await fetch(`/api/v1/families/${selectedFamilyId}/members/${memberId}`, { method: "DELETE" });
    fetchFamilyDetails(selectedFamilyId);
  };

  const handleUnshare = async (sharedItemId: string) => {
    if (!selectedFamilyId) return;
    await fetch(`/api/v1/families/${selectedFamilyId}/shared/${sharedItemId}`, { method: "DELETE" });
    fetchFamilyDetails(selectedFamilyId);
  };

  // Group shared items by category
  const groupedItems = sharedItems.reduce<Record<string, SharedItem[]>>((acc, item) => {
    const cat = item.category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#A8A29E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#FDFBF7] dark:bg-[#1C1917] border-b border-[#E7E5E4] dark:border-[#2C2927] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#E7E5E4] dark:bg-[#2C2927] rounded-xl">
              <Users size={20} className="text-[#44403C] dark:text-[#D6D3D1]" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#1C1917] dark:text-[#FDFBF7]">Family</h1>
              <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">Shared household information</p>
            </div>
          </div>

          <div className="flex items-center gap-2 relative">
            {/* Notification bell */}
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-xl hover:bg-[#F5F5F4] dark:hover:bg-[#2C2927] transition-colors"
            >
              <Bell size={18} className="text-[#44403C] dark:text-[#D6D3D1]" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setShowCreateFamily(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl text-sm font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors"
            >
              <Plus size={14} />
              New Family
            </button>

            {showNotifications && (
              <FamilyNotifications
                onClose={() => setShowNotifications(false)}
                onNotificationAction={fetchUnreadCount}
              />
            )}
          </div>
        </div>

        {/* Family Tabs */}
        {families.length > 0 && (
          <div className="flex gap-2 mt-4 overflow-x-auto pb-0.5">
            {families.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedFamilyId(f.id)}
                className={`px-4 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedFamilyId === f.id
                    ? "bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917]"
                    : "text-[#78716C] dark:text-[#A8A29E] hover:bg-[#F5F5F4] dark:hover:bg-[#2C2927]"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Empty State */}
      {families.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="text-6xl mb-4">👨‍👩‍👧‍👦</div>
          <h2 className="text-xl font-bold text-[#1C1917] dark:text-[#FDFBF7] mb-2">No family groups yet</h2>
          <p className="text-[#78716C] dark:text-[#A8A29E] max-w-sm mb-6">
            Create a family to share bills, appointments, school events, and household information with trusted members.
          </p>
          <button
            onClick={() => setShowCreateFamily(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] transition-colors"
          >
            <Plus size={16} />
            Create a Family
          </button>
        </div>
      )}

      {/* Family Detail */}
      {selectedFamily && (
        <div className="p-6 space-y-6 max-w-3xl mx-auto">

          {/* Members Section */}
          <div className="bg-white dark:bg-[#292524] rounded-2xl border border-[#E7E5E4] dark:border-[#44403C] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E7E5E4] dark:border-[#44403C]">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-[#78716C]" />
                <h2 className="font-semibold text-[#1C1917] dark:text-[#FDFBF7]">Members</h2>
                <span className="text-xs text-[#A8A29E] bg-[#F5F5F4] dark:bg-[#3C3C3C] px-2 py-0.5 rounded-full">
                  {members.filter(m => m.status === "accepted").length}
                </span>
              </div>
              <button
                onClick={() => setShowInvite(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#44403C] dark:text-[#D6D3D1] bg-[#F5F5F4] dark:bg-[#3C3C3C] rounded-xl hover:bg-[#E7E5E4] dark:hover:bg-[#4C4745] transition-colors font-medium"
              >
                <UserPlus size={14} />
                Invite
              </button>
            </div>

            <div className="divide-y divide-[#F5F5F4] dark:divide-[#3C3C3C]">
              {loadingDetails ? (
                [...Array(2)].map((_, i) => (
                  <div key={i} className="px-5 py-3 flex items-center gap-3">
                    <div className="w-9 h-9 bg-[#F5F5F4] dark:bg-[#3C3C3C] rounded-full animate-pulse" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-[#F5F5F4] dark:bg-[#3C3C3C] rounded w-40 animate-pulse" />
                      <div className="h-2.5 bg-[#F5F5F4] dark:bg-[#3C3C3C] rounded w-24 animate-pulse" />
                    </div>
                  </div>
                ))
              ) : (
                members.map((member) => {
                  const role = ROLE_META[member.role] ?? ROLE_META.member;
                  return (
                    <div key={member.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#D6D3D1] to-[#A8A29E] dark:from-[#44403C] dark:to-[#292524] flex items-center justify-center text-sm font-bold text-white shrink-0">
                        {member.invitedEmail[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#1C1917] dark:text-[#FDFBF7] truncate">{member.invitedEmail}</p>
                        {member.status === "pending" && (
                          <p className="text-xs text-amber-500">Invite pending</p>
                        )}
                      </div>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${role.color}`}>
                        {role.icon}
                        {role.label}
                      </span>
                      {member.role !== "owner" && (
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-1.5 rounded-lg text-[#A8A29E] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Shared Items Section */}
          <div className="bg-white dark:bg-[#292524] rounded-2xl border border-[#E7E5E4] dark:border-[#44403C] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E7E5E4] dark:border-[#44403C]">
              <div className="flex items-center gap-2">
                <Share2 size={16} className="text-[#78716C]" />
                <h2 className="font-semibold text-[#1C1917] dark:text-[#FDFBF7]">Shared Items</h2>
                <span className="text-xs text-[#A8A29E] bg-[#F5F5F4] dark:bg-[#3C3C3C] px-2 py-0.5 rounded-full">
                  {sharedItems.length}
                </span>
              </div>
              <button
                onClick={() => setShowShare(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#44403C] dark:text-[#D6D3D1] bg-[#F5F5F4] dark:bg-[#3C3C3C] rounded-xl hover:bg-[#E7E5E4] dark:hover:bg-[#4C4745] transition-colors font-medium"
              >
                <Share2 size={14} />
                Share Item
              </button>
            </div>

            {loadingDetails ? (
              <div className="p-5 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-14 bg-[#F5F5F4] dark:bg-[#3C3C3C] rounded-xl animate-pulse" />
                ))}
              </div>
            ) : sharedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-[#A8A29E]">
                <Share2 size={32} className="mb-3 opacity-40" />
                <p className="text-sm font-medium">No shared items yet</p>
                <p className="text-xs mt-1 max-w-xs">Share bills, appointments, or any household info with your family</p>
              </div>
            ) : (
              <div className="divide-y divide-[#F5F5F4] dark:divide-[#3C3C3C]">
                {(Object.entries(groupedItems) as [string, SharedItem[]][]).map(([cat, catItems]) => {
                  const meta = CATEGORY_META[cat] ?? { label: cat, icon: "📦" };
                  return (
                    <div key={cat}>
                      <div className="flex items-center gap-2 px-5 py-2 bg-[#FAFAF9] dark:bg-[#222120]">
                        <span>{meta.icon}</span>
                        <span className="text-xs font-semibold text-[#78716C] dark:text-[#A8A29E] uppercase tracking-wider">{meta.label}</span>
                        <span className="text-xs text-[#A8A29E]">({catItems.length})</span>
                      </div>
                      {catItems.map((si) => (
                        <div key={si.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#FAFAF9] dark:hover:bg-[#222120] transition-colors group">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[#1C1917] dark:text-[#FDFBF7] truncate">{si.item.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-[#A8A29E]">{si.item.itemType}</span>
                              {si.canEdit === 1 && (
                                <span className="text-xs text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded-full">editable</span>
                              )}
                              {si.item.status === "completed" && (
                                <span className="text-xs text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full">done</span>
                              )}
                              {si.item.dueDate && (
                                <span className="text-xs text-[#A8A29E]">
                                  Due {new Date(si.item.dueDate).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleUnshare(si.id)}
                            className="p-1.5 rounded-lg text-[#A8A29E] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreateFamily && (
        <CreateFamilyModal
          onClose={() => setShowCreateFamily(false)}
          onCreated={(family) => {
            setShowCreateFamily(false);
            fetchFamilies();
            setSelectedFamilyId(family.id);
          }}
        />
      )}
      {showInvite && selectedFamilyId && (
        <InviteMemberModal
          familyId={selectedFamilyId}
          onClose={() => setShowInvite(false)}
          onInvited={() => fetchFamilyDetails(selectedFamilyId!)}
        />
      )}
      {showShare && selectedFamilyId && (
        <ShareItemModal
          familyId={selectedFamilyId}
          onClose={() => setShowShare(false)}
          onShared={() => fetchFamilyDetails(selectedFamilyId!)}
        />
      )}
    </div>
  );
}
