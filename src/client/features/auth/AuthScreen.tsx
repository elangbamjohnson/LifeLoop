import React, { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { VerificationPendingView } from "./components/VerificationPendingView";
import { ChangeEmailView } from "./components/ChangeEmailView";

export function AuthScreen() {
  const { checkAuth } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isLogin, setIsLogin] = useState(true);
  const [view, setView] = useState<"form" | "pending" | "change-email">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  
  // Track the email that requires verification
  const [pendingEmail, setPendingEmail] = useState("");

  // Check auth initially and if user is pending, kick to pending view
  React.useEffect(() => {
    fetch("/api/v1/auth/me").then(res => {
      if (res.ok) {
        res.json().then(data => {
          if (data.user?.accountStatus === 'pending_verification') {
            setPendingEmail(data.user.email);
            setView("pending");
          }
        });
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/api/v1/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        if (isLogin && data.error === "Please verify your email address to log in") {
          setPendingEmail(email);
          setView("pending");
          return;
        }
        throw new Error(data.error || "Authentication failed");
      }

      if (!isLogin && res.status === 201) {
        // Registration success, switch to pending
        setPendingEmail(email);
        setView("pending");
        return;
      }

      await checkAuth();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#1C1917] flex items-center justify-center p-4 transition-colors duration-200 relative">
      <div className="absolute top-4 right-4">
        <button
          id="auth-theme-toggle-btn"
          type="button"
          onClick={toggleTheme}
          className="touch-target-48 min-w-[48px] min-h-[48px] flex items-center justify-center p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#78716C] dark:text-[#A8A29E]"
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          aria-label={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {theme === "dark" ? (
            <Sun className="w-5 h-5 text-amber-400" />
          ) : (
            <Moon className="w-5 h-5 text-[#78716C]" />
          )}
        </button>
      </div>

      {view === "form" && (
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <h1 className="text-3xl font-serif text-[#1C1917] dark:text-[#FDFBF7] mb-2">LifeLoop</h1>
            <p className="text-[#78716C] dark:text-[#A8A29E]">Never forget what matters.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A8A29E] transition-all"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#44403C] dark:text-[#D6D3D1] mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] text-[#1C1917] dark:text-[#FDFBF7] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#A8A29E] transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#1C1917] dark:bg-[#FDFBF7] text-white dark:text-[#1C1917] rounded-xl font-medium hover:bg-[#292524] dark:hover:bg-[#E7E5E4] transition-colors disabled:opacity-50"
            >
              {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-[#78716C] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#FDFBF7]"
            >
              {isLogin ? "Need an account? Register" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      )}

      {view === "pending" && (
        <VerificationPendingView
          email={pendingEmail}
          onBackToLogin={() => setView("form")}
          onChangeEmail={() => setView("change-email")}
        />
      )}

      {view === "change-email" && (
        <ChangeEmailView
          currentEmail={pendingEmail}
          onSuccess={(newEmail) => {
            setPendingEmail(newEmail);
            setView("pending");
          }}
          onCancel={() => setView("pending")}
        />
      )}
    </div>
  );
}
