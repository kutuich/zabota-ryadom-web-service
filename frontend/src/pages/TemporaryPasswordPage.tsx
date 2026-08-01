import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { defaultPathForRole } from "../routes/navigation";
import { effectiveRoleForUser } from "../utils/authRole";

export function TemporaryPasswordPage() {
  const { user, logout, acceptReplacementToken } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ newPassword: "", newPasswordConfirmation: "" });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  if (!user) return <Navigate to="/app" replace />;
  if (!user.mustChangePassword) return <Navigate to={defaultPathForRole(effectiveRoleForUser(user)!)} replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await api.changeTemporaryPassword(form);
      await acceptReplacementToken(result.token);
      navigate("/app", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить пароль.");
    }
  }

  return <main className="mandatory-password-page">
    <form className="plain-section mandatory-password-card" onSubmit={submit}>
      <KeyRound size={30} />
      <h1>Создайте новый пароль</h1>
      <p>Временный пароль подходит только для первого входа. До его замены кабинет и бизнес-действия недоступны.</p>
      <p className="privacy-note">Не менее 12 символов: строчная и заглавная буквы, цифра и специальный символ.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <label>Новый пароль<input autoFocus type={show ? "text" : "password"} autoComplete="new-password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} /></label>
      <label>Повтор нового пароля<input type={show ? "text" : "password"} autoComplete="new-password" value={form.newPasswordConfirmation} onChange={(event) => setForm({ ...form, newPasswordConfirmation: event.target.value })} /></label>
      <button className="ghost-button" type="button" onClick={() => setShow((value) => !value)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}{show ? "Скрыть пароль" : "Показать пароль"}</button>
      <button className="primary-button" type="submit">Сохранить новый пароль</button>
      <button className="secondary-button" type="button" onClick={() => { logout(); navigate("/app", { replace: true }); }}>Выйти</button>
    </form>
  </main>;
}
