import { Loader2 } from "lucide-react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { AdminDashboard } from "./pages/AdminDashboard";
import { ClientDashboard } from "./pages/ClientDashboard";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LandingAuthPage } from "./pages/LandingAuthPage";
import { LegalDocumentPage, LegalIndexPage } from "./pages/LegalPages";
import { MockPaymentPage, PaymentFailPage, PaymentPendingPage, PaymentSuccessPage } from "./pages/PaymentPages";
import { PerformerDashboard } from "./pages/PerformerDashboard";
import { PublicHelpPage } from "./pages/PublicHelpPage";
import { canRoleOpenPath, defaultPathForRole, isKnownPathForRole, legacyAppRedirectPath } from "./routes/navigation";
import type { UserRole } from "./types";

const legalDocumentRoutes = [
  "/legal/privacy",
  "/legal/personal-data-consent",
  "/legal/customer-agreement",
  "/legal/helper-terms",
  "/legal/service-notifications-consent",
  "/legal/marketing-notifications-consent",
  "/legal/helper-documents-consent",
  "/legal/service-rules"
];

export function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="center-screen">
        <Loader2 className="spin" size={28} />
        <span>Загрузка</span>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to={defaultPathForRole(user.role)} replace /> : <LandingAuthPage />} />
      <Route path="/app" element={user ? <Navigate to={defaultPathForRole(user.role)} replace /> : <LandingAuthPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/help" element={<PublicHelpPage />} />
      <Route path="/legal" element={<LegalIndexPage />} />
      {legalDocumentRoutes.map((path) => (
        <Route key={path} path={path} element={<LegalDocumentPage />} />
      ))}
      <Route path="/app/balance/mock-payment" element={<AuthGate><MockPaymentPage /></AuthGate>} />
      <Route path="/app/balance/payment-success" element={<AuthGate><PaymentSuccessPage /></AuthGate>} />
      <Route path="/app/balance/payment-fail" element={<AuthGate><PaymentFailPage /></AuthGate>} />
      <Route path="/app/balance/payment-pending" element={<AuthGate><PaymentPendingPage /></AuthGate>} />
      <Route path="/app/client/*" element={<RoleGate allowed={["client"]}><ClientDashboard /></RoleGate>} />
      <Route path="/app/performer/*" element={<RoleGate allowed={["performer"]}><PerformerDashboard /></RoleGate>} />
      <Route path="/app/admin/*" element={<RoleGate allowed={["admin", "superadmin"]}><AdminDashboard /></RoleGate>} />
      <Route path="/client" element={<LegacyAppRedirect />} />
      <Route path="/client/*" element={<LegacyAppRedirect />} />
      <Route path="/performer" element={<LegacyAppRedirect />} />
      <Route path="/performer/*" element={<LegacyAppRedirect />} />
      <Route path="/admin" element={<LegacyAppRedirect />} />
      <Route path="/admin/*" element={<LegacyAppRedirect />} />
      <Route path="*" element={<SafeFallback />} />
    </Routes>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/app" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function RoleGate({ allowed, children }: { allowed: UserRole[]; children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/app" replace state={{ from: location.pathname }} />;
  }
  if (!allowed.includes(user.role) || !canRoleOpenPath(user.role, location.pathname)) {
    return <Navigate to={defaultPathForRole(user.role)} replace />;
  }
  if (!isKnownPathForRole(user.role, location.pathname)) {
    return <Navigate to={defaultPathForRole(user.role)} replace />;
  }
  return children;
}

function LegacyAppRedirect() {
  const location = useLocation();
  const targetPath = legacyAppRedirectPath(location.pathname) ?? "/app";
  return <Navigate to={`${targetPath}${location.search}${location.hash}`} replace />;
}

function SafeFallback() {
  const { user } = useAuth();
  return <Navigate to={user ? defaultPathForRole(user.role) : "/app"} replace />;
}
