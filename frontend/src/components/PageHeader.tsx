import { LogOut, Menu, Shield, UserRound } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { User } from "../types";

export function PageHeader({
  title,
  user,
  onLogout,
  onToggleMenu,
  showMenuButton = false
}: {
  title: string;
  user: User | null;
  onLogout: () => void;
  onToggleMenu?: () => void;
  showMenuButton?: boolean;
}) {
  return (
    <header className="topbar">
      <div className="topbar__title">
        {showMenuButton && (
          <button className="icon-button topbar__menu" type="button" onClick={onToggleMenu} aria-label="Открыть разделы">
            <Menu size={18} />
          </button>
        )}
        <div>
          <p className="eyebrow">Забота Рядом</p>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="topbar__user">
        <span className="user-pill">
          {user?.role === "admin" || user?.role === "superadmin" ? <Shield size={16} /> : <UserRound size={16} />}
          {user?.displayName}
        </span>
        <StatusBadge tone="info">{user?.city?.name ?? "город не выбран"}</StatusBadge>
        <button className="icon-button" type="button" onClick={onLogout} title="Выйти" aria-label="Выйти">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
