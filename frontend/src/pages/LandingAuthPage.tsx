import { HeartHandshake, LogIn, UserRound, UsersRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const requiredConsents = [
  "terms",
  "privacy_policy",
  "personal_data_processing",
  "chat_rules",
  "payment_rules",
  "contact_data_transfer_for_request"
];

const customerLegalConsents = [
  { type: "customer_agreement", label: "Принимаю пользовательское соглашение заказчика", slug: "customer-agreement" },
  { type: "personal_data_consent", label: "Даю согласие на обработку персональных данных", slug: "personal-data-consent" },
  { type: "service_rules", label: "Принимаю правила сервиса и безопасности", slug: "service-rules" },
  { type: "service_notifications_consent", label: "Соглашаюсь получать сервисные уведомления", slug: "service-notifications-consent" }
];

const helperLegalConsents = [
  { type: "helper_terms", label: "Принимаю условия использования сервиса помощником", slug: "helper-terms" },
  { type: "personal_data_consent", label: "Даю согласие на обработку персональных данных", slug: "personal-data-consent" },
  { type: "service_rules", label: "Принимаю правила сервиса и безопасности", slug: "service-rules" },
  { type: "service_notifications_consent", label: "Соглашаюсь получать сервисные уведомления", slug: "service-notifications-consent" }
];

const defaultAcceptedLegal = Object.fromEntries(
  [...customerLegalConsents, ...helperLegalConsents].map((item) => [item.type, true])
) as Record<string, boolean>;

export function LandingAuthPage() {
  const { bootstrap, login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<"client" | "performer">("client");
  const [phoneOrEmail, setPhoneOrEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [cityId, setCityId] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState<Record<string, boolean>>(defaultAcceptedLegal);
  const [marketingAccepted, setMarketingAccepted] = useState(false);
  const [dependentDataConfirmed, setDependentDataConfirmed] = useState(true);
  const [helperNotEmployerConfirmed, setHelperNotEmployerConfirmed] = useState(true);
  const [helperNoMedicalConfirmed, setHelperNoMedicalConfirmed] = useState(true);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (mode === "login") {
        await login(phoneOrEmail, password);
      } else {
        const trimmedEmail = email.trim();
        if (!phone.trim()) {
          setError("Укажите телефон.");
          return;
        }
        if (password.length < 8) {
          setError("Пароль должен быть не короче 8 символов.");
          return;
        }
        if (password !== confirmPassword) {
          setError("Пароли не совпадают.");
          return;
        }
        if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          setError("Укажите корректный email.");
          return;
        }
        const roleConsents = role === "client" ? customerLegalConsents : helperLegalConsents;
        const acceptedLegalDocumentTypes = roleConsents
          .filter((item) => acceptedLegal[item.type])
          .map((item) => item.type);
        if (marketingAccepted) acceptedLegalDocumentTypes.push("marketing_notifications_consent");
        await register({
          role,
          phone,
          email: trimmedEmail || undefined,
          displayName,
          password,
          cityId: cityId || bootstrap?.cities[0]?.id || "",
          acceptedConsentTypes: requiredConsents,
          acceptedLegalDocumentTypes,
          marketingNotificationsAccepted: marketingAccepted,
          dependentDataTransferConfirmed: dependentDataConfirmed,
          helperNotEmployerAcknowledged: helperNotEmployerConfirmed,
          helperNoMedicalServicesConfirmed: helperNoMedicalConfirmed
        });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Ошибка входа");
    }
  }

  return (
    <main className="landing">
      <section className="landing__hero">
        <div className="brand-mark">
          <HeartHandshake size={34} />
        </div>
        <h1>Забота Рядом</h1>
        <p>Локальный сервис помощи для семьи, дома и близких</p>
      </section>

      <section className="auth-stack" aria-label="Вход и регистрация">
        <div className="role-choice-grid">
          <button
            type="button"
            className={role === "client" ? "choice-card choice-card--active" : "choice-card"}
            onClick={() => {
              setRole("client");
              setMode("register");
            }}
          >
            <UserRound size={22} />
            <strong>Я заказчик</strong>
            <span>Хочу оставить заявку и найти помощника.</span>
          </button>
          <button
            type="button"
            className={role === "performer" ? "choice-card choice-card--active" : "choice-card"}
            onClick={() => {
              setRole("performer");
              setMode("register");
            }}
          >
            <UsersRound size={22} />
            <strong>Я помощник</strong>
            <span>Хочу откликаться на заявки и помогать людям.</span>
          </button>
        </div>

      <form className="auth-panel" onSubmit={submit}>
        <div className="segmented">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            <LogIn size={16} />
            Войти
          </button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Зарегистрироваться
          </button>
        </div>

        {mode === "login" ? (
          <>
            <label>
              Телефон или email
              <input
                value={phoneOrEmail}
                onChange={(event) => setPhoneOrEmail(event.target.value)}
                autoComplete="username"
              />
              <span className="field-help">Можно войти по номеру телефона или email.</span>
            </label>
            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <p className="privacy-note">
              <Link to="/forgot-password">Забыли пароль?</Link>
            </p>
          </>
        ) : (
          <>
            <label>
              Имя
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
            </label>
            <label>
              Телефон
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+7 (___) ___-**-**"
                inputMode="tel"
                autoComplete="tel"
                required
              />
              <span className="field-help">Введите российский номер телефона. Мы сохраним его в едином формате.</span>
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
              <span className="field-help">
                {role === "client"
                  ? "Необязательно. Можно добавить позже в профиле."
                  : "Желательно указать для связи и восстановления доступа. Можно добавить позже."}
              </span>
            </label>
            <label>
              Город
              <select value={cityId} onChange={(event) => setCityId(event.target.value)}>
                <option value="">Выберите город</option>
                {bootstrap?.cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </label>
            <label>
              Повторите пароль
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </label>
            <fieldset className="span-2 checkbox-grid consent-checkboxes">
              <legend>Обязательные документы и согласия</legend>
              {(role === "client" ? customerLegalConsents : helperLegalConsents).map((item) => (
                <label className="checkbox-row" key={item.type}>
                  <input
                    type="checkbox"
                    checked={Boolean(acceptedLegal[item.type])}
                    onChange={(event) => setAcceptedLegal({ ...acceptedLegal, [item.type]: event.target.checked })}
                  />
                  <span>
                    {item.label}{" "}
                    <Link to={`/legal/${item.slug}`} target="_blank">открыть</Link>
                  </span>
                </label>
              ))}
              {role === "client" ? (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={dependentDataConfirmed}
                    onChange={(event) => setDependentDataConfirmed(event.target.checked)}
                  />
                  <span>Подтверждаю, что у меня есть основание передать данные человека, которому нужна помощь.</span>
                </label>
              ) : (
                <>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={helperNotEmployerConfirmed}
                      onChange={(event) => setHelperNotEmployerConfirmed(event.target.checked)}
                    />
                    <span>Понимаю, что сервис не является работодателем и не гарантирует заявки.</span>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={helperNoMedicalConfirmed}
                      onChange={(event) => setHelperNoMedicalConfirmed(event.target.checked)}
                    />
                    <span>Подтверждаю, что не буду выполнять медицинские услуги через сервис.</span>
                  </label>
                </>
              )}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={marketingAccepted}
                  onChange={(event) => setMarketingAccepted(event.target.checked)}
                />
                <span>
                  Хочу получать информационные сообщения.{" "}
                  <Link to="/legal/marketing-notifications-consent" target="_blank">открыть</Link>
                </span>
              </label>
            </fieldset>
          </>
        )}

        {error && <p className="error-text">{error}</p>}
        <button className="primary-button primary-button--wide" type="submit">
          {mode === "login" ? "Войти" : `Зарегистрироваться как ${role === "client" ? "заказчик" : "помощник"}`}
        </button>
        {mode === "login" ? (
          <p className="privacy-note">
            Нет аккаунта?{" "}
            <button className="link-button" type="button" onClick={() => { setRole("client"); setMode("register"); }}>
              Зарегистрироваться как заказчик
            </button>{" "}
            или{" "}
            <button className="link-button" type="button" onClick={() => { setRole("performer"); setMode("register"); }}>
              как помощник
            </button>
          </p>
        ) : (
          <p className="privacy-note">
            Уже зарегистрированы?{" "}
            <button className="link-button" type="button" onClick={() => setMode("login")}>Войти</button>
          </p>
        )}
      </form>
      </section>
    </main>
  );
}
