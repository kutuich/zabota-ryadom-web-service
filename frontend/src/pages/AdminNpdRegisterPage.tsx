import { Check, Clipboard, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import type { NpdRegisterResponse, NpdStatus, NpdTaxRegisterEntry } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";

type PeriodPreset = "today" | "yesterday" | "seven_days" | "custom";

export function AdminNpdRegisterPage() {
  const initialRange = rangeForPreset("seven_days");
  const [preset, setPreset] = useState<PeriodPreset>("seven_days");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [register, setRegister] = useState<NpdRegisterResponse | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(nextFrom = from, nextTo = to) {
    setIsLoading(true);
    setError("");
    try {
      const payload = await api.getAdminNpdRegister(nextFrom, nextTo);
      setRegister(payload);
      setComments(Object.fromEntries(payload.days.flatMap((day) => day.entries.map((entry) => [entry.id, entry.npdComment ?? ""]))));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить реестр «Мой налог».");
    } finally {
      setIsLoading(false);
    }
  }

  function applyPreset(nextPreset: Exclude<PeriodPreset, "custom">) {
    const range = rangeForPreset(nextPreset);
    setPreset(nextPreset);
    setFrom(range.from);
    setTo(range.to);
    void load(range.from, range.to);
  }

  async function updateEntry(entry: NpdTaxRegisterEntry, npdStatus?: NpdStatus) {
    setUpdatingId(entry.id);
    setError("");
    setNotice("");
    try {
      await api.updateAdminNpdRegisterEntry(entry.id, {
        npdStatus,
        npdComment: comments[entry.id]?.trim() || null
      });
      setNotice("Статус реестра обновлён.");
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Не удалось обновить операцию.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function copyEntry(entry: NpdTaxRegisterEntry) {
    try {
      await navigator.clipboard.writeText(entry.copyText);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((current) => current === entry.id ? null : current), 1800);
    } catch {
      setError("Не удалось скопировать текст.");
    }
  }

  useEffect(() => {
    void load(initialRange.from, initialRange.to);
  }, []);

  return (
    <div className="list npd-register-page">
      <section className="plain-section">
        <div className="card__head">
          <div>
            <h2>Мой налог</h2>
            <p className="privacy-note">В реестре отображаются только реальные поступления через T-Bank и реальные возвраты, зафиксированные администратором после выполнения возврата в банке. Mock-платежи, бонусы и ручные корректировки баланса в реестр не попадают.</p>
            <p className="privacy-note">Данные в ФНС автоматически не отправляются.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={isLoading}>
            <RefreshCcw size={18} /> Обновить
          </button>
        </div>
        <div className="toolbar npd-period-toolbar">
          <button type="button" className={preset === "today" ? "primary-button" : "secondary-button"} onClick={() => applyPreset("today")}>Сегодня</button>
          <button type="button" className={preset === "yesterday" ? "primary-button" : "secondary-button"} onClick={() => applyPreset("yesterday")}>Вчера</button>
          <button type="button" className={preset === "seven_days" ? "primary-button" : "secondary-button"} onClick={() => applyPreset("seven_days")}>Последние 7 дней</button>
          <label>Дата с<input type="date" value={from} onChange={(event) => { setPreset("custom"); setFrom(event.target.value); }} /></label>
          <label>Дата по<input type="date" value={to} onChange={(event) => { setPreset("custom"); setTo(event.target.value); }} /></label>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={!from || !to}>Применить</button>
        </div>
        {error && <p className="notice notice--danger">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
      </section>

      {register && <Totals title="Итоги периода" totals={register.totals} />}
      {isLoading && <p>Загрузка реестра...</p>}
      {!isLoading && register?.days.length === 0 && <EmptyState title="Операций за выбранный период нет." />}

      {register?.days.map((day) => (
        <section className="plain-section npd-day" key={day.date} data-npd-day={day.date}>
          <h2>{formatDay(day.date)}</h2>
          <Totals title="Итоги дня" totals={day.totals} compact />
          <div className="list" data-audit-table>
            {day.entries.map((entry) => (
              <NpdEntry
                key={entry.id}
                entry={entry}
                comment={comments[entry.id] ?? ""}
                onComment={(value) => setComments((current) => ({ ...current, [entry.id]: value }))}
                onUpdate={(status) => void updateEntry(entry, status)}
                onSaveComment={() => void updateEntry(entry)}
                onCopy={() => void copyEntry(entry)}
                isUpdating={updatingId === entry.id}
                isCopied={copiedId === entry.id}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Totals({ title, totals, compact = false }: { title: string; totals: NpdRegisterResponse["totals"]; compact?: boolean }) {
  return (
    <section className={compact ? "npd-totals npd-totals--compact" : "plain-section npd-totals"}>
      <h3>{title}</h3>
      <div className="panel-grid">
        <div className="metric"><span>Оплат</span><strong>{totals.paymentsCount}</strong><small>{totals.paymentsAmount} ₽</small></div>
        <div className="metric"><span>Возвратов</span><strong>{totals.refundsCount}</strong><small>{totals.refundsAmount} ₽</small></div>
        <div className="metric"><span>Чистый итог</span><strong>{totals.netAmount} ₽</strong></div>
        <div className="metric"><span>Ожидает отражения</span><strong>{totals.pendingCount}</strong></div>
        <div className="metric"><span>Отражено</span><strong>{totals.recordedCount}</strong></div>
        <div className="metric"><span>Требует проверки</span><strong>{totals.needsReviewCount}</strong></div>
      </div>
    </section>
  );
}

function NpdEntry({
  entry,
  comment,
  onComment,
  onUpdate,
  onSaveComment,
  onCopy,
  isUpdating,
  isCopied
}: {
  entry: NpdTaxRegisterEntry;
  comment: string;
  onComment: (value: string) => void;
  onUpdate: (status: NpdStatus) => void;
  onSaveComment: () => void;
  onCopy: () => void;
  isUpdating: boolean;
  isCopied: boolean;
}) {
  const payment = entry.paymentTransaction ?? entry.refundTransaction?.payment;
  const hasRefund = Boolean(entry.paymentTransaction?.refunds.length);
  return (
    <article className="card npd-entry" data-npd-operation={entry.operationType}>
      <div className="card__head">
        <div>
          <p className="eyebrow">{formatDateTimeRu(entry.operationDate)}</p>
          <h3>{operationLabel(entry)}</h3>
        </div>
        <div className="condition-row">
          <StatusBadge tone="success">Реальная операция</StatusBadge>
          <StatusBadge tone={statusTone(entry.npdStatus)}>{statusLabel(entry.npdStatus)}</StatusBadge>
        </div>
      </div>
      <div className="detail-grid">
        <span>Заказчик</span><strong>{entry.user.displayName}</strong>
        <span>Сумма</span><strong>{entry.amount > 0 ? "+" : ""}{entry.amount} ₽</strong>
        <span>Источник</span><strong>{sourceLabel(entry.source)}</strong>
        <span>Payment ID</span><strong>{payment?.providerPaymentId ?? payment?.id ?? "не указан"}</strong>
        <span>Order ID</span><strong>{payment?.orderId ?? "не указан"}</strong>
        {entry.refundTransaction && <><span>Refund ID</span><strong>{entry.refundTransaction.providerRefundId ?? entry.refundTransaction.id}</strong></>}
      </div>
      <p>{entry.description}</p>
      <div className="npd-copy-box">
        <strong>{entry.copyText}</strong>
        <button className="secondary-button" type="button" onClick={onCopy}>
          {isCopied ? <Check size={17} /> : <Clipboard size={17} />}{isCopied ? "Текст скопирован" : "Скопировать"}
        </button>
      </div>
      {(entry.operationType === "refund" || hasRefund) && (
        <p className="notice notice--warning">
          {entry.source === "manual_bank"
            ? "Возврат выполнен вне приложения и зафиксирован администратором. Проверьте аннулирование или корректировку чека в «Мой налог»."
            : "По этой операции был возврат. Проверьте аннулирование или корректировку чека в «Мой налог»."}
        </p>
      )}
      <label className="span-full">Комментарий<textarea value={comment} maxLength={1000} onChange={(event) => onComment(event.target.value)} placeholder="Например: чек сформирован и проверен" /></label>
      <div className="npd-actions">
        <button className="primary-button" type="button" disabled={isUpdating || entry.npdStatus === "recorded"} onClick={() => onUpdate("recorded")}>Отражено в «Мой налог»</button>
        <button className="secondary-button" type="button" disabled={isUpdating || entry.npdStatus === "needs_review"} onClick={() => onUpdate("needs_review")}>Требует проверки</button>
        <button className="secondary-button" type="button" disabled={isUpdating || entry.npdStatus === "not_required"} onClick={() => onUpdate("not_required")}>Не требуется</button>
        <button className="secondary-button" type="button" disabled={isUpdating || entry.npdStatus === "pending"} onClick={() => onUpdate("pending")}>Ожидает отражения</button>
        <button className="secondary-button" type="button" disabled={isUpdating} onClick={onSaveComment}>Сохранить комментарий</button>
      </div>
    </article>
  );
}

function rangeForPreset(preset: Exclude<PeriodPreset, "custom">) {
  const today = localDateKey(new Date());
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const yesterday = shiftLocalDay(today, -1);
    return { from: yesterday, to: yesterday };
  }
  return { from: shiftLocalDay(today, -6), to: today };
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftLocalDay(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function formatDay(dateKey: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${dateKey}T12:00:00`));
}

function operationLabel(entry: NpdTaxRegisterEntry) {
  if (entry.operationType === "payment") return "Оплата через T-Bank";
  if (entry.source === "manual_bank") return "Возврат по банку";
  return "Возврат через T-Bank";
}

function sourceLabel(source: string) {
  if (source === "tbank") return "T-Bank";
  if (source === "manual_bank") return "Возврат по банку";
  return source;
}

function statusLabel(status: NpdStatus) {
  if (status === "recorded") return "Отражено в «Мой налог»";
  if (status === "not_required") return "Не требуется";
  if (status === "needs_review") return "Требует проверки";
  return "Ожидает отражения";
}

function statusTone(status: NpdStatus): "success" | "warning" | "neutral" {
  if (status === "recorded") return "success";
  if (status === "needs_review" || status === "pending") return "warning";
  return "neutral";
}
