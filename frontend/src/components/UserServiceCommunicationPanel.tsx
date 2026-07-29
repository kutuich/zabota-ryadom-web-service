import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ServiceMessageAttachment } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";
import { attachmentTypeLabel } from "./ServiceMessagesPanel";
import { formatFileSize, ServiceMessageComposer } from "./ServiceMessageComposer";

export function UserServiceCommunicationPanel({ userId }: { userId: string }) {
  const [attachments, setAttachments] = useState<ServiceMessageAttachment[]>([]);
  const [notice, setNotice] = useState("");
  async function load() { setAttachments((await api.serviceConversation(userId)).attachments); }
  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : "Не удалось загрузить историю.")); }, [userId]);
  return <div className="list user-service-communication"><ServiceMessageComposer userId={userId} onSent={() => void load()} /><section className="plain-section"><h3>Документы и вложения</h3>{notice && <p className="notice">{notice}</p>}{!attachments.length && <p className="empty-text">Документы пока не прикреплялись.</p>}<div className="data-table">{attachments.map((attachment) => <div className="data-row" key={attachment.id}><span>{formatDateTimeRu(attachment.createdAt)}</span><strong>{attachment.originalFileName}</strong><span>{attachmentTypeLabel(attachment.attachmentType)}</span><span>{formatFileSize(attachment.fileSize)}</span><span>{attachment.uploadedBy?.displayName ?? "Администратор"}</span><button type="button" className="secondary-button" onClick={() => void api.downloadServiceAttachment(attachment.id, attachment.originalFileName)}><Download size={16} /> Скачать</button></div>)}</div></section></div>;
}
