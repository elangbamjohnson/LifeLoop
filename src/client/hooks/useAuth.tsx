import React, { createContext, useContext, useEffect, useState } from "react";
import { User } from "../types";
import { disableBrowserPush, getBrowserPushSubscription, isPushRegistered } from "../lib/pushSubscription";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  setUser: (user: User | null) => void;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
  logoutError: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/v1/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLogoutError(null);
    try {
      await disableBrowserPush();
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Couldn't sign out. Please try again.");
      setUser(null);
    } catch (e) {
      console.error("Logout failed", e);
      setLogoutError(e instanceof Error ? e.message : "Couldn't sign out. Please try again.");
    }
  };

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const clearPreviousAccountSubscription = async () => {
      const subscription = await getBrowserPushSubscription();
      if (!subscription || cancelled) return;
      const registered = user ? await isPushRegistered(subscription, false) : false;
      if (!registered && !cancelled) await subscription.unsubscribe();
    };
    clearPreviousAccountSubscription().catch((error) => {
      if (!cancelled) setLogoutError("Couldn't check this device's notifications. Please check your connection.");
      console.error("Push subscription cleanup failed", error);
    });
    return () => { cancelled = true; };
  }, [loading, user?.id]);

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setUser, checkAuth, logout, logoutError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
