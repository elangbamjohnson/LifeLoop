import React, { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

export function VerifyEmailScreen() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();
  
  const [status, setStatus] = useState<"loading" | "success" | "error" | "expired">("loading");
  const [message, setMessage] = useState("Verifying your email...");
  const verifyAttempted = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid or missing token.");
      return;
    }

    if (verifyAttempted.current) return;
    verifyAttempted.current = true;

    const verifyEmail = async () => {
      try {
        const res = await fetch(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (res.ok && data.success) {
          setStatus("success");
          setMessage("Email verified — Your LifeLoop account is now active");
        } else {
          // Identify expired specifically if we can, else generic error
          if (data.error && data.error.includes("expired")) {
            setStatus("expired");
            setMessage("Your verification link has expired.");
          } else {
            setStatus("error");
            setMessage(data.error || "We couldn't verify your email right now. Please try again.");
          }
        }
      } catch (err) {
        setStatus("error");
        setMessage("We couldn't verify your email right now. Please try again.");
      }
    };

    verifyEmail();
  }, [token]);

  return (
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#1C1917] flex items-center justify-center p-4 transition-colors duration-200">
      <div className="w-full max-w-sm text-center">
        
        {status === "loading" && (
          <div className="mb-8">
            <div className="w-16 h-16 border-4 border-[#A8A29E] border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
            <h2 className="text-2xl font-serif text-[#1C1917] dark:text-[#FDFBF7] mb-2">Verifying...</h2>
            <p className="text-[#78716C] dark:text-[#A8A29E]">{message}</p>
          </div>
        )}

        {status === "success" && (
          <div className="mb-8">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6 text-green-600 dark:text-green-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-serif text-[#1C1917] dark:text-[#FDFBF7] mb-2">Email Verified</h2>
            <p className="text-[#78716C] dark:text-[#A8A29E] mb-8">{message}</p>
            <button
              onClick={() => {
                // Navigate to root which triggers AuthProvider check and routes to Dashboard or login
                window.location.href = "/";
              }}
              className="w-full touch-target-48 py-3 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors"
            >
              Continue to LifeLoop
            </button>
          </div>
        )}

        {(status === "error" || status === "expired") && (
          <div className="mb-8">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6 text-red-600 dark:text-red-400">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-serif text-[#1C1917] dark:text-[#FDFBF7] mb-2">Verification Failed</h2>
            <p className="text-[#78716C] dark:text-[#A8A29E] mb-8">{message}</p>
            
            <button
              onClick={() => navigate("/auth")}
              className="w-full touch-target-48 py-3 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors mb-3"
            >
              {status === "expired" ? "Send a new verification email" : "Back to login"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
