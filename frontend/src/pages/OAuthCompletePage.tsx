import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CityCombobox } from "../components/CityCombobox";
import { useAuth } from "../context/AuthContext";

const documentsByRole = {
  client: [
    ["customer_agreement", "Пользовательское соглашение заказчика", "customer-agreement"],
    ["privacy", "Политика обработки персональных данных", "privacy"],
    ["personal_data_consent", "Согласие на обработку персональных данных", "personal-data-consent"],
    ["service_rules", "Правила сервиса", "service-rules"],
    ["service_notifications_consent", "Согласие на сервисные уведомления", "service-notifications-consent"]
  ],
  performer: [
    ["helper_terms", "Условия использования сервиса помощником", "helper-terms"],
    ["privacy", "Политика обработки персональных данных", "privacy"],
    ["personal_data_consent", "Согласие на обработку персональных данных", "personal-data-consent"],
    ["service_rules", "Правила сервиса", "service-rules"],
    ["helper_documents_consent", "Согласие на хранение и проверку документов помощника", "helper-documents-consent"],
    ["service_notifications_consent", "Согласие на сервисные уведомления", "service-notifications-consent"]
  ]
} as const;

export function OAuthCompletePage() {
  const navigate = useNavigate();
  const { bootstrap, user, claimOAuthSession, cancelOAuth, completeOAuthProfile } = useAuth();
  const [role, setRole] = useState<"client" | "performer">("client");
  const [cityId, setCityId] = useState("");
  const [phone, setPhone] = useState("");
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [marketingAccepted, setMarketingAccepted] = useState(false);
  const [dependentConfirmed, setDependentConfirmed] = useState(false);
  const [helperNotEmployer, setHelperNotEmployer] = useState(false);
  const [helperNoProcedures, setHelperNoProcedures] = useState(false);
  const [isClaiming, setIsClaiming] = useState(!user);
  const [isSaving, setIsSaving] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      if (user.role === "client") {
        navigate("/app/client/requests", { replace: true });
        return;
      }
      if (user.role === "performer") {
        navigate("/app/performer/profile", { replace: true });
        return;
      }
      setPhone(user.phone ?? "");
      setCityId(user.cityId ?? "");
      setIsClaiming(false);
      return;
    }
    let active = true;
    claimOAuthSession()
      .then((result) => {
        if (!active) return;
        if (result.profileComplete) navigate(result.nextPath, { replace: true });
      })
      .catch((claimError) => {
        if (active) setError(claimError instanceof Error ? claimError.message : "Не удалось продолжить вход через VK");
      })
      .finally(() => {
        if (active) setIsClaiming(false);
      });
    return () => { active = false; };
  }, [claimOAuthSession, navigate, user]);

  const documents = useMemo(() => documentsByRole[role], [role]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!cityId) return setError("Выберите город.");
    if (!phone.trim()) return setError("Укажите телефон.");
    const missing = documents.filter(([type]) => !accepted[type]);
    if (missing.length) return setError("Примите обязательные юридические документы.");
    if (role === "client" && !dependentConfirmed) {
      return setError("Подтвердите основание для передачи данных человека, которому нужна помощь.");
    }
    if (role === "performer" && (!helperNotEmployer || !helperNoProcedures)) {
      return setError("Подтвердите условия использования сервиса помощником.");
    }
    setIsSaving(true);
    try {
      const result = await completeOAuthProfile({
        role,
        cityId,
        phone,
        acceptedDocuments: documents.map(([type]) => type),
        marketingNotificationsAccepted: marketingAccepted,
        dependentDataTransferConfirmed: dependentConfirmed,
        helperNotEmployerAcknowledged: helperNotEmployer,
        helperNoMedicalServicesConfirmed: helperNoProcedures
      });
      navigate(result.nextPath, { replace: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Не удалось сохранить профиль");
    } finally {
      setIsSaving(false);
    }
  }

  async function cancel() {
    setIsCancelling(true);
    try {
      await cancelOAuth();
    } finally {
      navigate("/app/login", { replace: true });
    }
  }

  if (isClaiming) {
    return <main className="oauth-complete-page"><p>Завершаем вход через VK...</p></main>;
  }

  return (
    <main className="oauth-complete-page">
      <form className="oauth-complete-card" onSubmit={submit}>
        <header>
          <p className="auth-register-brand">Забота Рядом</p>
          <h1>Завершите настройку профиля</h1>
          <p>Вы вошли через VK. Осталось заполнить данные, чтобы пользоваться сервисом.</p>
        </header>

        <section>
          <h2>Как вы хотите пользоваться сервисом?</h2>
          <div className="role-choice-grid">
            <button type="button" className={role === "client" ? "choice-card choice-card--active" : "choice-card"} onClick={() => setRole("client")}>
              <strong>Заказчик</strong><span>Мне нужна бытовая помощь или сопровождение.</span>
            </button>
            <button type="button" className={role === "performer" ? "choice-card choice-card--active" : "choice-card"} onClick={() => setRole("performer")}>
              <strong>Помощник</strong><span>Я хочу помогать как Помощник.</span>
            </button>
          </div>
        </section>

        <section className="oauth-profile-fields">
          <label>Телефон<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+7 (___) ___-**-**" inputMode="tel" /></label>
          <CityCombobox cities={bootstrap?.cities ?? []} value={cityId} onChange={setCityId} />
        </section>

        <fieldset className="oauth-consents">
          <legend>Документы и согласия</legend>
          {documents.map(([type, label, slug]) => (
            <label className="checkbox-row" key={type}>
              <input type="checkbox" checked={Boolean(accepted[type])} onChange={(event) => setAccepted({ ...accepted, [type]: event.target.checked })} />
              <span>{label} <Link to={`/legal/${slug}`} target="_blank">открыть</Link></span>
            </label>
          ))}
          {role === "client" ? (
            <label className="checkbox-row"><input type="checkbox" checked={dependentConfirmed} onChange={(event) => setDependentConfirmed(event.target.checked)} /><span>Подтверждаю основание для передачи данных человека, которому нужна помощь.</span></label>
          ) : (
            <>
              <label className="checkbox-row"><input type="checkbox" checked={helperNotEmployer} onChange={(event) => setHelperNotEmployer(event.target.checked)} /><span>Понимаю, что сервис не является работодателем и не гарантирует заявки.</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={helperNoProcedures} onChange={(event) => setHelperNoProcedures(event.target.checked)} /><span>Подтверждаю, что оказываю только бытовую помощь без медицинских процедур.</span></label>
            </>
          )}
          <label className="checkbox-row"><input type="checkbox" checked={marketingAccepted} onChange={(event) => setMarketingAccepted(event.target.checked)} /><span>Хочу получать информационные сообщения (необязательно).</span></label>
        </fieldset>

        {error && <p className="error-text">{error}</p>}
        <button className="primary-button primary-button--wide" type="submit" disabled={isSaving}>{isSaving ? "Сохраняем..." : "Продолжить"}</button>
        <p className="privacy-note">Вы можете отменить вход через VK и войти по телефону или email.</p>
        <button className="secondary-button" type="button" onClick={() => void cancel()} disabled={isCancelling}>
          {isCancelling ? "Выходим..." : "Выйти и войти другим способом"}
        </button>
      </form>
    </main>
  );
}
