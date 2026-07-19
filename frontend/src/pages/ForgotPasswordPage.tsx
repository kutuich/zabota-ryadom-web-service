import { Link } from "react-router-dom";

export function ForgotPasswordPage() {
  return (
    <main className="public-page">
      <section className="plain-section public-page__inner">
        <p className="eyebrow">Доступ к аккаунту</p>
        <h1>Восстановление доступа</h1>
        <p>Автоматическое восстановление пароля через SMS или email будет добавлено позже.</p>
        <p>Сейчас для восстановления доступа обратитесь в поддержку сервиса.</p>
        <div className="detail-grid detail-grid--compact">
          <span>Email</span>
          <strong>
            <a href="mailto:zabota-ugorsk@yandex.ru">zabota-ugorsk@yandex.ru</a>
          </strong>
          <span>Телефон</span>
          <strong>
            <a href="tel:+79224000320">+7 (922) 400-03-20</a>
          </strong>
        </div>
        <div className="form-inline">
          <Link className="secondary-button" to="/">Вернуться ко входу</Link>
          <a className="primary-button" href="mailto:zabota-ugorsk@yandex.ru">Написать в поддержку</a>
        </div>
      </section>
    </main>
  );
}
