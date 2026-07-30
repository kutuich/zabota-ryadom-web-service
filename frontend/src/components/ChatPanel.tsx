import { CheckCircle2, Pencil, RotateCcw, Save, Send, Trash2, XCircle } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Chat } from "../types";
import { labelStatus, requestDisplayTitle } from "../utils/labels";
import { parsePricing } from "./PriceSummary";
import { AgreedTermsSummary } from "./AgreedTermsSummary";
import { effectiveRoleForUser } from "../utils/authRole";

export function ChatPanel({ chatId }: { chatId: string }) {
  const { user } = useAuth();
  const effectiveRole = effectiveRoleForUser(user);
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [isEditingTerms, setIsEditingTerms] = useState(false);
  const [termsAmount, setTermsAmount] = useState("");
  const [termsDurationMinutes, setTermsDurationMinutes] = useState("");
  const [termsScheduledAt, setTermsScheduledAt] = useState("");
  const [termsComment, setTermsComment] = useState("");
  const [visitAmounts, setVisitAmounts] = useState<Record<string, string>>({});

  async function load() {
    setChat(await api.chatMessages(chatId));
  }

  useEffect(() => {
    load().catch((error) => setNotice(error.message));
  }, [chatId]);

  useEffect(() => {
    const terms = chat?.agreedTerms;
    setTermsAmount(terms ? String(terms.agreedHelperAmount) : "");
    setTermsDurationMinutes(terms?.agreedDurationMinutes ? String(terms.agreedDurationMinutes) : "");
    setTermsScheduledAt(terms?.agreedScheduledAt ? toDateTimeLocal(terms.agreedScheduledAt) : "");
    setTermsComment(terms?.agreedTermsComment ?? "");
    const pricing = chat?.request.pricing ?? parsePricing(chat?.request.pricingBreakdownJson);
    const visits = chat?.agreementVersion?.expandedVisits ?? pricing?.expandedVisits ?? [];
    setVisitAmounts(Object.fromEntries(visits.map((visit: any) => [
      visit.id,
      String(visit.agreedHelpAmount ?? visit.calculatedHelpPrice ?? visit.helpAmount ?? terms?.agreedHelperAmount ?? "")
    ])));
  }, [chat?.agreedTerms?.termsUpdatedAt, chatId]);

  async function send() {
    if (!text.trim()) return;
    try {
      const result = await api.sendMessage(chatId, text.trim());
      setText("");
      setNotice(result.moderation.warning ?? "");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка отправки");
    }
  }

  function handleMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey || event.altKey) && event.key === "Enter") {
      event.preventDefault();
      send();
    }
  }

  async function clientConfirm() {
    if (!chat) return;
    if (!chat.agreedTerms) return;
    const helpTotal = chat.agreementVersion?.totalHelpAmount ?? chat.agreedTerms.agreedHelperAmount;
    const customerFee = chat.agreementVersion?.customerServiceFeeTotal ?? chat.agreedTerms.customerServiceFeeAmount;
    const ok = window.confirm(
      `Вы подтверждаете помощника по заявке ${chat.request.publicNumber ?? ""}.\n\n` +
        "После подтверждения помощник получит запрос на принятие заявки в работу.\n" +
        "Деньги будут списаны только после подтверждения помощником.\n\n" +
        `Согласованная стоимость помощи за график: ${helpTotal} ₽.\n` +
        `Сервисный сбор Заказчика за график: ${customerFee} ₽.\n` +
        `Ориентир общих расходов Заказчика: ${helpTotal + customerFee} ₽.\n\n` +
        "Если объём или продолжительность помощи изменились, согласуйте новую сумму в чате до начала работы.\n\n" +
        "Продолжить?"
    );
    if (!ok) return;
    const updated = await api.clientConfirmChat(chat.id);
    setChat(updated);
    setNotice("Условия подтверждены заказчиком. Ожидается подтверждение помощника.");
  }

  async function performerConfirm() {
    if (!chat) return;
    if (!chat.agreedTerms) return;
    const helpTotal = chat.agreementVersion?.totalHelpAmount ?? chat.agreedTerms.agreedHelperAmount;
    const helperFee = chat.agreementVersion?.helperServiceFeeTotal ?? chat.agreedTerms.helperServiceFeeAmount;
    const ok = window.confirm(
      `Вы подтверждаете, что принимаете заявку ${chat.request.publicNumber ?? ""} в работу на согласованных условиях.\n\n` +
        `Согласованная стоимость помощи за график: ${helpTotal} ₽.\n` +
        `Сервисный сбор Помощника за график: ${helperFee} ₽.\n` +
        "Оплата помощи производится Заказчиком напрямую.\n" +
        "Сервисный сбор оплачивается Помощником сервису отдельно со внутреннего баланса.\n" +
        "После подтверждения заявка перейдёт в статус “В работе”.\n\nПодтвердить?"
    );
    if (!ok) return;
    const updated = await api.performerConfirmChat(chat.id);
    setChat(updated);
    setNotice(
      updated.status === "in_work"
        ? "Заявка перешла в работу. Сервисные сборы списаны с обеих сторон."
        : `Статус обновлён: ${labelStatus(updated.status)}.`
    );
  }

  async function notAgreed() {
    if (!chat) return;
    if (!window.confirm("Перенести чат в архив как “Не согласовано”? Деньги списываться не будут, заявка останется доступной.")) return;
    const updated = await api.markChatNotAgreed(chat.id);
    setChat(updated);
    setNotice("Чат перенесён в архив, заявка остаётся активной.");
  }

  async function proposeNewTerms() {
    if (!chat) return;
    const updated = await api.proposeNewTerms(chat.id);
    setChat(updated);
    setNotice("Новое предложение отправлено заказчику.");
  }

  async function saveTerms() {
    if (!chat) return;
    const pricing = chat.request.pricing ?? parsePricing(chat.request.pricingBreakdownJson);
    const sourceVisits = chat.agreementVersion?.expandedVisits ?? pricing?.expandedVisits ?? [];
    const agreedVisits: Array<{ visitId: string; amount: number }> = sourceVisits.map((visit: any) => ({ visitId: visit.id, amount: Number(visitAmounts[visit.id]) }));
    if (agreedVisits.some((visit: { visitId: string; amount: number }) => !Number.isInteger(visit.amount) || visit.amount <= 0 || visit.amount > 100_000)) {
      setNotice("Укажите стоимость от 1 до 100 000 ₽ для каждого визита.");
      return;
    }
    const agreedHelperAmount = agreedVisits.length ? agreedVisits[0].amount : Number(termsAmount);
    if (!Number.isInteger(agreedHelperAmount) || agreedHelperAmount <= 0 || agreedHelperAmount > 100_000) {
      setNotice("Укажите сумму помощи от 1 до 100 000 ₽.");
      return;
    }
    try {
      const updated = await api.updateChatTerms(chat.id, {
        agreedHelperAmount,
        agreedVisits: agreedVisits.length ? agreedVisits : undefined,
        agreedPackageId: pricing?.packageId ?? null,
        agreedAddons: pricing?.addons?.map((addon) => addon.id) ?? [],
        agreedDurationMinutes: termsDurationMinutes ? Number(termsDurationMinutes) : null,
        agreedScheduledAt: termsScheduledAt ? new Date(termsScheduledAt).toISOString() : null,
        agreedTermsComment: termsComment.trim() || null
      });
      setChat(updated);
      setIsEditingTerms(false);
      setNotice("Условия сохранены. Подтверждения обеих сторон нужно выполнить заново.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось сохранить условия");
    }
  }

  async function deleteMessage(messageId: string) {
    if (!chat || !window.confirm("Удалить сообщение? Это действие будет записано в журнал.")) return;
    try {
      const updated = await api.adminDeleteChatMessage(chat.id, messageId);
      setChat(updated);
      setNotice("Сообщение удалено администратором.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось удалить сообщение");
    }
  }

  if (!chat) return <p className="empty-text">Чат загружается...</p>;
  const pricing = chat.request.pricing ?? parsePricing(chat.request.pricingBreakdownJson);
  const editableVisits = chat.agreementVersion?.expandedVisits ?? pricing?.expandedVisits ?? [];
  const previewAmount = editableVisits.length
    ? editableVisits.reduce((sum, visit) => sum + Number(visitAmounts[visit.id] ?? 0), 0)
    : Number(termsAmount);
  const hasTermsPreview = Number.isInteger(previewAmount) && previewAmount > 0 && previewAmount <= 100_000;

  return (
    <section className="chat-panel">
      <div className="card__head">
        <div>
          <p className="eyebrow">Чат по заявке</p>
          <h3>{requestDisplayTitle(chat.request)}</h3>
        </div>
        <span className="privacy-note">Статус: {labelStatus(chat.status)}. Телефон не раскрывается по умолчанию.</span>
      </div>
      {chat.agreedTerms ? (
        <>
          <AgreedTermsSummary terms={chat.agreedTerms} agreementVersion={chat.agreementVersion} />
          {chat.agreementVersion && (
            <section className="details-box stack agreement-schedule">
              <h4>Согласованный график · версия {chat.agreementVersion.version}</h4>
              <p>{chat.agreementVersion.visitCount} визитов, {formatDuration(chat.agreementVersion.totalDurationMinutes)}.</p>
              <p>Сервисный сбор Заказчика за график: {formatRubles(chat.agreementVersion.customerServiceFeeTotal)} ₽.</p>
              <p>Сервисный сбор Помощника за график: {formatRubles(chat.agreementVersion.helperServiceFeeTotal)} ₽.</p>
              <div className="agreement-visit-list">
                {chat.agreementVersion.expandedVisits.map((visit) => (
                  <div key={`${visit.sequence}:${visit.date}:${visit.startTime}`}>
                    <strong>Визит {visit.sequence}</strong>
                    <span>{new Date(`${visit.date}T00:00:00`).toLocaleDateString("ru-RU")} · {visit.startTime}–{visit.endTime} · {formatDuration(visit.durationMinutes)} · {formatRubles(visit.agreedHelpAmount ?? 0)} ₽</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <p className="notice">Сначала согласуйте и сохраните стоимость помощи.</p>
      )}
      {(effectiveRole === "client" || effectiveRole === "performer") && canEditTerms(chat) && (
        <div className="stack">
          <button className="secondary-button" type="button" onClick={() => setIsEditingTerms((current) => !current)}>
            <Pencil size={18} />
            Изменить условия
          </button>
          {isEditingTerms && (
            <section className="details-box stack">
              <h4>Условия заявки</h4>
              <div className="auth-form-grid">
                {editableVisits.length === 0 && (
                  <label>
                    Сумма помощи Помощника, ₽
                    <input type="number" min="1" max="100000" step="1" value={termsAmount} onChange={(event) => setTermsAmount(event.target.value)} />
                  </label>
                )}
                <label>
                  Длительность, минут
                  <input type="number" min="15" max="1440" step="15" value={termsDurationMinutes} onChange={(event) => setTermsDurationMinutes(event.target.value)} />
                </label>
                <label>
                  Дата и время
                  <input type="datetime-local" value={termsScheduledAt} onChange={(event) => setTermsScheduledAt(event.target.value)} />
                </label>
              </div>
              {editableVisits.length > 0 && (
                <div className="agreement-visit-prices">
                  <h4>Стоимость каждого визита</h4>
                  {editableVisits.map((visit: any) => (
                    <label key={visit.id}>
                      <span>Визит {visit.sequence}: {visit.date}, {visit.startTime}–{visit.endTime}</span>
                      <input type="number" min="1" max="100000" step="1" value={visitAmounts[visit.id] ?? ""} onChange={(event) => setVisitAmounts((current) => ({ ...current, [visit.id]: event.target.value }))} />
                    </label>
                  ))}
                </div>
              )}
              <label>
                Комментарий условий
                <textarea maxLength={1000} value={termsComment} onChange={(event) => setTermsComment(event.target.value)} />
              </label>
              {hasTermsPreview && (
                <div className="notice">
                  <p>{editableVisits.length ? `Итог стоимости помощи по графику: ${formatRubles(previewAmount)} ₽.` : `Согласованная стоимость помощи: ${formatRubles(previewAmount)} ₽.`}</p>
                  <p>Сервисный сбор каждой стороны: 50 ₽ за каждый согласованный визит.</p>
                  <p>Оплата помощи производится напрямую между сторонами; сервисные сборы оплачиваются отдельно.</p>
                </div>
              )}
              <button className="primary-button" type="button" onClick={saveTerms}>
                <Save size={18} />
                Сохранить условия
              </button>
            </section>
          )}
        </div>
      )}
      <div className="trust-row">
        {effectiveRole === "client" && ["open", "waiting_client_confirmation", "waiting_performer_confirmation", "waiting_client_balance", "waiting_performer_balance"].includes(chat.status) && (
          <button className="primary-button" type="button" onClick={clientConfirm} disabled={!chat.agreedTerms}>
            <CheckCircle2 size={18} />
            Подтвердить помощника и условия
          </button>
        )}
        {effectiveRole === "performer" && ["open", "waiting_client_confirmation", "waiting_performer_confirmation", "waiting_client_balance", "waiting_performer_balance"].includes(chat.status) && (
          <button className="primary-button" type="button" onClick={performerConfirm} disabled={!chat.agreedTerms}>
            <CheckCircle2 size={18} />
            Принять заявку в работу
          </button>
        )}
        {["open", "waiting_client_confirmation", "waiting_performer_confirmation", "waiting_client_balance", "waiting_performer_balance"].includes(chat.status) && (
          <button className="secondary-button" type="button" onClick={notAgreed}>
            <XCircle size={18} />
            Не согласовано
          </button>
        )}
        {effectiveRole === "performer" && chat.status === "not_agreed" && (
          <button className="secondary-button" type="button" onClick={proposeNewTerms}>
            <RotateCcw size={18} />
            Предложить новые условия
          </button>
        )}
      </div>
      <div className="messages">
        {chat.messages.map((message) => (
          <div key={message.id} className={message.isHidden ? "message message--hidden" : "message"}>
            <strong>{message.isSystem ? "Сервис «Забота Рядом»" : message.sender?.displayName ?? "Пользователь"}</strong>
            <p>{message.text}</p>
            {message.isHidden && (
              <small>
                Не передавайте телефон, ссылки, данные банковских карт и коды из SMS. Общение по заявке ведётся внутри сервиса.
              </small>
            )}
            {message.moderationStatus !== "clean" && !message.isHidden && <small>{labelStatus(message.moderationStatus)}</small>}
            {(effectiveRole === "admin" || effectiveRole === "superadmin") && message.visibility !== "deleted" && (
              <button className="secondary-button secondary-button--small" type="button" onClick={() => deleteMessage(message.id)}>
                <Trash2 size={16} />
                Удалить
              </button>
            )}
          </div>
        ))}
        {chat.messages.length === 0 && <p className="empty-text">Сообщений пока нет.</p>}
      </div>
      <div className="chat-input chat-input--stacked">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleMessageKeyDown}
          placeholder="Сообщение"
        />
        <button className="primary-button" type="button" onClick={send}>
          <Send size={18} />
          Отправить
        </button>
        <small className="privacy-note">Enter — новая строка, Cmd/Ctrl/Alt + Enter — отправить.</small>
      </div>
      {notice && <p className="notice">{notice}</p>}
    </section>
  );
}

function canEditTerms(chat: Chat) {
  return !chat.agreementFinalizedAt && !chat.archivedAt && !["in_work", "completed", "cancelled", "archived"].includes(chat.status);
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} ч` : "", rest ? `${rest} мин` : ""].filter(Boolean).join(" ");
}

function formatRubles(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}
