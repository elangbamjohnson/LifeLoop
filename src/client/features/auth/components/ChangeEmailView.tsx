import React, { useState } from "react";

interface ChangeEmailViewProps {
  currentEmail: string;
  onSuccess: (newEmail: string) => void;
  onCancel: () => void;
}

export function ChangeEmailView({ currentEmail, onSuccess, onCancel }: ChangeEmailViewProps) {
  const [newEmail, setNewEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentEmail, newEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to change email");
      }

      onSuccess(newEmail);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-serif text-[#1C1917] dark:text-[#FDFBF7] mb-2">Change Email</h2>
        <p className="text-[#78716C] dark:text-[#A8A29E] text-sm">
          Enter a new email address to receive a verification link.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">New Email</label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="w-full px-4 py-2 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A8A29E] transition-all"
            placeholder="new@example.com"
            required
          />
        </div>

        {error && (
          <p className="text-red-500 text-sm text-center bg-red-50 dark:bg-red-900/20 p-2 rounded-lg">
            {error}
          </p>
        )}

        <div className="pt-2 space-y-3">
          <button
            type="submit"
            disabled={loading || !newEmail}
            className="w-full touch-target-48 py-3 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors disabled:opacity-50"
          >
            {loading ? "Please wait..." : "Update email"}
          </button>
          
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="w-full touch-target-48 py-3 bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl font-medium hover:bg-[#F5F5F4] dark:hover:bg-[#44403C] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
