import { Download, MailOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ServiceMessage } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";
import { formatFileSize } from "./ServiceMessageComposer";
import { StatusBadge } from "./StatusBadge";

export function ServiceMessagesPanel() {
  const [messages, setMessages] = useState<ServiceMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notice, setNotice] = useState("");
  async function load() { const result = await api.myServiceMessages(); setMessages(result.messages); setUnreadCount(result.unreadCount); }
  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : "Не удалось загрузить сообщения.")); }, []);
  async function open(message: ServiceMessage) { if (!message.isReadByUser) await api.readServiceMessage(message.id); await load(); }
  return <section className="plain-section service-messages-panel" data-service-messages-panel>
    <div className="card__head"><div><h2>Сообщения от сервиса</h2><p>Сервисные уведомления, объявления и документы.</p></div>{unreadCount > 0 && <StatusBadge tone="warning">Непрочитанных: {unreadCount}</StatusBadge>}</div>
    {notice && <p className="notice">{notice}</p>}
    {!messages.length && <p className="empty-text">Сообщений от сервиса пока нет.</p>}
    <div className="service-message-list">{messages.map((message) => <article className={message.isReadByUser ? "service-message-card" : "service-message-card is-unread"} key={message.id} onClick={() => void open(message)}><div className="card__head"><div><h3>{message.title || messageTypeLabel(message.messageType)}</h3><small>{formatDateTimeRu(message.createdAt)}</small></div><StatusBadge tone={message.isReadByUser ? "neutral" : "info"}>{message.isReadByUser ? "Прочитано" : "Новое"}</StatusBadge></div><p className="service-message-body">{message.body}</p>{message.relatedPayment && <p className="privacy-note">Сервисный платёж: {message.relatedPayment.amount} ₽ · {message.relatedPayment.orderId}</p>}{message.relatedRequest && <p className="privacy-note">Заявка: {message.relatedRequest.publicNumber ?? message.relatedRequest.title}</p>}{message.attachments?.map((attachment) => <button className="attachment-download" type="button" key={attachment.id} onClick={(event) => { event.stopPropagation(); void api.downloadServiceAttachment(attachment.id, attachment.originalFileName); }}><Download size={16} /><span>{attachment.originalFileName}<small>{attachmentTypeLabel(attachment.attachmentType)} · {formatFileSize(attachment.fileSize)}</small></span></button>)}{!message.isReadByUser && <button className="secondary-button" type="button" onClick={(event) => { event.stopPropagation(); void open(message); }}><MailOpen size={16} /> Отметить прочитанным</button>}</article>)}</div>
  </section>;
}

export function messageTypeLabel(type: string) { return type === "system_notice" ? "Важное уведомление" : type === "announcement" ? "Сервисное объявление" : type === "marketing_announcement" ? "Маркетинговое объявление" : "Сервисное сообщение"; }
export function attachmentTypeLabel(type: string) { return type === "npd_receipt" ? "Чек «Мой налог»" : type.includes("refund") ? "Документ по возврату" : type === "payment_receipt" ? "Документ по оплате" : type === "bank_confirmation" ? "Подтверждение банка" : type === "legal_document" ? "Юридический документ" : type === "request_document" ? "Документ по заявке" : "Вложение"; }
