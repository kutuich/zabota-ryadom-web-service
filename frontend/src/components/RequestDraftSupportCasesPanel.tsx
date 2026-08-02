import { RefreshCcw, Send, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { RequestDraftSupportCase } from "../types";

const statusOptions: Array<[RequestDraftSupportCase["status"], string]> = [
  ["new", "Новое"], ["in_progress", "В работе"], ["waiting_for_client", "Ожидает Заказчика"], ["resolved", "Решено"], ["closed", "Закрыто"]
];

export function RequestDraftSupportCasesPanel() {
  const [cases, setCases] = useState<RequestDraftSupportCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const selected = useMemo(() => cases.find((item) => item.id === selectedId) ?? cases[0] ?? null, [cases, selectedId]);

  async function load() {
    setLoading(true);
    try {
      const rows = await api.draftSupportCases();
      setCases(rows);
      if (selectedId && !rows.some((item) => item.id === selectedId)) setSelectedId(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить обращения.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function sendReply() {
    if (!selected || !reply.trim()) return;
    await api.replyDraftSupportCase(selected.id, reply.trim());
    setReply(""); setNotice("Ответ отправлен Заказчику."); await load();
  }

  async function changeStatus(next: RequestDraftSupportCase["status"]) {
    if (!selected) return;
    await api.updateDraftSupportCase(selected.id, next);
    setNotice("Статус обращения обновлён."); await load();
  }

  return <section className="request-support-workspace">
    <div className="section-heading"><div><h2>Запросы помощи по заявкам</h2><p>Ответы привязаны к черновику. Данные заявки доступны сотруднику только для просмотра.</p></div><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCcw size={17} />Обновить</button></div>
    {notice && <p className="notice">{notice}</p>}
    <label className="request-support-filter">Статус<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Все статусы</option>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {loading ? <p>Загрузка обращений...</p> : cases.length === 0 ? <p className="empty-state">Запросов помощи пока нет.</p> : <div className="request-support-layout">
      <div className="request-support-list">{cases.filter((item) => !status || item.status === status).map((item) => <button key={item.id} type="button" className={selected?.id === item.id ? "request-support-list__item is-active" : "request-support-list__item"} onClick={() => setSelectedId(item.id)}><strong>{item.publicNumber}</strong><span>{item.subject}</span><small>{item.client?.displayName ?? "Заказчик"} · {supportStatus(item.status)}</small><time>{new Date(item.updatedAt).toLocaleString("ru-RU")}</time></button>)}</div>
      {selected && <article className="request-support-detail">
        <div className="section-heading"><div><span className="status-badge">{supportStatus(selected.status)}</span><h3>{selected.subject}</h3><p>{selected.publicNumber} · редакция черновика {selected.draftRevisionAtCreation}</p></div><button className="secondary-button" type="button" onClick={async () => { await api.assignDraftSupportCase(selected.id); setNotice("Обращение назначено вам."); await load(); }}><UserRoundCheck size={17} />Назначить себе</button></div>
        <dl className="request-support-summary"><div><dt>Заказчик</dt><dd>{selected.client?.displayName ?? "не указан"}</dd></div><div><dt>Черновик</dt><dd>{selected.draft?.title ?? "Без названия"}</dd></div><div><dt>Город</dt><dd>{String((selected.draft?.formData as any)?.cityName ?? "указан в черновике")}</dd></div><div><dt>Текущая редакция</dt><dd>{selected.draft?.revision ?? selected.draftRevisionAtCreation}</dd></div></dl>
        <details className="request-support-snapshot"><summary>Данные черновика на текущий момент</summary><p><strong>Выбранные узлы:</strong> {selected.draft?.selectedNodeSlugs.join(", ") || "не выбраны"}</p><pre>{JSON.stringify(selected.draft?.formData ?? {}, null, 2)}</pre></details>
        <section className="request-support-history"><h4>История сообщений</h4>{selected.messages?.map((message) => <article key={message.id}><strong>{message.senderRole === "client" ? "Заказчик" : "Сотрудник сервиса"}</strong><time>{new Date(message.createdAt).toLocaleString("ru-RU")}</time><p>{message.body}</p></article>)}</section>
        <label>Ответ Заказчику<textarea value={reply} maxLength={5000} onChange={(event) => setReply(event.target.value)} /></label><div className="button-row"><button className="primary-button" type="button" disabled={!reply.trim()} onClick={() => void sendReply()}><Send size={17} />Отправить ответ</button><select aria-label="Статус обращения" value={selected.status} onChange={(event) => void changeStatus(event.target.value as RequestDraftSupportCase["status"])}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </article>}
    </div>}
  </section>;
}

function supportStatus(status: RequestDraftSupportCase["status"]) { return statusOptions.find(([value]) => value === status)?.[1] ?? status; }
