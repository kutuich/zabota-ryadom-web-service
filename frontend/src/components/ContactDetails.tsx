import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { User } from "../types";

export function ContactDetails({ user }: { user: User | null | undefined }) {
  const { bootstrap } = useAuth();
  const [linkError, setLinkError] = useState("");
  const phoneVerified = Boolean(user?.phoneVerifiedAt || user?.isPhoneVerified);
  const emailVerified = Boolean(user?.emailVerifiedAt || user?.isEmailVerified);
  const vkIdentity = user?.identities?.find((identity) => identity.provider === "vk");
  const phone = user?.phone?.trim() || "Не указан";
  const email = user?.email?.trim() || "Не указан";

  async function linkVk() {
    setLinkError("");
    try {
      const { authorizationUrl } = await api.startVkLink();
      window.location.href = authorizationUrl;
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "Не удалось начать привязку VK ID");
    }
  }

  return (
    <section className="plain-section span-2">
      <h2>Контактные данные</h2>
      <div className="detail-grid detail-grid--compact">
        <span>Телефон</span>
        <strong data-contact-field="phone">{phone}</strong>
        <span>Статус телефона</span>
        <strong>{phoneVerified ? "Подтверждён" : "Не подтверждён"}</strong>
        <span>Email</span>
        <strong data-contact-field="email">{email}</strong>
        <span>Статус email</span>
        <strong>{emailVerified ? "Подтверждён" : "Не подтверждён"}</strong>
      </div>
      <p className="privacy-note">Подтверждение телефона и email будет добавлено позже.</p>
      {vkIdentity ? (
        <p className="privacy-note">VK ID привязан{vkIdentity.displayName ? `: ${vkIdentity.displayName}` : ""}.</p>
      ) : bootstrap?.settings.vkIdEnabled ? (
        <button className="secondary-button" type="button" onClick={linkVk}>Привязать VK ID</button>
      ) : null}
      {linkError && <p className="error-text">{linkError}</p>}
    </section>
  );
}
