type AuditRole = "client" | "performer" | "admin";

type RequestCardData = {
  title: string;
  address: string;
  status: string;
  tone: "blue" | "green" | "amber" | "gray";
  description: string;
  action: string;
};

const clientRequests: RequestCardData[] = [
  {
    title: "Сопровождение в поликлинику",
    address: "г. Югорск, район Центральный",
    status: "Есть отклики",
    tone: "blue",
    description: "Нужно сопроводить подопечного, помочь с верхней одеждой и дождаться окончания приёма.",
    action: "Посмотреть 3 отклика"
  },
  {
    title: "Помощь по дому",
    address: "г. Советский, ул. Примерная",
    status: "Помощник выбран",
    tone: "green",
    description: "Лёгкая уборка, смена постельного белья и приготовление простой еды в рамках визита.",
    action: "Открыть заявку"
  },
  {
    title: "Присмотр и бытовая помощь",
    address: "г. Югорск, район Центральный",
    status: "В работе",
    tone: "amber",
    description: "Быть рядом с подопечным, помочь с обычными домашними делами и сопровождать на прогулке.",
    action: "Открыть чат"
  }
];

const performerRequests: RequestCardData[] = [
  {
    title: "Сопровождение",
    address: "г. Югорск, район Центральный",
    status: "Можно откликнуться",
    tone: "blue",
    description: "Сопровождение на приём и обратно. Предполагаемая длительность — 2 часа.",
    action: "Откликнуться"
  },
  {
    title: "Бытовая помощь",
    address: "г. Советский, ул. Примерная",
    status: "Отклик отправлен",
    tone: "gray",
    description: "Помощь с порядком в доме и приготовлением простой еды. Все задачи указаны в описании.",
    action: "Посмотреть отклик"
  },
  {
    title: "Присмотр",
    address: "г. Югорск, район Центральный",
    status: "Заявка принята в работу",
    tone: "amber",
    description: "Присмотр и уход на дому без медицинских процедур. Начало сегодня в 14:00.",
    action: "Открыть заявку"
  }
];

const roleMeta = {
  client: { role: "Заказчик", name: "Тестовый заказчик", eyebrow: "Личный кабинет" },
  performer: { role: "Помощник", name: "Тестовый помощник", eyebrow: "Кабинет помощника" },
  admin: { role: "Администратор", name: "Тестовый администратор", eyebrow: "Управление сервисом" }
} as const;

export function VisualAuditShowcasePage({ role }: { role: AuditRole }) {
  const meta = roleMeta[role];
  return (
    <div className={`audit-showcase audit-showcase--${role}`} data-visual-audit-route={role}>
      <header className="audit-showcase__topbar">
        <div>
          <strong className="audit-showcase__brand">Забота Рядом</strong>
          <span>{meta.eyebrow}</span>
        </div>
        <div className="audit-showcase__identity">
          <span className="audit-badge audit-badge--green">{meta.role}</span>
          <strong>{meta.name}</strong>
          {role !== "admin" && <span className="audit-showcase__balance">Баланс: <b>300 ₽</b></span>}
          {role === "performer" && <span className="audit-badge audit-badge--blue">Анкета проверена</span>}
        </div>
        <details className="audit-mobile-menu">
          <summary>Меню</summary>
          <nav aria-label="Мобильное меню">
            <span>Главная</span><span>Заявки</span><span>Баланс</span><span>Профиль</span>
          </nav>
        </details>
      </header>

      <aside className="audit-showcase__sidebar" aria-label="Разделы кабинета">
        {(role === "client" ? ["Главная", "Мои заявки", "История", "Баланс", "Уведомления", "Профиль"]
          : role === "performer" ? ["Доступные заявки", "Мои отклики", "В работе", "Завершённые", "Анкета и документы", "Уведомления"]
          : ["Пользователи", "Заявки", "Отклики", "Балансы", "Платежи", "Юридические документы", "Города", "Настройки"]).map((item, index) => (
          <button className={index === 0 ? "audit-nav-item audit-nav-item--active" : "audit-nav-item"} type="button" key={item}>{item}</button>
        ))}
        <div className="audit-showcase__sandbox-note">
          <strong>Визуальный sandbox</strong>
          <span>Все данные на экране — тестовые. Действия отключены.</span>
        </div>
      </aside>

      <main className="audit-showcase__main">
        {role === "client" && <ClientAuditContent />}
        {role === "performer" && <PerformerAuditContent />}
        {role === "admin" && <AdminAuditContent />}
      </main>
    </div>
  );
}

function ClientAuditContent() {
  return (
    <>
      <AuditHero title="Добрый день, Тестовый заказчик!" text="Здесь собраны активные заявки, отклики помощников и важные уведомления." action="Создать заявку" />
      <div className="audit-stats">
        <AuditStat value="3" label="Активные заявки" />
        <AuditStat value="5" label="Новые отклики" />
        <AuditStat value="300 ₽" label="Доступный баланс" />
        <AuditStat value="12" label="Завершённые заявки" />
      </div>
      <AuditAlert title="Есть новые отклики">Для заявки «Сопровождение в поликлинику» доступны три анкеты помощников.</AuditAlert>
      <AuditSection title="Активные заявки" action="Все заявки">
        <div className="audit-request-grid">{clientRequests.map((request) => <AuditRequestCard request={request} key={request.title} />)}</div>
      </AuditSection>
      <div className="audit-two-columns">
        <AuditSection title="История заявок">
          <AuditTable headers={["Заявка", "Дата", "Статус", "Сумма"]} rows={[["Помощь с продуктами", "18.07.2026", "Завершена", "1 200 ₽"], ["Прогулка с подопечным", "12.07.2026", "Завершена", "900 ₽"]]} />
        </AuditSection>
        <AuditSection title="Баланс и уведомления">
          <div className="audit-balance-card" data-audit-card><span>Доступно</span><strong>300 ₽</strong><button type="button">Пополнить баланс</button></div>
          <ul className="audit-notifications"><li><b>Сегодня</b> Помощник подтвердил визит.</li><li><b>Вчера</b> Появился новый отклик.</li></ul>
        </AuditSection>
      </div>
      <AuditBottomStates />
    </>
  );
}

function PerformerAuditContent() {
  return (
    <>
      <AuditHero title="Добрый день, Тестовый помощник!" text="Просматривайте доступные заявки, следите за откликами и визитами." action="Найти заявки" />
      <div className="audit-stats">
        <AuditStat value="8" label="Доступные заявки" />
        <AuditStat value="2" label="Мои отклики" />
        <AuditStat value="1" label="В работе" />
        <AuditStat value="300 ₽" label="Баланс" />
      </div>
      <AuditAlert title="Анкета проверена">Профиль виден заказчикам. Добавьте краткое описание опыта, чтобы анкета была полнее.</AuditAlert>
      <AuditSection title="Заявки и отклики" action="Открыть фильтры">
        <div className="audit-request-grid">{performerRequests.map((request) => <AuditRequestCard request={request} key={request.title} />)}</div>
      </AuditSection>
      <div className="audit-two-columns">
        <AuditSection title="Мои отклики и визиты">
          <AuditTable headers={["Заявка", "Состояние", "Дата", "Доход"]} rows={[["Присмотр", "Принята в работу", "21.07.2026", "1 100 ₽"], ["Бытовая помощь", "Отклик отправлен", "23.07.2026", "—"], ["Сопровождение", "Завершена", "15.07.2026", "950 ₽"]]} />
        </AuditSection>
        <AuditSection title="Профиль и документы">
          <div className="audit-profile-card" data-audit-card><div><span>Анкета</span><b>Проверена</b></div><div><span>Обязательные документы</span><b>4 из 4</b></div><div><span>Рейтинг</span><b>4,9</b></div><button type="button">Открыть анкету</button></div>
        </AuditSection>
      </div>
      <AuditBottomStates />
    </>
  );
}

function AdminAuditContent() {
  return (
    <>
      <AuditHero title="Обзор сервиса" text="Тестовое состояние админки с пользователями, заявками, операциями и юридическими документами." action="Открыть отчёт" />
      <div className="audit-stats">
        <AuditStat value="128" label="Пользователи" />
        <AuditStat value="24" label="Активные заявки" />
        <AuditStat value="7" label="На проверке" />
        <AuditStat value="8" label="Подключённые города" />
      </div>
      <AuditAlert title="Требуется внимание">Три анкеты ожидают проверки, а два платежа имеют статус «Ожидается». Все записи в этой витрине тестовые.</AuditAlert>
      <AuditSection title="Пользователи" action="Показать всех">
        <AuditTable headers={["Имя", "Роль", "Контакт", "Статус"]} rows={[["Тестовый заказчик 1", "Заказчик", "test@example.local", "Активен"], ["Тестовый помощник 1", "Помощник", "+7 (900) 000-00-00", "Анкета проверена"], ["Тестовый заказчик 2", "Заказчик", "test@example.local", "Ожидает подтверждения"]]} />
      </AuditSection>
      <div className="audit-two-columns audit-two-columns--admin">
        <AuditSection title="Заявки и отклики">
          <AuditTable headers={["Номер", "Заявка", "Город", "Статус"]} rows={[["ZR-0101", "Сопровождение", "Югорск", "Новая"], ["ZR-0102", "Бытовая помощь", "Советский", "Есть 2 отклика"], ["ZR-0103", "Присмотр", "Югорск", "В работе"]]} />
        </AuditSection>
        <AuditSection title="Балансы и платежи">
          <AuditTable headers={["Операция", "Сумма", "Статус", "Дата"]} rows={[["Пополнение TEST-001", "+1 500 ₽", "Выполнено", "21.07.2026"], ["Сервисный сбор TEST-002", "-50 ₽", "Ожидается", "21.07.2026"], ["Возврат TEST-003", "+300 ₽", "Выполнено", "20.07.2026"]]} />
        </AuditSection>
      </div>
      <AuditSection title="Юридические документы и города">
        <div className="audit-legal-grid">
          <div data-audit-card><b>Политика обработки персональных данных</b><span>Версия 1.0 · Опубликован</span></div>
          <div data-audit-card><b>Пользовательское соглашение заказчика</b><span>Версия 1.0 · Опубликован</span></div>
          <div data-audit-card><b>Условия использования сервиса помощником</b><span>Версия 1.0 · Опубликован</span></div>
          <div data-audit-card><b>Города</b><span>Югорск, Советский и ещё 6 подключены</span></div>
        </div>
      </AuditSection>
      <AuditBottomStates />
    </>
  );
}

function AuditHero({ title, text, action }: { title: string; text: string; action: string }) {
  return <section className="audit-hero" data-audit-card><div><span>Обзор</span><h1>{title}</h1><p>{text}</p></div><button type="button">{action}</button></section>;
}

function AuditStat({ value, label }: { value: string; label: string }) {
  return <article className="audit-stat" data-audit-card><strong>{value}</strong><span>{label}</span></article>;
}

function AuditAlert({ title, children }: { title: string; children: React.ReactNode }) {
  return <aside className="audit-alert" role="status"><strong>{title}</strong><p>{children}</p><button type="button">Подробнее</button></aside>;
}

function AuditSection({ title, action, children }: { title: string; action?: string; children: React.ReactNode }) {
  return <section className="audit-section"><header><h2>{title}</h2>{action && <button type="button">{action}</button>}</header>{children}</section>;
}

function AuditRequestCard({ request }: { request: RequestCardData }) {
  return <article className="audit-request-card" data-audit-card><div className="audit-request-card__head"><span className={`audit-badge audit-badge--${request.tone}`}>{request.status}</span><span>21.07.2026 · 14:00</span></div><h3>{request.title}</h3><b>{request.address}</b><p>{request.description}</p><div className="audit-request-card__footer"><strong>1 250 ₽</strong><button type="button">{request.action}</button></div></article>;
}

function AuditTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return <div className="audit-table-wrap" data-audit-table><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, cellIndex) => <td data-label={headers[cellIndex]} key={`${cell}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function AuditBottomStates() {
  return <div className="audit-bottom-states"><section className="audit-empty-state" data-audit-card><span aria-hidden="true">✓</span><div><h2>В этом разделе пока пусто</h2><p>Здесь появятся новые записи, когда они будут доступны.</p></div></section><section className="audit-long-note" data-audit-card><h2>Важно знать</h2><p>Сервис помогает договориться о бытовой помощи, сопровождении и уходе на дому без медицинских процедур. Перед началом визита уточните задачи, время и стоимость.</p></section></div>;
}
