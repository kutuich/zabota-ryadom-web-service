import { useEffect, useState, type ReactNode } from "react";

type AuditRole = "client" | "performer" | "admin";
type Visit = { id: string; day: string; date: string; start: string; end: string; minutes: number; price: number };

const visitTemplates = [
  { start: "10:00", end: "11:00", minutes: 60, price: 700 },
  { start: "14:00", end: "16:00", minutes: 120, price: 900 },
  { start: "18:00", end: "21:00", minutes: 180, price: 1100 }
];
const dates = ["03.08.2026", "04.08.2026", "05.08.2026", "06.08.2026", "07.08.2026"];
const visits: Visit[] = dates.flatMap((date, dayIndex) => visitTemplates.map((visit, slotIndex) => ({
  id: `audit-${dayIndex + 1}-${slotIndex + 1}`,
  day: `День ${dayIndex + 1}`,
  date,
  ...visit
})));
const totalHelp = visits.reduce((sum, visit) => sum + visit.price, 0);

const roleMeta = {
  client: { marker: "client", title: "Создание заявки", role: "Заказчик" },
  performer: { marker: "performer", title: "Согласованные условия заявки", role: "Помощник" },
  admin: { marker: "admin", title: "Визиты и внутренний резерв", role: "Администратор" }
} as const;

export function VisualAuditShowcasePage({ role }: { role: AuditRole }) {
  const meta = roleMeta[role];
  return (
    <div className={`audit-showcase audit-showcase--${role}`} data-visual-audit-route={meta.marker} data-workflow-version="2">
      <header className="audit-showcase__topbar">
        <div><strong className="audit-showcase__brand">Забота Рядом</strong><span>Визуальный sandbox</span></div>
        <div className="audit-showcase__identity"><span className="audit-badge audit-badge--green">{meta.role}</span><strong>{meta.title}</strong></div>
        <nav className="audit-workflow-nav" aria-label="Верхняя навигация"><span>Заявки</span><span>Чаты</span><span>Баланс</span><span>Профиль</span></nav>
      </header>
      <aside className="audit-showcase__sidebar" aria-label="Разделы кабинета">
        {["Обзор", "График", "Визиты", "Согласование", "История"].map((item, index) => <button className={index === 1 ? "audit-nav-item audit-nav-item--active" : "audit-nav-item"} type="button" key={item}>{item}</button>)}
        <div className="audit-showcase__sandbox-note"><strong>Только mock-данные</strong><span>Страница не обращается к API и не изменяет базу.</span></div>
      </aside>
      <main className="audit-showcase__main">
        {role === "client" && <ClientWorkflowAudit />}
        {role === "performer" && <PerformerWorkflowAudit />}
        {role === "admin" && <AdminWorkflowAudit />}
      </main>
    </div>
  );
}

function ClientWorkflowAudit() {
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => {
    if (!showErrors) return;
    const firstError = document.querySelector<HTMLElement>("[data-audit-field-error]");
    firstError?.scrollIntoView({ block: "center" });
    firstError?.focus({ preventScroll: true });
  }, [showErrors]);
  return (
    <>
      <AuditHero eyebrow="Форма заявки · workflow v2" title="Создать заявку" text="Конечный график с несколькими визитами и индивидуальным расчётом каждого интервала." />
      <form className="audit-workflow-form" onSubmit={(event) => { event.preventDefault(); setShowErrors(true); }} noValidate>
        <AuditStep number="1" title="Город и контактное лицо"><AuditField label="Город Подопечного" value="Югорск" /><AuditField label="Контактное лицо" value="Тестовый заказчик" /></AuditStep>
        <AuditStep number="2" title="Кому нужна помощь?"><div className="audit-choice-row"><b>Пожилому человеку</b></div>{showErrors && <AuditError field="recipientType">Выберите, кому нужна помощь.</AuditError>}</AuditStep>
        <AuditStep number="3" title="Состояние Подопечного"><AuditField label="Основное состояние" value="Нужна лёгкая поддержка" /><p>Особенности: Есть риск падения; Нужна помощь при передвижении.</p>{showErrors && <AuditError field="dependentMainState">Выберите основное состояние Подопечного.</AuditError>}</AuditStep>
        <AuditStep number="4" title="Что нужно сделать?"><div className="audit-task-list"><span>Лёгкая уборка</span><span>Мытьё посуды</span><span>Приготовить простую еду</span><span>Купить продукты</span></div>{showErrors && <AuditError field="selectedTasks">Выберите хотя бы одну задачу.</AuditError>}</AuditStep>
        <AuditStep number="5" title="Конечный график"><AuditField label="Период" value="3–7 августа 2026" /><p><strong>15 визитов · 30 часов</strong></p><VisitCards compact />{showErrors && <AuditError field="schedule.visitSlots.audit-1-2.startTime">Визиты не должны пересекаться.</AuditError>}</AuditStep>
        <AuditStep number="6" title="Адрес"><div className="audit-field-grid"><AuditField label="Улица" value="Мира" /><AuditField label="Дом" value="10" /><AuditField label="Квартира (необязательно)" value="15" /><AuditField label="Подъезд (необязательно)" value="2" /></div>{showErrors && <AuditError field="address.street">Укажите улицу.</AuditError>}</AuditStep>
        <AuditStep number="7" title="Ориентировочный расчёт"><PeriodTotals role="client" /><VisitTable /></AuditStep>
        <AuditStep number="8" title="Комментарий"><AuditField label="Комментарий к заявке" value="Пожалуйста, позвоните в домофон перед визитом." />{showErrors && <AuditError field="comment">Для сопровождения укажите место и действия.</AuditError>}</AuditStep>
        <section className="audit-submit-bar" data-audit-card><div><strong>Данные сохраняются при ошибке</strong><span>Проверка раскрывает нужный раздел и переводит фокус к полю.</span></div><button type="submit">Проверить ошибки формы</button><button type="button">Создать заявку</button></section>
      </form>
    </>
  );
}

function PerformerWorkflowAudit() {
  return (
    <>
      <AuditHero eyebrow="Заявка ZR-AUDIT-15" title="Согласованные условия заявки" text="Одна версия условий должна быть подтверждена Заказчиком и Помощником." />
      <div className="audit-stats"><AuditStat value="15" label="Визитов" /><AuditStat value="30 ч" label="Общая длительность" /><AuditStat value="13 500 ₽" label="Стоимость помощи" /><AuditStat value="750 ₽" label="Сервисный сбор Помощника" /></div>
      <AuditSection title="Выбранные задачи"><div className="audit-task-list"><span>Лёгкая уборка</span><span>Мытьё посуды</span><span>Приготовить простую еду</span><span>Купить продукты</span></div></AuditSection>
      <AuditSection title="Период и конкретные визиты"><VisitCards /><VisitTable /></AuditSection>
      <AuditSection title="Подтверждение условий"><div className="audit-confirmation" data-audit-card><p><strong>Заказчик:</strong> условия подтверждены.</p><p><strong>Помощник:</strong> ожидается подтверждение.</p><button type="button">Принять заявку в работу</button></div></AuditSection>
      <AuditSection title="Расчёты"><PeriodTotals role="performer" /><p className="audit-direct-payment">Оплата помощи производится Заказчиком Помощнику напрямую. Сервисный сбор оплачивается Помощником сервису отдельно со внутреннего баланса.</p></AuditSection>
    </>
  );
}

function AdminWorkflowAudit() {
  return (
    <>
      <AuditHero eyebrow="Внутренний учёт" title="Визиты и внутренний резерв" text="Аналитический показатель, а не депозит, эскроу или отдельный пользовательский баланс." />
      <div className="audit-stats"><AuditStat value="1" label="Batch" /><AuditStat value="15" label="Визитов" /><AuditStat value="30" label="Allocations" /><AuditStat value="1 500 ₽" label="Общий сервисный сбор" /></div>
      <AuditSection title="Источники и состояния allocations"><AuditTable headers={["Показатель", "Основной", "Бонусный", "Итого"]} rows={[["Исходный внутренний резерв", "950 ₽", "550 ₽", "1 500 ₽"], ["Освобождено", "900 ₽", "500 ₽", "1 400 ₽"], ["Спорный визит", "50 ₽", "50 ₽", "100 ₽"]]} /></AuditSection>
      <AuditSection title="Спор по визиту"><div className="audit-alert" data-audit-card><strong>Визит 8 · 05.08.2026 · 14:00–16:00</strong><p>Открыт спор. Две allocations остаются в состоянии disputed и не закрываются автоматической сверкой.</p><button type="button">Открыть решение</button></div></AuditSection>
      <AuditSection title="Автоматическая сверка"><div className="detail-grid audit-reconciliation" data-audit-card><span>Последнее успешное выполнение</span><strong>30.07.2026, 12:15</strong><span>Проверено / закрыто</span><strong>15 / 14</strong><span>Пропущено спорных</span><strong>1</strong><span>Следующее выполнение</span><strong>30.07.2026, 12:30</strong></div><button type="button">Сверить визиты вручную</button></AuditSection>
      <AuditSection title="Визиты"><VisitTable /></AuditSection>
    </>
  );
}

function VisitCards({ compact = false }: { compact?: boolean }) {
  const rows = compact ? visits.slice(0, 3) : visits;
  return <div className="audit-visit-cards">{rows.map((visit) => <article key={visit.id} data-audit-card><strong>{visit.day} · {visit.date}</strong><span>{visit.start}–{visit.end}</span><span>{durationLabel(visit.minutes)}</span><b>{money(visit.price)}</b></article>)}</div>;
}

function VisitTable() {
  return <AuditTable headers={["Визит", "Дата", "Время", "Длительность", "Стоимость помощи"]} rows={visits.map((visit, index) => [String(index + 1), visit.date, `${visit.start}–${visit.end}`, durationLabel(visit.minutes), money(visit.price)])} />;
}

function PeriodTotals({ role }: { role: "client" | "performer" }) {
  return <div className="audit-period-totals" data-audit-card><div><span>Визитов</span><strong>15</strong></div><div><span>Общая продолжительность</span><strong>30 часов</strong></div><div><span>Стоимость помощи</span><strong>{money(totalHelp)}</strong></div><div><span>Сервисный сбор {role === "client" ? "Заказчика" : "Помощника"}</span><strong>750 ₽</strong></div>{role === "client" && <div><span>Ориентир общих расходов Заказчика</span><strong>{money(totalHelp + 750)}</strong></div>}</div>;
}

function AuditHero({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <section className="audit-hero" data-audit-card><div><span>{eyebrow}</span><h1>{title}</h1><p>{text}</p></div></section>; }
function AuditStep({ number, title, children }: { number: string; title: string; children: ReactNode }) { return <section className="audit-section audit-workflow-step" data-audit-card><header><h2><span>{number}</span>{title}</h2></header>{children}</section>; }
function AuditSection({ title, children }: { title: string; children: ReactNode }) { return <section className="audit-section"><header><h2>{title}</h2></header>{children}</section>; }
function AuditField({ label, value }: { label: string; value: string }) { return <label className="audit-field"><span>{label}</span><input value={value} readOnly /></label>; }
function AuditError({ field, children }: { field: string; children: ReactNode }) { return <p className="field-error-text" data-audit-field-error={field} tabIndex={-1}>{children}</p>; }
function AuditStat({ value, label }: { value: string; label: string }) { return <article className="audit-stat" data-audit-card><strong>{value}</strong><span>{label}</span></article>; }
function AuditTable({ headers, rows }: { headers: string[]; rows: string[][] }) { return <div className="audit-table-wrap" data-audit-table><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td data-label={headers[cellIndex]} key={`${cell}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>; }
function durationLabel(minutes: number) { return `${minutes / 60} ${minutes === 60 ? "час" : "часа"}`; }
function money(value: number) { return `${value.toLocaleString("ru-RU")} ₽`; }
