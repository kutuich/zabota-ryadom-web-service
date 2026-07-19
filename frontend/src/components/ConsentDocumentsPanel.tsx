import { CheckCircle2, FileText, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { UserConsentStatus } from "../types";
import { formatDateRu } from "../utils/dateTime";
import { StatusBadge } from "./StatusBadge";

type Props = {
  title?: string;
  description?: string;
  onAccepted?: () => void;
};

export function ConsentDocumentsPanel({
  title = "Согласия и документы",
  description = "Здесь видны юридические документы, которые нужны для работы сервиса.",
  onAccepted
}: Props) {
  const [rows, setRows] = useState<UserConsentStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setIsLoading(true);
    setError("");
    try {
      setRows(await api.legalStatus());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить согласия");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const missingRequired = useMemo(
    () => rows.filter((row) => row.document.isRequired && row.status !== "accepted").map((row) => row.document.type),
    [rows]
  );

  async function accept(documentTypes: string[]) {
    setError("");
    setNotice("");
    try {
      setRows(await api.acceptLegalConsents(documentTypes, "profile"));
      setNotice("Согласие принято. Статус обновлён.");
      onAccepted?.();
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Не удалось принять согласие");
    }
  }

  return (
    <section className="plain-section span-2">
      <div className="card__head">
        <div>
          <p className="eyebrow">Юридический блок</p>
          <h2>{title}</h2>
        </div>
        <button className="secondary-button" type="button" onClick={load}>
          <RefreshCcw size={18} />
          Обновить
        </button>
      </div>
      <p className="privacy-note">{description}</p>
      <p className="privacy-note">Возможные статусы: Принято, Требуется, Требуется новая версия.</p>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error-text">{error}</p>}
      {missingRequired.length > 0 && (
        <button className="primary-button" type="button" onClick={() => accept(missingRequired)}>
          <CheckCircle2 size={18} />
          Принять обязательные документы
        </button>
      )}
      {isLoading ? (
        <p className="empty-text">Загрузка согласий...</p>
      ) : (
        <div className="data-table data-table--wide">
          {rows.map((row) => (
            <div className="data-row" key={row.document.id}>
              <strong>{row.document.title}</strong>
              <span>Версия {row.document.version}</span>
              <StatusBadge tone={statusTone(row.status)}>
                {statusLabel(row.status)}
              </StatusBadge>
              <span>{row.consent?.acceptedAt ? `Принято ${formatDateRu(row.consent.acceptedAt)}` : "Не принято"}</span>
              <Link className="secondary-button" to={`/legal/${row.document.slug}`} target="_blank">
                <FileText size={18} />
                Открыть
              </Link>
              {row.status !== "accepted" && (
                <button className="secondary-button" type="button" onClick={() => accept([row.document.type])}>
                  Принять текущую версию
                </button>
              )}
            </div>
          ))}
          {rows.length === 0 && <p className="empty-text">Документы пока не опубликованы.</p>}
        </div>
      )}
    </section>
  );
}

function statusLabel(status: UserConsentStatus["status"]) {
  if (status === "accepted") return "Принято";
  if (status === "required") return "Требуется";
  if (status === "needs_new_version") return "Требуется новая версия";
  if (status === "revoked") return "Отозвано";
  return "Необязательное";
}

function statusTone(status: UserConsentStatus["status"]) {
  if (status === "accepted") return "success";
  if (status === "required" || status === "needs_new_version") return "warning";
  if (status === "revoked") return "danger";
  return "neutral";
}
