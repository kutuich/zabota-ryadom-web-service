import { NavLink } from "react-router-dom";
import type { NavGroup } from "../routes/navigation";

export function RoleNavigation({
  groups,
  variant,
  isOpen = false,
  onNavigate
}: {
  groups: NavGroup[];
  variant: "admin" | "user";
  isOpen?: boolean;
  onNavigate?: () => void;
}) {
  const className = [
    variant === "admin" ? "role-nav role-nav--admin" : "role-nav role-nav--user",
    isOpen ? "role-nav--open" : ""
  ].filter(Boolean).join(" ");

  return (
    <nav className={className} aria-label="Разделы">
      {groups.map((group) => (
        <section
          className={group.label === "Дополнительно" ? "role-nav__group role-nav__group--more" : "role-nav__group"}
          key={group.label}
        >
          <p>{group.label}</p>
          {group.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) => isActive ? "role-nav__link role-nav__link--active" : "role-nav__link"}
              onClick={onNavigate}
            >
              {item.label}
            </NavLink>
          ))}
        </section>
      ))}
    </nav>
  );
}

export function MobileBottomNavigation({
  groups,
  onMoreClick
}: {
  groups: NavGroup[];
  onMoreClick: () => void;
}) {
  const primary = groups.flatMap((group) => group.items).filter((item) => item.primary).slice(0, 4);
  return (
    <nav className="bottom-nav" aria-label="Основные разделы">
      {primary.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.end}
          className={({ isActive }) => isActive ? "bottom-nav__item bottom-nav__item--active" : "bottom-nav__item"}
        >
          <span aria-hidden="true">•</span>
          {item.label}
        </NavLink>
      ))}
      <button className="bottom-nav__item" type="button" onClick={onMoreClick}>
        <span aria-hidden="true">•</span>
        Ещё
      </button>
    </nav>
  );
}
