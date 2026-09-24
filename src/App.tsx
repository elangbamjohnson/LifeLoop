/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./client/hooks/useAuth";
import { ThemeProvider } from "./client/hooks/useTheme";
import { AuthScreen } from "./client/features/auth/AuthScreen";
import { VerifyEmailScreen } from "./client/features/auth/VerifyEmailScreen";
import { Dashboard } from "./client/features/dashboard/Dashboard";

import { AcceptInvitePage } from "./client/features/family/AcceptInvitePage";

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#1C1917] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#A8A29E] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <Dashboard /> : <Navigate to="/auth" replace />}
      />
      <Route
        path="/auth"
        element={!user ? <AuthScreen /> : <Navigate to="/" replace />}
      />
      <Route
        path="/accept-invite"
        element={user ? <AcceptInvitePage /> : <Navigate to="/auth" replace />}
      />
      <Route
        path="/verify-email"
        element={<VerifyEmailScreen />}
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <AppRoutes />
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}
