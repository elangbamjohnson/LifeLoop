import React, { useState, useEffect, useRef } from "react";
import { Sun, Moon } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { VerificationPendingView } from "./components/VerificationPendingView";
import { ChangeEmailView } from "./components/ChangeEmailView";

declare global {
  interface Window {
    google?: any;
  }
}

export function AuthScreen() {
  const { checkAuth } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [isLogin, setIsLogin] = useState(true);
  const [view, setView] = useState<"form" | "pending" | "change-email">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [gsiLoaded, setGsiLoaded] = useState(false);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);
  
  // Track the email that requires verification
  const [pendingEmail, setPendingEmail] = useState("");

  // Check auth initially and if user is pending, kick to pending view
  useEffect(() => {
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

  // Fetch public auth configuration (Google Client ID) & load GSI SDK
  useEffect(() => {
    let isMounted = true;
    fetch("/api/v1/auth/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted || !data?.googleClientId) return;
        setGoogleClientId(data.googleClientId);

        if (window.google?.accounts?.id) {
          setGsiLoaded(true);
          return;
        }

        const existingScript = document.getElementById("google-gsi-client");
        if (!existingScript) {
          const script = document.createElement("script");
          script.id = "google-gsi-client";
          script.src = "https://accounts.google.com/gsi/client";
          script.async = true;
          script.defer = true;
          script.onload = () => {
            if (isMounted) setGsiLoaded(true);
          };
          document.head.appendChild(script);
        } else {
          existingScript.addEventListener("load", () => {
            if (isMounted) setGsiLoaded(true);
          });
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  const handleGoogleCredentialResponse = async (response: { credential: string }) => {
    try {
      setGoogleLoading(true);
      setError("");
      const res = await fetch("/api/v1/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: response.credential,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Google authentication failed");
      }

      await checkAuth();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  // Render Google Identity Services button when ready
  useEffect(() => {
    if (!gsiLoaded || !googleClientId || view !== "form" || !window.google?.accounts?.id) {
      return;
    }

    try {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredentialResponse,
      });

      if (googleBtnContainerRef.current) {
        googleBtnContainerRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(googleBtnContainerRef.current, {
          theme: theme === "dark" ? "filled_black" : "outline",
          size: "large",
          type: "standard",
          shape: "rectangular",
          text: isLogin ? "signin_with" : "signup_with",
          logo_alignment: "left",
          width: 320,
        });
      }
    } catch (err) {
      console.warn("Failed to initialize Google Sign-In button:", err);
    }
  }, [gsiLoaded, googleClientId, theme, isLogin, view]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/api/v1/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email, 
          password,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }),
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
          <div className="text-center mb-8">
            <h1 className="text-3xl font-serif text-[#1C1917] dark:text-[#FDFBF7] mb-2">LifeLoop</h1>
            <p className="text-[#78716C] dark:text-[#A8A29E]">Never forget what matters.</p>
          </div>

          {/* Continue with Google */}
          <div className="space-y-4">
            {googleClientId && gsiLoaded ? (
              <div
                id="google-signin-btn-container"
                ref={googleBtnContainerRef}
                className="w-full flex justify-center min-h-[44px]"
              />
            ) : (
              <button
                id="google-signin-fallback-btn"
                type="button"
                onClick={() => {
                  if (!googleClientId) {
                    setError("Google Sign-In is not configured yet (GOOGLE_CLIENT_ID missing in environment)");
                  } else if (window.google?.accounts?.id) {
                    window.google.accounts.id.prompt();
                  }
                }}
                disabled={googleLoading}
                className="w-full py-2.5 px-4 bg-white dark:bg-[#292524] border border-[#E7E5E4] dark:border-[#44403C] rounded-xl flex items-center justify-center gap-3 text-sm font-medium text-[#1C1917] dark:text-[#FDFBF7] hover:bg-stone-50 dark:hover:bg-[#322e2b] transition-colors shadow-sm disabled:opacity-50"
              >
                <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>{googleLoading ? "Connecting..." : "Continue with Google"}</span>
              </button>
            )}

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#E7E5E4] dark:border-[#44403C]" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-[#FDFBF7] dark:bg-[#1C1917] px-3 text-[#57534E] dark:text-[#A8A29E] font-medium tracking-wider">
                  or continue with email
                </span>
              </div>
            </div>
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
              id="auth-submit-btn"
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
