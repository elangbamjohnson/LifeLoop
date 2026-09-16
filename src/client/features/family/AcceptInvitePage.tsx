import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, XCircle, Loader } from "lucide-react";

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error" | "idle">("idle");
  const [message, setMessage] = useState("");

  const handleAccept = async () => {
    if (!token) return;
    setStatus("loading");
    try {
      const res = await fetch(`/api/v1/families/invitations/${token}/accept`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept invite");
      setStatus("success");
      setMessage("You have successfully joined the family!");
      setTimeout(() => navigate("/"), 2000);
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message);
    }
  };

  const handleReject = async () => {
    if (!token) return;
    setStatus("loading");
    try {
      const res = await fetch(`/api/v1/families/invitations/${token}/reject`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to reject invite");
      setStatus("error");
      setMessage("Invite rejected.");
      setTimeout(() => navigate("/"), 2000);
    } catch (err: any) {
      setStatus("error");
      setMessage(err.message);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#1C1917] flex items-center justify-center p-4">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[#1C1917] dark:text-[#FDFBF7]">Invalid Invite Link</h2>
          <p className="text-[#78716C] dark:text-[#A8A29E] mt-2">This invite link is missing or malformed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#1C1917] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white dark:bg-[#292524] rounded-2xl shadow-xl p-8 text-center border border-[#E7E5E4] dark:border-[#44403C]">
        {status === "loading" && (
          <Loader className="w-10 h-10 text-[#A8A29E] animate-spin mx-auto mb-4" />
        )}
        {status === "success" && (
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
        )}
        {status === "error" && (
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        )}
        {status === "idle" && (
          <div className="w-12 h-12 bg-[#E7E5E4] dark:bg-[#44403C] rounded-full mx-auto mb-4 flex items-center justify-center text-2xl">
            👨‍👩‍👧‍👦
          </div>
        )}

        <h1 className="text-2xl font-bold text-[#1C1917] dark:text-[#FDFBF7] mb-2">
          {status === "success" ? "Welcome to the family!" : status === "error" ? "Oops" : "Family Invitation"}
        </h1>

        {message ? (
          <p className="text-[#78716C] dark:text-[#A8A29E] mb-6">{message}</p>
        ) : (
          <p className="text-[#78716C] dark:text-[#A8A29E] mb-6">
            You've been invited to join a family on LifeLoop. Accept to see and manage shared household information.
          </p>
        )}

        {status === "idle" && (
          <div className="flex gap-3">
            <button
              onClick={handleReject}
              className="flex-1 py-2.5 rounded-xl border border-[#E7E5E4] dark:border-[#44403C] text-[#78716C] dark:text-[#A8A29E] hover:bg-[#F5F5F4] dark:hover:bg-[#44403C] transition-colors font-medium"
            >
              Decline
            </button>
            <button
              onClick={handleAccept}
              className="flex-1 py-2.5 rounded-xl bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors font-medium"
            >
              Accept
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
