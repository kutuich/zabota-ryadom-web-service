import { ArrowLeft, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import type { LegalDocument } from "../types";
import { formatDateRu } from "../utils/dateTime";

const publicLegalLinks = [
  { path: "/legal/privacy", label: "Политика обработки персональных данных" },
  { path: "/legal/personal-data-consent", label: "Согласие на обработку персональных данных" },
  { path: "/legal/customer-agreement", label: "Пользовательское соглашение заказчика" },
  { path: "/legal/helper-terms", label: "Условия использования сервиса помощником" },
  { path: "/legal/service-notifications-consent", label: "Согласие на получение сервисных уведомлений" },
  { path: "/legal/marketing-notifications-consent", label: "Согласие на получение информационных сообщений" },
  { path: "/legal/helper-documents-consent", label: "Согласие на загрузку, хранение и проверку документов помощника" },
  { path: "/legal/service-rules", label: "Правила сервиса и запрещённые услуги" }
] as const;

export function LegalIndexPage() {
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.legalDocuments().then(setDocuments).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить документы");
    });
  }, []);

  return (
    <main className="public-page">
      <section className="plain-section public-page__inner">
        <Link className="link-button" to="/">
          <ArrowLeft size={16} />
          На страницу входа
        </Link>
        <div className="card__head">
          <div>
            <p className="eyebrow">Юридическая информация</p>
            <h1>Документы сервиса «Забота Рядом»</h1>
          </div>
        </div>
        <p className="privacy-note">
          Здесь опубликованы актуальные версии правил, соглашений и согласий, которые используются при регистрации и в личном кабинете.
        </p>
        {error && <p className="error-text">{error}</p>}
        <div className="list" aria-label="Юридические документы">
          {publicLegalLinks.map((item) => {
            const slug = item.path.split("/").at(-1);
            const document = documents.find((candidate) => candidate.slug === slug);

            return (
              <article className="card" key={item.path}>
                <div className="knowledge-title-row">
                  <h2>{item.label}</h2>
                  {document ? (
                    <StatusBadge tone={document.isRequired ? "warning" : "neutral"}>
                      {document.isRequired ? "Обязательный" : "Добровольный"}
                    </StatusBadge>
                  ) : null}
                </div>
                {document ? (
                  <div className="detail-grid detail-grid--compact">
                    <span>Версия</span><strong>{document.version}</strong>
                    <span>Для кого</span><strong>{legalScopeLabel(document.roleScope)}</strong>
                    <span>Обязательный</span><strong>{document.isRequired ? "Да" : "Нет"}</strong>
                    <span>Дата публикации</span><strong>{document.publishedAt ? formatDateRu(document.publishedAt) : "не опубликован"}</strong>
                  </div>
                ) : null}
                <Link className="secondary-button" to={item.path}>
                  <FileText size={18} />
                  Открыть
                </Link>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export function LegalDocumentPage() {
  const { slug: routeSlug } = useParams();
  const location = useLocation();
  const slug = routeSlug ?? location.pathname.split("/").filter(Boolean).at(-1);
  const [document, setDocument] = useState<LegalDocument | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    api.legalDocument(slug).then(setDocument).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить документ");
    });
  }, [slug]);

  const paragraphs = useMemo(() => renderMarkdownBlocks(document?.contentMarkdown ?? ""), [document?.contentMarkdown]);

  return (
    <main className="public-page">
      <section className="plain-section public-page__inner">
        <Link className="link-button" to="/legal">
          <ArrowLeft size={16} />
          Назад к юридическим документам
        </Link>
        {error && <p className="error-text">{error}</p>}
        {!document && !error ? (
          <EmptyState title="Загрузка документа..." />
        ) : document ? (
          <>
            <div className="card__head">
              <div>
                <p className="eyebrow">Версия {document.version}</p>
                <h1>{document.title}</h1>
                <p className="privacy-note">
                  Дата публикации: {document.publishedAt ? formatDateRu(document.publishedAt) : "не опубликован"}
                </p>
              </div>
              <StatusBadge tone="success">Актуальная версия</StatusBadge>
            </div>
            <article className="legal-document">
              {paragraphs.map((block, index) => block.kind === "heading" ? (
                <h2 key={index}>{block.text}</h2>
              ) : (
                <p key={index}>{block.text}</p>
              ))}
            </article>
          </>
        ) : null}
      </section>
    </main>
  );
}

function legalScopeLabel(scope: string) {
  if (scope === "customer") return "Заказчики";
  if (scope === "helper") return "Помощники";
  if (scope === "admin") return "Администраторы";
  return "Все пользователи";
}

function renderMarkdownBlocks(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith("#")) {
        return { kind: "heading", text: block.replace(/^#+\s*/, "") };
      }
      return { kind: "paragraph", text: block.replace(/\n/g, " ") };
    });
}
