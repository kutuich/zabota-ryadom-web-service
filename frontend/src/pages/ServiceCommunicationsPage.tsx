import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../api/client";
import { formatFileSize, ServiceMessageComposer } from "../components/ServiceMessageComposer";
import { StatusBadge } from "../components/StatusBadge";
import type { BroadcastCampaign, BroadcastPreview, ServiceConversation, ServiceConversationUser, ServiceMessage, ServiceMessageUserSearchResult } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";
import { attachmentTypeLabel, messageTypeLabel } from "../components/ServiceMessagesPanel";

type Tab = "Чаты по заявкам" | "Сервисные сообщения" | "Рассылки";

export function ServiceCommunicationsPage({ requestChats, canBroadcast }: { requestChats: ReactNode; canBroadcast: boolean }) {
  const tabs: Tab[] = canBroadcast ? ["Чаты по заявкам", "Сервисные сообщения", "Рассылки"] : ["Чаты по заявкам", "Сервисные сообщения"];
  const [tab, setTab] = useState<Tab>("Чаты по заявкам");
  return <div className="service-communications-page"><div className="segmented-control service-communication-tabs service-communications-tabs" role="tablist">{tabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} type="button" className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>{tab === "Чаты по заявкам" && requestChats}{tab === "Сервисные сообщения" && <ServiceConversationsAdmin />}{tab === "Рассылки" && canBroadcast && <BroadcastsAdmin />}</div>;
}

function ServiceConversationsAdmin() {
  const [results, setResults] = useState<ServiceMessageUserSearchResult[]>([]);
  const [selected, setSelected] = useState<{ user: ServiceConversationUser; conversation: ServiceConversation | null } | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [searching, setSearching] = useState(false);
  async function searchUsers() {
    const query = search.trim();
    if (query.length < 2) { setResults([]); setNotice("Введите минимум 2 символа."); return; }
    setSearching(true);
    try { const rows = await api.searchServiceMessageUsers(query); setResults(rows); setNotice(rows.length ? "" : "Пользователи не найдены."); } catch (error) { showError(error); } finally { setSearching(false); }
  }
  async function open(userId: string) { try { setSelected(await api.serviceConversation(userId)); } catch (error) { showError(error); } }
  function showError(error: unknown) { setNotice(error instanceof Error ? error.message : "Не удалось загрузить сервисные сообщения."); }
  const selectedCanMessage = selected ? !["archived", "pending_archive", "oauth_pending"].includes(selected.user.status) : false;
  return <div className="service-conversations-layout">
    <section className="plain-section service-communications-section service-user-search-card">
      <h2>Найти пользователя</h2>
      <form className="search-field" onSubmit={(event) => { event.preventDefault(); void searchUsers(); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя, телефон или email" /><button className="secondary-button" type="submit" disabled={searching}>{searching ? "Ищем" : "Найти"}</button></form>
      {notice && <p className="notice">{notice}</p>}
      <div className="service-user-results">{results.map((user) => <button className={selected?.user.id === user.id ? "service-user-result-card is-selected" : "service-user-result-card"} type="button" key={user.id} onClick={() => void open(user.id)}><strong>{user.displayName}</strong><span>{roleLabel(user.role)} · {user.phone || "телефон не указан"} · {user.email || "email не указан"}</span><small>{user.city ? `${user.city.name} · ` : ""}{userStatusLabel(user.status)}</small></button>)}</div>
    </section>
    {!selected && <div className="empty-state service-communications-section"><p>Найдите и выберите пользователя, чтобы отправить сервисное сообщение.</p></div>}
    {selected && <>
      <section className="plain-section service-communications-section service-selected-user-card"><div className="card__head"><div><h2>{selected.user.displayName}</h2><p>{roleLabel(selected.user.role)} · {userStatusLabel(selected.user.status)}</p></div><StatusBadge tone={selectedCanMessage ? "success" : "warning"}>{selectedCanMessage ? "Можно написать" : "Отправка ограничена"}</StatusBadge></div><div className="detail-grid"><span>Телефон</span><strong>{selected.user.phone || "не указан"}</strong><span>Email</span><strong>{selected.user.email || "не указан"}</strong><span>Город</span><strong>{selected.user.city?.name || "не указан"}</strong></div></section>
      {selectedCanMessage ? <ServiceMessageComposer userId={selected.user.id} onSent={() => void open(selected.user.id)} /> : <div className="notice service-communications-section">Для этого профиля обычная отправка сервисного сообщения недоступна.</div>}
      <section className="plain-section service-communications-section service-message-history-card"><h2>История сообщений</h2>{!selected.conversation?.messages?.length && <p className="empty-text">Сообщений этому пользователю пока нет.</p>}<div className="service-message-list">{selected.conversation?.messages?.map((message: ServiceMessage) => <article className="service-message-card" key={message.id}><div className="card__head"><div><strong>{message.title || messageTypeLabel(message.messageType)}</strong><small>{messageTypeLabel(message.messageType)} · {formatDateTimeRu(message.createdAt)}</small></div><StatusBadge tone={message.isReadByUser ? "neutral" : "info"}>{message.isReadByUser ? "Прочитано" : "Не прочитано"}</StatusBadge></div><p className="service-message-body">{message.body}</p>{message.relatedPayment && <p className="privacy-note">Сервисный платёж: {message.relatedPayment.amount} ₽ · {message.relatedPayment.orderId}</p>}{message.relatedRefund && <p className="privacy-note">Возврат: {message.relatedRefund.amount} ₽</p>}{message.relatedRequest && <p className="privacy-note">Заявка: {message.relatedRequest.publicNumber ?? message.relatedRequest.title}</p>}{message.attachments?.map((attachment) => <button className="attachment-download" type="button" key={attachment.id} onClick={() => void api.downloadServiceAttachment(attachment.id, attachment.originalFileName)}><Download size={16} /><span>{attachment.originalFileName}<small>{attachmentTypeLabel(attachment.attachmentType)} · {formatFileSize(attachment.fileSize)}</small></span></button>)}</article>)}</div></section>
    </>}
  </div>;
}

function BroadcastsAdmin() {
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([]);
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", campaignType: "service_announcement", targetRole: "all", targetCityId: "", targetRegionId: "" });
  async function load() { setCampaigns(await api.broadcasts()); }
  useEffect(() => { void load(); }, []);
  const payload = () => ({ ...form, targetCityId: form.targetCityId || undefined, targetRegionId: form.targetRegionId || undefined });
  async function makePreview() { try { setPreview(await api.broadcastPreview(payload())); setNotice(""); } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось выполнить предпросмотр."); } }
  async function saveDraft() { try { await api.createBroadcast({ ...payload(), clientRequestId: crypto.randomUUID() }); setNotice("Черновик рассылки сохранён."); setPreview(null); setConfirmed(false); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось сохранить черновик."); } }
  async function createAndSend() { if (!confirmed || !preview) return; try { const created = await api.createBroadcast({ ...payload(), clientRequestId: crypto.randomUUID() }); await api.sendBroadcast(created.campaign.id); setNotice("Рассылка отправлена и сохранена в кабинетах пользователей."); setPreview(null); setConfirmed(false); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось отправить рассылку."); } }
  async function sendSaved(id: string) { if (!window.confirm("Отправить эту рассылку выбранным пользователям?")) return; try { await api.sendBroadcast(id); setNotice("Рассылка отправлена."); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось отправить рассылку."); } }
  async function cancelSaved(id: string) { try { await api.cancelBroadcast(id); setNotice("Рассылка отменена."); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось отменить рассылку."); } }
  return <div className="broadcast-layout"><section className="plain-section service-communications-section broadcast-create-card"><h2>Создать рассылку</h2>{notice && <p className="notice">{notice}</p>}<div className="form-grid"><label>Тип<select value={form.campaignType} onChange={(event) => { setForm({ ...form, campaignType: event.target.value }); setPreview(null); }}><option value="system_notice">Важное уведомление</option><option value="service_announcement">Сервисное объявление</option><option value="marketing_announcement">Маркетинговое объявление</option></select></label><label>Получатели<select value={form.targetRole} onChange={(event) => setForm({ ...form, targetRole: event.target.value })}><option value="all">Все пользователи</option><option value="customer">Только Заказчики</option><option value="performer">Только Помощники</option><option value="manager">Только менеджеры</option></select></label><label className="span-2">Тема<input maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="span-2">Текст<textarea maxLength={5000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></label>{form.campaignType === "marketing_announcement" && <p className="warning-text span-2">Маркетинговые объявления отправляются только пользователям, которые дали согласие на маркетинговые уведомления.</p>}<p className="privacy-note span-2">Вложения в массовых рассылках пока не поддерживаются. Для отправки документа используйте индивидуальное сообщение пользователю.</p><button className="secondary-button span-2" type="button" onClick={() => void makePreview()}>Предпросмотр получателей</button>{preview && <div className="notice span-2" data-broadcast-preview><strong>Найдено: {preview.totalFound}</strong><p>Будет отправлено: {preview.willReceive}</p><p>Без согласия: {preview.skippedNoConsent}; неактивных: {preview.skippedInactive}</p></div>}<label className="checkbox-row span-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Я понимаю, что сообщение будет отправлено выбранным пользователям.</label><div className="button-row span-2"><button className="secondary-button" type="button" disabled={!form.title.trim() || !form.body.trim()} onClick={() => void saveDraft()}>Сохранить черновик</button><button className="primary-button" type="button" disabled={!confirmed || !preview || !form.title.trim() || !form.body.trim()} onClick={() => void createAndSend()}>Отправить рассылку</button></div></div></section><section className="plain-section service-communications-section broadcast-history-card"><h2>История рассылок</h2><div className="data-table">{campaigns.map((campaign) => <div className="data-row" key={campaign.id}><strong>{campaign.title}</strong><StatusBadge tone={campaign.status === "sent" ? "success" : campaign.status === "failed" ? "danger" : "neutral"}>{campaign.status}</StatusBadge><span>{formatDateTimeRu(campaign.createdAt)}</span><span>Доставлено: {campaign.deliveredCount}</span><span>Пропущено: {campaign.skippedCount}</span>{campaign.status === "draft" && <div className="button-row"><button className="secondary-button" type="button" onClick={() => void sendSaved(campaign.id)}>Отправить</button><button className="secondary-button" type="button" onClick={() => void cancelSaved(campaign.id)}>Отменить рассылку</button></div>}</div>)}</div></section></div>;
}

function roleLabel(role: string) { return role === "client" ? "Заказчик" : role === "performer" ? "Помощник" : role === "manager" ? "Менеджер" : role === "superadmin" ? "Суперадминистратор" : "Администратор"; }
function userStatusLabel(status: string) { return status === "active" ? "Активен" : status === "blocked" ? "Заблокирован" : status === "archived" ? "Архив" : status === "pending_archive" ? "Ожидает архива" : status; }
