import { LogIn, UserRound, UsersRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CityCombobox } from "../components/CityCombobox";
import { useAuth } from "../context/AuthContext";
import appAuthLogo from "../assets/app-auth-logo.png";

const requiredConsents = [
  "terms",
  "privacy",
  "personal_data_processing",
  "chat_rules",
  "payment_rules",
  "contact_data_transfer_for_request"
];

const customerLegalConsents = [
  { type: "customer_agreement", label: "Принимаю пользовательское соглашение заказчика", slug: "customer-agreement" },
  { type: "privacy", label: "Принимаю политику обработки персональных данных", slug: "privacy" },
  { type: "personal_data_consent", label: "Даю согласие на обработку персональных данных", slug: "personal-data-consent" },
  { type: "service_rules", label: "Принимаю правила сервиса и безопасности", slug: "service-rules" },
  { type: "service_notifications_consent", label: "Соглашаюсь получать сервисные уведомления", slug: "service-notifications-consent" }
];

const helperLegalConsents = [
  { type: "helper_terms", label: "Принимаю условия использования сервиса помощником", slug: "helper-terms" },
  { type: "privacy", label: "Принимаю политику обработки персональных данных", slug: "privacy" },
  { type: "personal_data_consent", label: "Даю согласие на обработку персональных данных", slug: "personal-data-consent" },
  { type: "service_rules", label: "Принимаю правила сервиса и безопасности", slug: "service-rules" },
  { type: "service_notifications_consent", label: "Соглашаюсь получать сервисные уведомления", slug: "service-notifications-consent" },
  { type: "helper_documents_consent", label: "Соглашаюсь на загрузку, хранение и проверку документов помощника", slug: "helper-documents-consent" }
];

const defaultAcceptedLegal = Object.fromEntries(
  [...customerLegalConsents, ...helperLegalConsents].map((item) => [item.type, true])
) as Record<string, boolean>;

export function LandingAuthPage() {
  const { bootstrap, login, register } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<"client" | "performer">("client");
  const [phoneOrEmail, setPhoneOrEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [cityId, setCityId] = useState("");
  const [citySuggestion, setCitySuggestion] = useState("");
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
        if (!cityId && !citySuggestion) {
          setError("Выберите город.");
          return;
        }
        if (role === "client" && !dependentDataConfirmed) {
          setError("Подтвердите основание для передачи данных человека, которому нужна помощь.");
          return;
        }
        if (role === "performer" && !helperNotEmployerConfirmed) {
          setError("Подтвердите, что сервис не является работодателем и не гарантирует заявки.");
          return;
        }
        if (role === "performer" && !helperNoMedicalConfirmed) {
          setError("Подтвердите, что не будете выполнять медицинские процедуры через сервис.");
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
          cityId,
          citySuggestion: citySuggestion ? { name: citySuggestion } : undefined,
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

  function openLogin() {
    setError("");
    setMode("login");
  }

  function openRegister(nextRole: "client" | "performer") {
    setError("");
    setRole(nextRole);
    setMode("register");
  }

  const roleTitle = role === "client" ? "Регистрация заказчика" : "Регистрация помощника";
  const oauthParams = new URLSearchParams(location.search);
  const oauthFailed = oauthParams.get("oauthError") === "vk";
  const oauthReason = oauthParams.get("oauthReason");
  const oauthErrorMessage = oauthReason === "archived-not-restorable"
    ? "Регистрация через VK ранее была остановлена. Обратитесь в поддержку или войдите другим способом."
    : "Не получилось войти через VK. Попробуйте ещё раз или войдите по телефону/email.";

  if (mode === "register") {
    return (
      <main className="auth-register-page">
        <form className="auth-register-shell" onSubmit={submit}>
          <header className="auth-register-header">
            <button className="link-button auth-back-button" type="button" onClick={openLogin}>
              ← Назад ко входу
            </button>
            <p className="auth-register-brand">Забота Рядом</p>
            <h1>{roleTitle}</h1>
            <p>Заполните данные профиля и подтвердите необходимые документы.</p>
          </header>

          <section className="auth-register-section" aria-labelledby="register-role-title">
            <div className="auth-section-heading">
              <span>1</span>
              <div>
                <h2 id="register-role-title">Роль в сервисе</h2>
                <p>Выберите, как хотите пользоваться приложением.</p>
              </div>
            </div>
            <div className="role-choice-grid auth-register-role-grid">
              <button
                type="button"
                className={role === "client" ? "choice-card choice-card--active" : "choice-card"}
                onClick={() => setRole("client")}
              >
                <UserRound size={22} />
                <strong>Я заказчик</strong>
                <span>Хочу оставить заявку и найти помощника.</span>
              </button>
              <button
                type="button"
                className={role === "performer" ? "choice-card choice-card--active" : "choice-card"}
                onClick={() => setRole("performer")}
              >
                <UsersRound size={22} />
                <strong>Я помощник</strong>
                <span>Хочу откликаться на заявки и помогать людям.</span>
              </button>
            </div>
          </section>

          <section className="auth-register-section" aria-labelledby="personal-data-title">
            <div className="auth-section-heading">
              <span>2</span>
              <div>
                <h2 id="personal-data-title">Личные данные</h2>
                <p>Эти данные нужны для профиля и связи внутри сервиса.</p>
              </div>
            </div>
            <div className="auth-form-grid">
              <label>
                Имя / Логин
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  placeholder="Введите имя или логин"
                />
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
                  placeholder="Введите email"
                />
                <span className="field-help">
                  {role === "client"
                    ? "Необязательно. Можно добавить позже в профиле."
                    : "Желательно указать для связи и восстановления доступа. Можно добавить позже."}
                </span>
              </label>
              <CityCombobox
                cities={bootstrap?.cities ?? []}
                value={cityId}
                onChange={(nextCityId) => { setCityId(nextCityId); if (nextCityId) setCitySuggestion(""); }}
                onSuggest={(name) => { setCityId(""); setCitySuggestion(name); }}
              />
            </div>
          </section>

          <section className="auth-register-section" aria-labelledby="login-data-title">
            <div className="auth-section-heading">
              <span>3</span>
              <div>
                <h2 id="login-data-title">Данные для входа</h2>
                <p>Пароль должен быть не короче 8 символов.</p>
              </div>
            </div>
            <div className="auth-form-grid auth-form-grid--passwords">
              <label>
                Пароль
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="Введите пароль"
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
                  placeholder="Повторите пароль"
                />
              </label>
            </div>
          </section>

          <fieldset className="auth-register-section auth-register-consents">
            <legend>
              <span>4</span>
              <strong>Документы и согласия</strong>
            </legend>
            <div className="auth-consent-list">
              {(role === "client" ? customerLegalConsents : helperLegalConsents).map((item) => (
                <label className="checkbox-row" key={item.type}>
                  <input
                    type="checkbox"
                    checked={Boolean(acceptedLegal[item.type])}
                    onChange={(event) => setAcceptedLegal({ ...acceptedLegal, [item.type]: event.target.checked })}
                  />
                  <span>
                    {item.label}{" "}
                    <Link className="consent-document-link" to={`/legal/${item.slug}`} target="_blank">открыть</Link>
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
                    <span>Подтверждаю, что не буду выполнять медицинские процедуры через сервис.</span>
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
                  <Link className="consent-document-link" to="/legal/marketing-notifications-consent" target="_blank">открыть</Link>{" "}
                  <strong className="consent-optional-label">(необязательно)</strong>
                </span>
              </label>
            </div>
          </fieldset>

          {error && <p className="error-text">{error}</p>}
          <button className="primary-button primary-button--wide auth-submit auth-submit--register" type="submit">
            Создать аккаунт
          </button>
          <p className="privacy-note">
            Уже есть аккаунт?{" "}
            <button className="link-button" type="button" onClick={openLogin}>Войти</button>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="landing auth-page auth-login-page">
      <section className="landing__hero auth-brand-panel" aria-label="Забота Рядом">
        <img className="auth-brand-panel__image" src={appAuthLogo} alt="Забота Рядом" />
      </section>

      <section className="auth-stack" aria-label="Вход и регистрация">
      <form className="auth-panel auth-login-card" onSubmit={submit}>
        <div className="auth-panel__header">
          <h2>Добро пожаловать!</h2>
          <p>Войдите в свой аккаунт для продолжения.</p>
        </div>

        {bootstrap?.settings.vkIdEnabled && (
          <div className="vk-auth-block">
            <a className="vk-auth-button" href="/api/auth/oauth/vk/start">Войти через VK</a>
            <span>Быстрый вход для пользователей ВК</span>
            <div className="auth-divider"><span>Войти по телефону или email</span></div>
          </div>
        )}

        {oauthFailed && !error && (
          <p className="error-text">{oauthErrorMessage}</p>
        )}

        <label>
          Телефон или email
          <input
            value={phoneOrEmail}
            onChange={(event) => setPhoneOrEmail(event.target.value)}
            autoComplete="username"
            placeholder="Введите телефон или email"
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
            placeholder="Введите пароль"
          />
        </label>
        <p className="privacy-note">
          <Link to="/forgot-password">Забыли пароль?</Link>
        </p>

        {error && <p className="error-text">{error}</p>}
        <button className="primary-button primary-button--wide auth-submit auth-submit--login" type="submit">
          <LogIn size={18} />
          Войти
        </button>
        <p className="privacy-note auth-register-links">
          Нет аккаунта?{" "}
          <button className="link-button" type="button" onClick={() => openRegister("client")}>
            Зарегистрироваться как заказчик
          </button>{" "}
          или{" "}
          <button className="link-button" type="button" onClick={() => openRegister("performer")}>
            как помощник
          </button>
        </p>
      </form>
      </section>
    </main>
  );
}
