import { Paperclip, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";

type PendingFile = { file: File; attachmentType: string };

export function ServiceMessageComposer({ userId, relatedPaymentTransactionId, relatedRefundTransactionId, relatedRequestId, initialTitle = "", initialBody = "", initialAttachmentType = "other", onSent }: {
  userId: string;
  relatedPaymentTransactionId?: string;
  relatedRefundTransactionId?: string;
  relatedRequestId?: string;
  initialTitle?: string;
  initialBody?: string;
  initialAttachmentType?: string;
  onSent?: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [messageType, setMessageType] = useState<"service_message" | "system_notice">("service_message");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!body.trim()) return setNotice("Введите текст сообщения.");
    setBusy(true);
    setNotice("");
    try {
      await api.sendServiceMessage(userId, {
        title: title.trim() || undefined,
        body: body.trim(),
        messageType,
        clientRequestId: requestId,
        relatedPaymentTransactionId,
        relatedRefundTransactionId,
        relatedRequestId,
        files: await Promise.all(files.map(async ({ file, attachmentType }) => ({ fileName: file.name, mimeType: file.type, fileData: await fileToDataUrl(file), attachmentType })))
      });
      setTitle("");
      setBody("");
      setFiles([]);
      setRequestId(crypto.randomUUID());
      setNotice("Сообщение отправлено и сохранено в кабинете пользователя.");
      onSent?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось отправить сообщение.");
    } finally { setBusy(false); }
  }

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const next = Array.from(selected);
    if (files.length + next.length > 5) return setNotice("К сообщению можно прикрепить не более 5 файлов.");
    if (next.some((file) => file.size > 10 * 1024 * 1024)) return setNotice("Размер каждого файла должен быть не более 10 МБ.");
    setFiles([...files, ...next.map((file) => ({ file, attachmentType: initialAttachmentType }))]);
  }

  return <section className="plain-section service-message-composer service-message-compose-card">
    <h3>Написать пользователю</h3>
    {notice && <p className="notice">{notice}</p>}
    <div className="form-grid">
      <label>Тип сообщения<select value={messageType} onChange={(event) => setMessageType(event.target.value as typeof messageType)}><option value="service_message">Сервисное сообщение</option><option value="system_notice">Важное уведомление</option></select></label>
      <label>Тема<input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="span-2">Текст сообщения<textarea maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} /></label>
      <label className="file-button span-2"><Paperclip size={17} /> Прикрепить файл<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" onChange={(event) => addFiles(event.target.files)} /></label>
      <p className="privacy-note span-2">Файлы будут сохранены в истории пользователя. До 5 файлов, до 10 МБ каждый. Разрешены PDF, изображения, DOCX и XLSX.</p>
      {files.map((item, index) => <div className="attachment-edit-row span-2" key={`${item.file.name}-${index}`}><span>{item.file.name} · {formatFileSize(item.file.size)}</span><select value={item.attachmentType} onChange={(event) => setFiles(files.map((row, rowIndex) => rowIndex === index ? { ...row, attachmentType: event.target.value } : row))}>{attachmentTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="icon-button" title="Удалить файл" onClick={() => setFiles(files.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={16} /></button></div>)}
      <button type="button" className="primary-button span-2" disabled={busy || !body.trim()} onClick={() => void submit()}><Send size={17} /> {busy ? "Отправляем" : "Отправить сообщение"}</button>
    </div>
  </section>;
}

export const attachmentTypeOptions = [
  ["npd_receipt", "Чек «Мой налог»"], ["payment_receipt", "Документ по оплате"], ["refund_statement", "Заявление на возврат"],
  ["refund_receipt", "Документ по возврату"], ["bank_confirmation", "Подтверждение банка"], ["legal_document", "Юридический документ"],
  ["request_document", "Документ по заявке"], ["other", "Другое"]
] as const;

export function formatFileSize(size: number) { return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(size / 1024))} КБ`; }

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.readAsDataURL(file);
  });
}
