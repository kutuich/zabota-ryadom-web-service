import { Download, FileJson, Plus, RefreshCw, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { CategoryCityStatus, CategoryImportPreview, CategoryStructure } from "../types";
import { readCategoryImportFile } from "../utils/categoryImport";
import { downloadXlsx } from "../utils/xlsx";

type Tab = "Обзор" | "Структуры" | "Города без локальной структуры" | "Импорт/экспорт" | "Версии";
type StructureStatusFilter = "working" | "active" | "draft" | "archived" | "all";
const tabs: Tab[] = ["Обзор", "Структуры", "Города без локальной структуры", "Импорт/экспорт", "Версии"];

export function AdminCategoryStructuresPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Обзор");
  const [structures, setStructures] = useState<CategoryStructure[]>([]);
  const [cities, setCities] = useState<CategoryCityStatus[]>([]);
  const [selected, setSelected] = useState<CategoryStructure | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StructureStatusFilter>("working");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPayload, setImportPayload] = useState<unknown>(null);
  const [importPreview, setImportPreview] = useState<CategoryImportPreview | null>(null);

  async function load() {
    const [structureRows, cityRows] = await Promise.all([api.adminCategoryStructures("all"), api.adminCategoryCityStatuses()]);
    setStructures(structureRows);
    setCities(cityRows);
    if (selected) {
      const replacement = structureRows.find((item) => item.id === selected.id);
      if (replacement) setSelected(replacement);
    }
  }

  useEffect(() => { load().catch(showError); }, []);

  const missingCities = cities.filter((item) => item.status !== "local_ready");
  const filteredStructures = structures.filter((item) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query || [item.title, item.scopeRegion?.name, item.scopeCity?.name, item.versionNumber].some((value) => value?.toLocaleLowerCase().includes(query));
    const matchesStatus = statusFilter === "working" ? ["active", "draft"].includes(item.status) : statusFilter === "all" ? true : item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const counts = useMemo(() => ({
    federal: structures.filter((item) => item.scopeType === "federal").length,
    region: structures.filter((item) => item.scopeType === "region").length,
    city: structures.filter((item) => item.scopeType === "city").length,
    regionFallback: cities.filter((item) => item.status === "uses_region_fallback").length,
    federalFallback: cities.filter((item) => item.status === "uses_federal_fallback").length
  }), [structures, cities]);

  async function openStructure(id: string) {
    setBusy(true);
    try { setSelected(await api.adminCategoryStructure(id)); } catch (error) { showError(error); } finally { setBusy(false); }
  }

  async function createFromParent(input: { scopeType: "region" | "city"; regionId?: string; cityId?: string }) {
    setBusy(true);
    try {
      const created = await api.adminCreateCategoryStructure(input);
      setNotice("Создана новая черновая структура. Проверьте её перед публикацией.");
      await load();
      await openStructure(created.id);
      setActiveTab("Структуры");
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  async function exportStructure(item: CategoryStructure, format: "xlsx" | "json") {
    setBusy(true);
    try {
      const result = await api.adminExportCategoryStructure(item.id, format);
      format === "xlsx" ? downloadXlsx(result.fileName, result.sheets ?? []) : downloadJson(result.fileName, result.payload);
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  async function exportCity(cityId: string) {
    setBusy(true);
    try {
      const result = await api.adminExportCategoryCityTemplate(cityId);
      downloadXlsx(result.fileName, result.sheets ?? []);
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  async function exportRegion(regionId: string) {
    setBusy(true);
    try {
      const result = await api.adminExportCategoryRegionTemplate(regionId);
      downloadXlsx(result.fileName, result.sheets ?? []);
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  async function previewFile(file: File | null) {
    setImportFile(file);
    setImportPreview(null);
    setImportPayload(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setNotice("Файл больше 5 МБ.");
    setBusy(true);
    try {
      const payload = await readCategoryImportFile(file);
      const preview = await api.adminPreviewCategoryImport({ payload, fileName: file.name, fileSize: file.size });
      setImportPayload(payload);
      setImportPreview(preview);
      setNotice(preview.valid ? "Проверка завершена. Импорт создаст новую черновую версию." : "Исправьте ошибки файла перед импортом.");
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  async function createImportDraft() {
    if (!importFile || !importPayload || !importPreview?.valid) return;
    setBusy(true);
    try {
      const created = await api.adminCreateCategoryImportDraft({ payload: importPayload, fileName: importFile.name, fileSize: importFile.size });
      setNotice("Импорт завершён. Создан draft; публикация выполняется отдельно.");
      await load();
      await openStructure(created.id);
      setActiveTab("Структуры");
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  async function structureAction(action: "version" | "publish" | "archive") {
    if (!selected) return;
    setBusy(true);
    try {
      const result = action === "version"
        ? await api.adminCreateCategoryStructureVersion(selected.id, "Новая версия для безопасного редактирования")
        : action === "publish"
          ? await api.adminPublishCategoryStructure(selected.id)
          : await api.adminArchiveCategoryStructure(selected.id);
      setNotice(action === "publish" ? "Структура опубликована; предыдущая активная версия архивирована." : action === "archive" ? "Структура архивирована." : "Создана новая черновая версия.");
      await load();
      await openStructure(result.id);
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  async function updateDraft(body: Partial<Pick<CategoryStructure, "title" | "description" | "qualityStatus" | "comment">>) {
    if (!selected) return;
    setBusy(true);
    try {
      const updated = await api.adminUpdateCategoryStructure(selected.id, body);
      setNotice("Черновик структуры сохранён.");
      await load();
      await openStructure(updated.id);
    } catch (error) { showError(error); } finally { setBusy(false); }
  }

  function showError(error: unknown) { setNotice(error instanceof Error ? error.message : "Не удалось выполнить действие."); }

  function changeTab(tab: Tab) {
    setActiveTab(tab);
    setSelected(null);
    if (tab === "Структуры") setStatusFilter("working");
    if (tab === "Версии") setStatusFilter("all");
  }

  return (
    <section className="plain-section category-structures-page">
      <div className="card__head">
        <div>
          <h2>Структуры категорий</h2>
          <p>Структуры определяют направления помощи, типовые задачи, рекомендуемые цены и ограничения для регионов и городов.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => load().catch(showError)} disabled={busy}><RefreshCw size={17} /> Обновить</button>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {missingCities.length > 0 && <p className="notice">Есть города, где применяется региональная или базовая структура. Рекомендуется создать локальные структуры городов.</p>}
      <div className="segmented-control category-structure-tabs" role="tablist">
        {tabs.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} key={tab} className={activeTab === tab ? "is-active" : ""} onClick={() => changeTab(tab)}>{tab}</button>)}
      </div>

      {activeTab === "Обзор" && (
        <div className="metrics-grid">
          <Metric label="Структуры РФ" value={counts.federal} />
          <Metric label="Региональные" value={counts.region} />
          <Metric label="Городские" value={counts.city} />
          <Metric label="Без локальной структуры" value={missingCities.length} />
          <Metric label="Региональный fallback" value={counts.regionFallback} />
          <Metric label="Базовый fallback" value={counts.federalFallback} />
        </div>
      )}

      {(activeTab === "Структуры" || activeTab === "Версии") && (
        <>
          <div className="filter-bar">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по структурам" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StructureStatusFilter)}><option value="working">Рабочие: опубликованные и черновики</option><option value="active">Опубликованные</option><option value="draft">Черновики</option><option value="archived">Архивные</option><option value="all">Все, включая архивные</option></select>
          </div>
          {structures.length === 0 ? (
            <div className="empty-state"><h3>Структуры категорий пока не настроены</h3><p>Базовая структура РФ создаётся безопасным bootstrap при запуске backend.</p></div>
          ) : (
            <div className="category-structure-layout">
              <div className="category-structure-list" data-category-structure-list data-default-filter={activeTab === "Структуры" ? "working" : "versions"}>
                {filteredStructures.map((item) => <StructureRow key={item.id} item={item} showVersionHistory={activeTab === "Версии"} onOpen={() => openStructure(item.id)} onExport={exportStructure} />)}
                {filteredStructures.length === 0 && <div className="empty-state"><p>Структуры с выбранными параметрами не найдены.</p></div>}
              </div>
              {selected && <StructureDetails item={selected} busy={busy} onClose={() => setSelected(null)} onAction={structureAction} onExport={exportStructure} onUpdate={updateDraft} />}
            </div>
          )}
        </>
      )}

      {activeTab === "Города без локальной структуры" && (
        <div className="city-structure-list" data-city-structure-list>
          {missingCities.map((row) => <article className="city-structure-card" data-city-structure-card key={row.city.id}>
            <div className="city-structure-card__info"><span className="city-structure-card__eyebrow">Регион: {row.city.region}</span><h3>{row.city.name}</h3><p><strong>Что применяется:</strong> {row.effectiveStructure?.title ?? "Не настроено"} {row.effectiveStructure ? `v${row.effectiveStructure.versionNumber}` : ""}</p><p className="privacy-note">{row.message}</p></div>
            <div className="city-structure-card__status"><span>Статус</span><StatusBadge tone={row.status === "missing_structure" ? "danger" : "warning"}>{row.statusLabel}</StatusBadge></div>
            <div className="city-structure-actions">
              <ActionGroup label="Шаблоны"><button type="button" className="secondary-button" onClick={() => exportCity(row.city.id)}><Download size={15} /> Шаблон города</button>{row.region && <button type="button" className="secondary-button" onClick={() => exportRegion(row.region!.id)}>Шаблон региона</button>}</ActionGroup>
              <ActionGroup label="Создать">{row.status === "uses_federal_fallback" && row.region && <button type="button" className="secondary-button" onClick={() => createFromParent({ scopeType: "region", regionId: row.region!.id })}><Plus size={15} /> Структура региона</button>}<button type="button" className="primary-button" onClick={() => createFromParent({ scopeType: "city", cityId: row.city.id })}><Plus size={15} /> Структура города</button></ActionGroup>
              {row.effectiveStructure && <ActionGroup label="Основа"><button type="button" className="secondary-button" onClick={() => { openStructure(row.effectiveStructure!.id); setActiveTab("Структуры"); }}>Открыть основу</button></ActionGroup>}
            </div>
          </article>)}
          {missingCities.length === 0 && <div className="empty-state"><p>Все подключённые города имеют локальные структуры.</p></div>}
        </div>
      )}

      {activeTab === "Импорт/экспорт" && (
        <div className="admin-two-column">
          <section className="plain-section"><h3>Импорт новой версии</h3><p>Поддерживаются JSON и XLSX до 5 МБ. Импорт никогда не публикует структуру автоматически.</p><label className="file-button"><Upload size={18} /> Выбрать файл<input type="file" accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => previewFile(event.target.files?.[0] ?? null)} /></label>{importPreview && <ImportPreview preview={importPreview} />}<button type="button" className="primary-button" disabled={!importPreview?.valid || busy} onClick={createImportDraft}>Создать черновик</button></section>
          <section className="plain-section"><h3>Экспорт</h3><p>Откройте структуру, чтобы скачать точный JSON или Excel. В таблице городов можно скачать городской шаблон с региональным или базовым наполнением.</p><div className="button-row"><button className="secondary-button" type="button" disabled={!selected} onClick={() => selected && exportStructure(selected, "xlsx")}><Download size={17} /> Excel</button><button className="secondary-button" type="button" disabled={!selected} onClick={() => selected && exportStructure(selected, "json")}><FileJson size={17} /> JSON</button></div></section>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }

function StructureRow({ item, showVersionHistory, onOpen, onExport }: { item: CategoryStructure; showVersionHistory: boolean; onOpen: () => void; onExport: (item: CategoryStructure, format: "xlsx" | "json") => void }) {
  return <article className={item.status === "archived" ? "category-structure-row is-archived" : "category-structure-row"} data-category-structure-card data-structure-status={item.status}><div className="category-structure-row__main"><strong>{item.title}</strong><span>{scopeLabel(item)} · v{item.versionNumber}</span><small>Категорий: {item._count?.categories ?? 0}{item.publishedAt ? ` · Опубликована: ${formatDate(item.publishedAt)}` : ""}</small>{showVersionHistory && <small>Создана: {formatDate(item.createdAt)}{item.archivedAt ? ` · В архиве с: ${formatDate(item.archivedAt)}` : ""} · Источник: {item.source}{item.parentStructure ? ` · Основа: ${item.parentStructure.title} v${item.parentStructure.versionNumber}` : ""}</small>}{item.status === "archived" && <p className="category-structure-archive-note">Архивная версия сохранена для истории и не применяется пользователям.</p>}</div><div className="category-structure-row__meta"><StatusBadge tone={item.status === "active" ? "success" : item.status === "draft" ? "warning" : "neutral"}>{statusLabel(item.status)}</StatusBadge><span>Качество: {item.qualityStatus}</span></div><div className="category-structure-row__actions"><button className="secondary-button" type="button" onClick={onOpen}>Открыть</button>{showVersionHistory && <><button className="secondary-button" type="button" onClick={() => onExport(item, "xlsx")}><Download size={15} /> Excel</button><button className="secondary-button" type="button" onClick={() => onExport(item, "json")}><FileJson size={15} /> JSON</button></>}</div></article>;
}

function StructureDetails({ item, busy, onClose, onAction, onExport, onUpdate }: { item: CategoryStructure; busy: boolean; onClose: () => void; onAction: (action: "version" | "publish" | "archive") => void; onExport: (item: CategoryStructure, format: "xlsx" | "json") => void; onUpdate: (body: Partial<Pick<CategoryStructure, "title" | "description" | "qualityStatus" | "comment">>) => void }) {
  const [draft, setDraft] = useState({ title: item.title, description: item.description ?? "", qualityStatus: item.qualityStatus, comment: item.comment ?? "" });
  useEffect(() => setDraft({ title: item.title, description: item.description ?? "", qualityStatus: item.qualityStatus, comment: item.comment ?? "" }), [item.id, item.updatedAt]);
  return <section className="plain-section category-structure-details" data-open-category-structure><div className="card__head"><div><h3>{item.title}</h3><p>{scopeLabel(item)} · версия {item.versionNumber} · {statusLabel(item.status)}</p></div><div className="button-row"><button type="button" className="secondary-button" onClick={() => onExport(item, "xlsx")}><Download size={15} /> Excel</button><button type="button" className="secondary-button" onClick={() => onExport(item, "json")}><FileJson size={15} /> JSON</button><button type="button" className="secondary-button" onClick={onClose}>Свернуть</button></div></div>{item.status === "archived" && <p className="notice category-structure-archive-note">Архивная версия сохранена для истории и не применяется пользователям.</p>}<dl className="details-list"><div><dt>Качество</dt><dd>{item.qualityStatus}</dd></div><div><dt>Основа</dt><dd>{item.parentStructure ? `${item.parentStructure.title} v${item.parentStructure.versionNumber}` : "нет"}</dd></div><div><dt>Комментарий</dt><dd>{item.comment || "не указан"}</dd></div></dl>{item.status === "draft" && <form className="form-grid category-draft-form" onSubmit={(event) => { event.preventDefault(); onUpdate(draft); }}><h4 className="span-2">Редактировать draft</h4><label className="span-2">Название<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label className="span-2">Описание<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label>Качество<select value={draft.qualityStatus} onChange={(event) => setDraft({ ...draft, qualityStatus: event.target.value as CategoryStructure["qualityStatus"] })}><option value="draft">Черновик</option><option value="estimated">Оценено</option><option value="reviewed">Проверено</option><option value="tested">Протестировано</option><option value="approved">Утверждено</option></select></label><label>Комментарий<input value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} /></label><button type="submit" className="secondary-button span-2" disabled={busy}>Сохранить draft</button></form>}<div className="button-row">{["active", "archived"].includes(item.status) && <button type="button" className="primary-button" disabled={busy} onClick={() => onAction("version")}>{item.status === "archived" ? "Создать новую версию на основе этой" : "Создать новую версию"}</button>}{item.status === "draft" && <button type="button" className="primary-button" disabled={busy} onClick={() => onAction("publish")}>Опубликовать</button>}{item.status !== "archived" && <button type="button" className="secondary-button" disabled={busy} onClick={() => onAction("archive")}>Архивировать</button>}</div><div className="category-tree">{item.categories?.filter((category) => !category.parentId).map((category) => <article key={category.id} className="category-tree-item"><h4>{category.title}</h4><p>{category.descriptionForCustomer}</p><ul>{item.categories?.filter((child) => child.parentId === category.id).map((child) => <li key={child.id}>{child.title}</li>)}</ul>{category.pricingRules?.map((rule) => <p key={rule.id} className="privacy-note">Ориентир: {priceRange(rule.recommendedMinPrice, rule.recommendedMaxPrice)}. {rule.priceComment}</p>)}</article>)}</div></section>;
}

function ActionGroup({ label, children }: { label: string; children: React.ReactNode }) { return <div className="city-structure-action-group"><span>{label}</span><div className="button-row">{children}</div></div>; }

function ImportPreview({ preview }: { preview: CategoryImportPreview }) { return <div className={preview.valid ? "notice" : "error-box"}><strong>{preview.valid ? "Файл готов к импорту" : "Найдены ошибки"}</strong><p>Категорий: {preview.summary.categories ?? 0}; подкатегорий: {preview.summary.subcategories ?? 0}; задач: {preview.summary.taskTemplates ?? 0}.</p>{preview.errors.map((error) => <p key={error}>{error}</p>)}{preview.warnings.map((warning) => <p key={warning}>Предупреждение: {warning}</p>)}</div>; }

function scopeLabel(item: CategoryStructure) { return item.scopeType === "federal" ? "РФ" : item.scopeType === "region" ? `Регион: ${item.scopeRegion?.name ?? "не указан"}` : `Город: ${item.scopeCity?.name ?? "не указан"}`; }
function statusLabel(status: CategoryStructure["status"]) { return status === "active" ? "Опубликована" : status === "draft" ? "Черновик" : "Архив"; }
function formatDate(value: string) { return new Date(value).toLocaleDateString("ru-RU"); }
function priceRange(min?: number | null, max?: number | null) { if (min != null && max != null) return `${min.toLocaleString("ru-RU")}–${max.toLocaleString("ru-RU")} ₽`; if (min != null) return `от ${min.toLocaleString("ru-RU")} ₽`; return "по согласованию"; }
function downloadJson(fileName: string, payload: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
