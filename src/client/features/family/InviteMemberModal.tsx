import React, { useState } from "react";
import { X, UserPlus, Copy, CheckCheck } from "lucide-react";

interface Props {
  familyId: string;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteMemberModal({ familyId, onClose, onInvited }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/families/${familyId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send invite");
      const link = `${window.location.origin}/accept-invite?token=${data.inviteToken}`;
      setInviteLink(link);
      onInvited();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-[#292524] rounded-2xl shadow-2xl border border-[#E7E5E4] dark:border-[#44403C]">
        <div className="flex items-center justify-between p-5 border-b border-[#E7E5E4] dark:border-[#44403C]">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-[#78716C] dark:text-[#A8A29E]" />
            <h2 className="font-semibold text-[#1C1917] dark:text-[#FDFBF7]">Invite a Member</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] transition-colors">
            <X size={18} className="text-[#78716C]" />
          </button>
        </div>

        <div className="p-5">
          {!inviteLink ? (
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="family@example.com"
                  required
                  autoFocus
                  className="w-full px-4 py-2.5 bg-[#F5F5F4] dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A8A29E] transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-4 py-2.5 bg-[#F5F5F4] dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A8A29E] transition-all"
                >
                  <option value="admin">Admin – can invite & manage</option>
                  <option value="member">Member – can view & share items</option>
                  <option value="view_only">View-only – read only access</option>
                </select>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors disabled:opacity-50"
              >
                {loading ? "Sending…" : "Generate Invite Link"}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                <CheckCheck size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">Invite created successfully!</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">Share this link with {email}</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inviteLink}
                    className="flex-1 px-3 py-2 text-xs bg-[#F5F5F4] dark:bg-[#1C1917] border border-[#E7E5E4] dark:border-[#44403C] text-[#78716C] dark:text-[#A8A29E] rounded-xl truncate"
                  />
                  <button
                    onClick={handleCopy}
                    className="px-3 py-2 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl hover:bg-[#292524] transition-colors shrink-0"
                  >
                    {copied ? <CheckCheck size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="text-xs text-[#A8A29E] mt-2">Link expires in 7 days. The invited person must be logged in to accept.</p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] text-[#44403C] dark:text-[#D6D3D1] hover:bg-[#F5F5F4] dark:hover:bg-[#3C3C3C] transition-colors font-medium"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
