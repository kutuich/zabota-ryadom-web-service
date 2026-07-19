import { CheckCircle2, RotateCcw, Send, Trash2, XCircle } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Chat } from "../types";
import { labelStatus, requestDisplayTitle } from "../utils/labels";
import { parsePricing } from "./PriceSummary";

export function ChatPanel({ chatId }: { chatId: string }) {
  const { user } = useAuth();
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setChat(await api.chatMessages(chatId));
  }

  useEffect(() => {
    load().catch((error) => setNotice(error.message));
  }, [chatId]);

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
    const pricing = chat.request.pricing ?? parsePricing(chat.request.pricingBreakdownJson);
    const clientFee = pricing?.clientServiceFeeAmount ?? 0;
    const agreedPayment = pricing?.performerPaymentAmount ?? chat.request.priceEstimateAmount ?? 0;
    const ok = window.confirm(
      `Вы подтверждаете помощника по заявке ${chat.request.publicNumber ?? ""}.\n\n` +
        "После подтверждения помощник получит запрос на принятие заявки в работу.\n" +
        "Деньги будут списаны только после подтверждения помощником.\n\n" +
        `Согласованная оплата за визит: ${agreedPayment} ₽.\n` +
        `Сервисный сбор заказчика: ${clientFee} ₽.\n\n` +
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
    const pricing = chat.request.pricing ?? parsePricing(chat.request.pricingBreakdownJson);
    const performerFee = pricing?.performerServiceFeeAmount ?? pricing?.performerCommissionAmount ?? chat.request.city?.defaultCommissionAmount ?? 0;
    const agreedPayment = pricing?.performerPaymentAmount ?? chat.request.priceEstimateAmount ?? 0;
    const ok = window.confirm(
      `Вы подтверждаете, что принимаете заявку ${chat.request.publicNumber ?? ""} в работу на согласованных условиях.\n\n` +
        `Согласованная оплата за визит: ${agreedPayment} ₽.\n` +
        `Сервисный сбор помощника: ${performerFee} ₽.\n` +
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

  return (
    <section className="chat-panel">
      <div className="card__head">
        <div>
          <p className="eyebrow">Чат по заявке</p>
          <h3>{requestDisplayTitle(chat.request)}</h3>
        </div>
        <span className="privacy-note">Статус: {labelStatus(chat.status)}. Телефон не раскрывается по умолчанию.</span>
      </div>
      <div className="trust-row">
        {user?.role === "client" && ["open", "waiting_client_confirmation", "waiting_performer_confirmation", "waiting_client_balance", "waiting_performer_balance"].includes(chat.status) && (
          <button className="primary-button" type="button" onClick={clientConfirm}>
            <CheckCircle2 size={18} />
            Подтвердить помощника и условия
          </button>
        )}
        {user?.role === "performer" && ["open", "waiting_client_confirmation", "waiting_performer_confirmation", "waiting_client_balance", "waiting_performer_balance"].includes(chat.status) && (
          <button className="primary-button" type="button" onClick={performerConfirm}>
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
        {user?.role === "performer" && chat.status === "not_agreed" && (
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
            {(user?.role === "admin" || user?.role === "superadmin") && message.visibility !== "deleted" && (
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
