import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { NavGroup } from "../routes/navigation";
import { MobileBottomNavigation, RoleNavigation } from "./RoleNavigation";
import { PageHeader } from "./PageHeader";

export function AppLayout({
  title,
  navigation,
  variant,
  children
}: {
  title: string;
  navigation: NavGroup[];
  variant: "admin" | "user";
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate("/app", { replace: true });
  }

  return (
    <div className={variant === "admin" ? "app-shell app-shell--admin" : "app-shell app-shell--user"}>
      <PageHeader
        title={title}
        user={user}
        onLogout={handleLogout}
        showMenuButton
        onToggleMenu={() => setMenuOpen((current) => !current)}
      />
      {variant === "admin" ? (
        <RoleNavigation groups={navigation} variant="admin" isOpen={menuOpen} onNavigate={() => setMenuOpen(false)} />
      ) : (
        <>
          <RoleNavigation groups={navigation} variant="user" isOpen={menuOpen} onNavigate={() => setMenuOpen(false)} />
          <MobileBottomNavigation groups={navigation} onMoreClick={() => setMenuOpen((current) => !current)} />
        </>
      )}
      {menuOpen && <button className="nav-scrim" type="button" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}
      <main className="workspace">{children}</main>
    </div>
  );
}
