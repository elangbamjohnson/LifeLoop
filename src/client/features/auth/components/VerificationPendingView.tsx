import React, { useState } from "react";

interface VerificationPendingViewProps {
  email: string;
  onBackToLogin: () => void;
  onChangeEmail: () => void;
}

export function VerificationPendingView({ email, onBackToLogin, onChangeEmail }: VerificationPendingViewProps) {
  const [resendStatus, setResendStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const maskEmail = (address: string) => {
    const parts = address.split("@");
    if (parts.length !== 2) return address;
    const [local, domain] = parts;
    if (local.length <= 1) return `*@${domain}`;
    return `${local[0]}***@${domain}`;
  };

  const handleResend = async () => {
    if (resendStatus === "loading" || resendStatus === "success") return;
    
    setResendStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch("/api/v1/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to resend");
      }

      setResendStatus("success");
      // Disable the resend action for a short cooldown
      setTimeout(() => setResendStatus("idle"), 60000); // 60s cooldown UX
    } catch (err: any) {
      setErrorMessage(err.message);
      setResendStatus("error");
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto text-center">
      <div className="mb-8">
        <div className="w-16 h-16 bg-[#F5F5F4] dark:bg-[#292524] rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-[#1C1917] dark:text-[#FDFBF7]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-2xl font-serif text-[#1C1917] dark:text-[#FDFBF7] mb-2">Check your email</h2>
        <p className="text-[#78716C] dark:text-[#A8A29E] mb-2">
          We sent a verification link to <br/>
          <span className="font-medium text-[#1C1917] dark:text-[#FDFBF7]">{maskEmail(email)}</span>
        </p>
      </div>

      {resendStatus === "success" && (
        <div className="p-4 mb-6 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl text-sm">
          Verification email sent. Check your inbox and spam folder.
        </div>
      )}

      {resendStatus === "error" && (
        <div className="p-4 mb-6 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm">
          {errorMessage}
        </div>
      )}

      <div className="space-y-3">
        <button
          onClick={handleResend}
          disabled={resendStatus === "loading" || resendStatus === "success"}
          className="w-full touch-target-48 py-3 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors disabled:opacity-50"
        >
          {resendStatus === "loading" ? "Sending..." : "Resend verification email"}
        </button>
        
        <button
          onClick={onChangeEmail}
          className="w-full touch-target-48 py-3 bg-white dark:bg-[#292524] text-[#1C1917] dark:text-[#FDFBF7] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl font-medium hover:bg-[#F5F5F4] dark:hover:bg-[#44403C] transition-colors"
        >
          Change email
        </button>
      </div>

      <div className="mt-8">
        <button
          onClick={onBackToLogin}
          className="touch-target-48 text-sm text-[#78716C] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#FDFBF7]"
        >
          Back to login
        </button>
      </div>
    </div>
  );
}
