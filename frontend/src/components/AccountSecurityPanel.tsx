import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, LogOut, Save } from "lucide-react";
import { Navigate } from "react-router-dom";
import { api, setStoredToken } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { TEMPORARY_PASSWORD_PATH } from "../routes/security";
import { formatDateTimeRu } from "../utils/dateTime";

export function AccountSecurityPanel() {
  const { user, refreshMe, acceptReplacementToken } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", newPasswordConfirmation: "" });
  const [showPasswords, setShowPasswords] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => setDisplayName(user?.displayName ?? ""), [user?.displayName]);
  if (!user) return null;
  if (user.mustChangePassword) return <Navigate to={TEMPORARY_PASSWORD_PATH} replace />;

  async function saveName() {
    try {
      await api.updateMyProfile(displayName);
      await refreshMe();
      setNotice("Никнейм изменён.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось изменить никнейм.");
    }
  }

  async function changePassword() {
    try {
      const result = await api.changeMyPassword(passwords);
      await acceptReplacementToken(result.token);
      setPasswords({ currentPassword: "", newPassword: "", newPasswordConfirmation: "" });
      setNotice("Пароль изменён. Остальные сеансы завершены.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось изменить пароль.");
    }
  }

  async function revokeOthers() {
    if (!window.confirm("Завершить все остальные сеансы?")) return;
    try {
      const result = await api.revokeMyOtherSessions();
      setStoredToken(result.token);
      await acceptReplacementToken(result.token);
      setNotice("Остальные сеансы завершены.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось завершить сеансы.");
    }
  }

  return (
    <section className="plain-section span-full account-security-panel">
      <h2>Настройки профиля</h2>
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="account-security-grid">
        <div className="account-security-block">
          <h3>Основная информация</h3>
          <label>Никнейм<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={50} /></label>
          <button className="secondary-button" type="button" onClick={saveName}><Save size={18} />Сохранить никнейм</button>
          <div className="detail-grid">
            <span>Телефон</span><strong>{user.phone?.trim() || "не указан"}</strong>
            <span>Email</span><strong>{user.email?.trim() || "не указан"}</strong>
            <span>Роль</span><strong>{roleLabel(user.role)}</strong>
            <span>Статус</span><strong>{user.status}</strong>
          </div>
        </div>
        <div className="account-security-block">
          <h3>Безопасность</h3>
          <p className="privacy-note">Не менее 12 символов: строчная и заглавная буквы, цифра и специальный символ.</p>
          <label>Текущий пароль<input type={showPasswords ? "text" : "password"} autoComplete="current-password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label>
          <label>Новый пароль<input type={showPasswords ? "text" : "password"} autoComplete="new-password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></label>
          <label>Повтор нового пароля<input type={showPasswords ? "text" : "password"} autoComplete="new-password" value={passwords.newPasswordConfirmation} onChange={(event) => setPasswords({ ...passwords, newPasswordConfirmation: event.target.value })} /></label>
          <button className="ghost-button" type="button" onClick={() => setShowPasswords((value) => !value)}>{showPasswords ? <EyeOff size={18} /> : <Eye size={18} />}{showPasswords ? "Скрыть пароли" : "Показать пароли"}</button>
          <button className="primary-button" type="button" onClick={changePassword}><KeyRound size={18} />Изменить пароль</button>
          <button className="secondary-button" type="button" onClick={revokeOthers}><LogOut size={18} />Завершить все остальные сеансы</button>
          <div className="detail-grid">
            <span>Последняя смена пароля</span><strong>{user.passwordChangedAt ? formatDateTimeRu(user.passwordChangedAt) : "нет данных"}</strong>
            <span>Последний вход</span><strong>{user.lastLoginAt ? formatDateTimeRu(user.lastLoginAt) : "нет данных"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function roleLabel(role: string) {
  if (role === "superadmin") return "Суперадминистратор";
  if (role === "manager") return "Менеджер";
  if (role === "performer") return "Помощник";
  return "Заказчик";
}
