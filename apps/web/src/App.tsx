import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CreateGroupPage from "./pages/CreateGroupPage";
import GroupDetailPage from "./pages/GroupDetailPage";
import PaymentPage from "./pages/PaymentPage";
import HistoryPage from "./pages/HistoryPage";
import VerifyPage from "./pages/VerifyPage";
import OperatorPage from "./pages/admin/OperatorPage";
import { AuthProvider } from "./context/AuthProvider";
import { useAuth } from "./context/useAuth";
import type { ReactNode } from "react";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-cream">
        <p className="text-sm font-semibold text-stone-500">Memuat...</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-cream">
        <p className="text-sm font-semibold text-stone-500">Memuat...</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }
  if (user.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-cream">
        <p className="text-sm font-semibold text-stone-500">Memuat...</p>
      </div>
    );
  }
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }
  return <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Flow 1: Logged out shows LoginPage, Logged in redirects to dashboard */}
          <Route path="/" element={<RootRoute />} />
          <Route path="/login" element={<RootRoute />} />

          {/* Flow 3: Public portal lives at its own address, accessible without login */}
          <Route path="/verifikasi" element={<VerifyPage />} />
          <Route path="/verifikasi/:id" element={<VerifyPage />} />

          {/* Flow 2: Protected dashboard & app routes */}
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/groups/new" element={<CreateGroupPage />} />
            <Route path="/groups/:id" element={<GroupDetailPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/operator" element={<RequireAdmin><OperatorPage /></RequireAdmin>} />
          </Route>

          <Route
            path="/groups/:id/pay"
            element={
              <RequireAuth>
                <PaymentPage />
              </RequireAuth>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
