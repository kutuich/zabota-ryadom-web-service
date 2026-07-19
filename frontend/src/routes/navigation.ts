import type { UserRole } from "../types";

export type NavItem = {
  label: string;
  path: string;
  end?: boolean;
  primary?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

const APP_CLIENT_PREFIX = "/app/client";
const APP_PERFORMER_PREFIX = "/app/performer";
const APP_ADMIN_PREFIX = "/app/admin";

export const clientNavigation: NavGroup[] = [
  {
    label: "Основные",
    items: [
      { label: "Заявки", path: `${APP_CLIENT_PREFIX}/requests`, primary: true, end: true },
      { label: "Создать заявку", path: `${APP_CLIENT_PREFIX}/requests/new`, primary: true },
      { label: "Чаты", path: `${APP_CLIENT_PREFIX}/chats`, primary: true },
      { label: "Мой баланс", path: `${APP_CLIENT_PREFIX}/balance`, primary: true }
    ]
  },
  {
    label: "Дополнительно",
    items: [
      { label: "Выполненные", path: `${APP_CLIENT_PREFIX}/requests/completed` },
      { label: "Мой профиль", path: `${APP_CLIENT_PREFIX}/profile` },
      { label: "Мои обращения", path: `${APP_CLIENT_PREFIX}/support` },
      { label: "Помощь", path: `${APP_CLIENT_PREFIX}/help` },
      { label: "Согласия и правила", path: `${APP_CLIENT_PREFIX}/consents` }
    ]
  }
];

export const performerNavigation: NavGroup[] = [
  {
    label: "Основные",
    items: [
      { label: "Заявки", path: `${APP_PERFORMER_PREFIX}/requests`, primary: true, end: true },
      { label: "Отклики", path: `${APP_PERFORMER_PREFIX}/responses`, primary: true },
      { label: "Чаты", path: `${APP_PERFORMER_PREFIX}/chats`, primary: true },
      { label: "Баланс", path: `${APP_PERFORMER_PREFIX}/balance`, primary: true }
    ]
  },
  {
    label: "Дополнительно",
    items: [
      { label: "Профиль", path: `${APP_PERFORMER_PREFIX}/profile` },
      { label: "Обращения", path: `${APP_PERFORMER_PREFIX}/support` },
      { label: "Помощь", path: `${APP_PERFORMER_PREFIX}/help` }
    ]
  }
];

export const adminNavigation: NavGroup[] = [
  { label: "Обзор", items: [{ label: "Главная", path: APP_ADMIN_PREFIX, end: true }] },
  {
    label: "Работа сервиса",
    items: [
      { label: "Заявки", path: `${APP_ADMIN_PREFIX}/requests` },
      { label: "Отклики", path: `${APP_ADMIN_PREFIX}/responses` },
      { label: "Чаты", path: `${APP_ADMIN_PREFIX}/chats` },
      { label: "Обращения", path: `${APP_ADMIN_PREFIX}/support` }
    ]
  },
  {
    label: "Пользователи",
    items: [
      { label: "Все пользователи", path: `${APP_ADMIN_PREFIX}/users` },
      { label: "Заказчики", path: `${APP_ADMIN_PREFIX}/clients` },
      { label: "Помощники", path: `${APP_ADMIN_PREFIX}/performers` },
      { label: "Блокировки", path: `${APP_ADMIN_PREFIX}/blocked` }
    ]
  },
  {
    label: "Финансы",
    items: [
      { label: "Балансы", path: `${APP_ADMIN_PREFIX}/balances` },
      { label: "Платежи", path: `${APP_ADMIN_PREFIX}/payments` },
      { label: "Начисления", path: `${APP_ADMIN_PREFIX}/bonuses` }
    ]
  },
  {
    label: "Справочники",
    items: [
      { label: "Города", path: `${APP_ADMIN_PREFIX}/cities` },
      { label: "Категории", path: `${APP_ADMIN_PREFIX}/categories` },
      { label: "База знаний", path: `${APP_ADMIN_PREFIX}/knowledge` }
    ]
  },
  {
    label: "Система",
    items: [
      { label: "Юридические документы", path: `${APP_ADMIN_PREFIX}/legal` },
      { label: "Архив", path: `${APP_ADMIN_PREFIX}/archive` },
      { label: "Настройки сервиса", path: `${APP_ADMIN_PREFIX}/settings` }
    ]
  }
];

export function defaultPathForRole(role: UserRole) {
  if (role === "client") return `${APP_CLIENT_PREFIX}/requests`;
  if (role === "performer") return `${APP_PERFORMER_PREFIX}/requests`;
  return APP_ADMIN_PREFIX;
}

export function roleForPath(pathname: string): UserRole | "admin_family" | null {
  if (pathname.startsWith(APP_CLIENT_PREFIX)) return "client";
  if (pathname.startsWith(APP_PERFORMER_PREFIX)) return "performer";
  if (pathname === APP_ADMIN_PREFIX || pathname.startsWith(`${APP_ADMIN_PREFIX}/`)) return "admin_family";
  return null;
}

export function canRoleOpenPath(role: UserRole, pathname: string) {
  const pathRole = roleForPath(pathname);
  if (!pathRole) return pathname === "/" || pathname === "/app";
  if (pathRole === "admin_family") return role === "admin" || role === "superadmin";
  return role === pathRole;
}

export function isKnownPathForRole(role: UserRole, pathname: string) {
  const groups = role === "client"
    ? clientNavigation
    : role === "performer"
      ? performerNavigation
      : adminNavigation;
  const items = groups.flatMap((group) => group.items);
  if (items.some((item) => item.path === pathname)) return true;
  return items.some((item) => item.path.endsWith("/chats") && pathname.startsWith(`${item.path}/`));
}

export function allAppPaths() {
  return [...clientNavigation, ...performerNavigation, ...adminNavigation].flatMap((group) =>
    group.items.map((item) => item.path)
  );
}

export function chatPathForRole(role: UserRole, chatId: string) {
  if (role === "client") return `${APP_CLIENT_PREFIX}/chats/${chatId}`;
  if (role === "performer") return `${APP_PERFORMER_PREFIX}/chats/${chatId}`;
  return `${APP_ADMIN_PREFIX}/chats/${chatId}`;
}

export function legacyAppRedirectPath(pathname: string) {
  if (pathname === "/admin") return APP_ADMIN_PREFIX;
  if (pathname.startsWith("/client/")) return `${APP_CLIENT_PREFIX}${pathname.slice("/client".length)}`;
  if (pathname === "/client") return APP_CLIENT_PREFIX;
  if (pathname.startsWith("/performer/")) return `${APP_PERFORMER_PREFIX}${pathname.slice("/performer".length)}`;
  if (pathname === "/performer") return APP_PERFORMER_PREFIX;
  if (pathname.startsWith("/admin/")) return `${APP_ADMIN_PREFIX}${pathname.slice("/admin".length)}`;
  return null;
}

export function sectionTitleForPath(pathname: string, groups: NavGroup[]) {
  const allItems = groups.flatMap((group) => group.items);
  const exact = allItems.find((item) => item.path === pathname);
  if (exact) return exact.label;
  const nested = [...allItems]
    .sort((left, right) => right.path.length - left.path.length)
    .find((item) => pathname.startsWith(`${item.path}/`));
  return nested?.label ?? allItems[0]?.label ?? "Раздел";
}
