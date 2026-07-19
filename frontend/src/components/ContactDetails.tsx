import type { User } from "../types";

export function ContactDetails({ user }: { user: User | null | undefined }) {
  const phoneVerified = Boolean(user?.phoneVerifiedAt || user?.isPhoneVerified);
  const emailVerified = Boolean(user?.emailVerifiedAt || user?.isEmailVerified);

  return (
    <section className="plain-section span-2">
      <h2>Контактные данные</h2>
      <div className="detail-grid detail-grid--compact">
        <span>Телефон</span>
        <strong>{user?.phone ?? "Не указан"}</strong>
        <span>Статус телефона</span>
        <strong>{phoneVerified ? "Подтверждён" : "Не подтверждён"}</strong>
        <span>Email</span>
        <strong>{user?.email || "Не указан"}</strong>
        <span>Статус email</span>
        <strong>{emailVerified ? "Подтверждён" : "Не подтверждён"}</strong>
      </div>
      <p className="privacy-note">Подтверждение телефона и email будет добавлено позже.</p>
    </section>
  );
}
