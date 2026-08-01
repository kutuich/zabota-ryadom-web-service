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
import { VisualAuditShowcasePage } from "./pages/VisualAuditShowcasePage";
import { OAuthCompletePage } from "./pages/OAuthCompletePage";
import { ManagerDashboard } from "./pages/ManagerDashboard";
import { canRoleOpenPath, defaultPathForRole, isKnownPathForRole, legacyAdminSectionRedirectPath, legacyAppRedirectPath } from "./routes/navigation";
import { TEMPORARY_PASSWORD_PATH, temporaryPasswordRedirectPath } from "./routes/security";
import type { UserRole } from "./types";
import { effectiveRoleForUser } from "./utils/authRole";
import { TemporaryPasswordPage } from "./pages/TemporaryPasswordPage";

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

export const visualAuditRoutesEnabled = import.meta.env.VITE_ENABLE_VISUAL_AUDIT_ROUTES === "true";

export function isVisualAuditPath(pathname: string) {
  return /^\/app\/audit\/(?:client|performer|admin)\/?$/.test(pathname);
}

export function VisualAuditRoutes() {
  return (
    <Routes>
      <Route path="/app/audit/client" element={<VisualAuditShowcasePage role="client" />} />
      <Route path="/app/audit/performer" element={<VisualAuditShowcasePage role="performer" />} />
      <Route path="/app/audit/admin" element={<VisualAuditShowcasePage role="admin" />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

export function App() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const effectiveRole = effectiveRoleForUser(user);
  const temporaryPasswordRedirect = temporaryPasswordRedirectPath(user, location.pathname);

  if (isLoading) {
    return (
      <div className="center-screen">
        <Loader2 className="spin" size={28} />
        <span>Загрузка</span>
      </div>
    );
  }

  if (temporaryPasswordRedirect) {
    return <Navigate to={temporaryPasswordRedirect} replace />;
  }

  return (
    <Routes>
      <Route path="/" element={user && effectiveRole ? <Navigate to={defaultPathForRole(effectiveRole)} replace /> : <LandingAuthPage />} />
      <Route path="/app" element={user && effectiveRole ? <Navigate to={defaultPathForRole(effectiveRole)} replace /> : <LandingAuthPage />} />
      <Route path="/app/login" element={user && effectiveRole ? <Navigate to={defaultPathForRole(effectiveRole)} replace /> : <LandingAuthPage />} />
      <Route path="/app/oauth/complete" element={<OAuthCompletePage />} />
      <Route path={TEMPORARY_PASSWORD_PATH} element={<TemporaryPasswordPage />} />
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
      <Route path="/app/admin/bonuses" element={<LegacyAdminSectionRedirect />} />
      <Route path="/app/admin/bonuses/*" element={<LegacyAdminSectionRedirect />} />
      <Route path="/app/admin/*" element={<RoleGate allowed={["superadmin"]}><AdminDashboard /></RoleGate>} />
      <Route path="/app/manager/*" element={<RoleGate allowed={["manager"]}><ManagerDashboard /></RoleGate>} />
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
  if (user.mustChangePassword && location.pathname !== TEMPORARY_PASSWORD_PATH) {
    return <Navigate to={TEMPORARY_PASSWORD_PATH} replace />;
  }
  return children;
}

function RoleGate({ allowed, children }: { allowed: UserRole[]; children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/app" replace state={{ from: location.pathname }} />;
  }
  const effectiveRole = effectiveRoleForUser(user)!;
  if (!allowed.includes(effectiveRole) || !canRoleOpenPath(effectiveRole, location.pathname)) {
    return <Navigate to={defaultPathForRole(effectiveRole)} replace />;
  }
  if (!isKnownPathForRole(effectiveRole, location.pathname)) {
    return <Navigate to={defaultPathForRole(effectiveRole)} replace />;
  }
  return children;
}

function LegacyAppRedirect() {
  const location = useLocation();
  const targetPath = legacyAppRedirectPath(location.pathname) ?? "/app";
  return <Navigate to={`${targetPath}${location.search}${location.hash}`} replace />;
}

function LegacyAdminSectionRedirect() {
  const { user } = useAuth();
  const location = useLocation();
  const effectiveRole = effectiveRoleForUser(user);

  if (!user || !effectiveRole) return <Navigate to="/app" replace />;
  if (effectiveRole !== "superadmin") {
    return <Navigate to={defaultPathForRole(effectiveRole)} replace />;
  }

  const targetPath = legacyAdminSectionRedirectPath(location.pathname) ?? "/app/admin/balances";
  return <Navigate to={`${targetPath}${location.search}${location.hash}`} replace />;
}

function SafeFallback() {
  const { user } = useAuth();
  const effectiveRole = effectiveRoleForUser(user);
  return <Navigate to={user && effectiveRole ? defaultPathForRole(effectiveRole) : "/app"} replace />;
}
