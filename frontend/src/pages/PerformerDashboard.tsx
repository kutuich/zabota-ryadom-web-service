import { MessageCircle, Search, Star, Upload } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { BalancePanel } from "../components/BalancePanel";
import { ChatPanel } from "../components/ChatPanel";
import { ConsentDocumentsPanel } from "../components/ConsentDocumentsPanel";
import { ContactDetails } from "../components/ContactDetails";
import { EmptyState } from "../components/EmptyState";
import { FilterPanel } from "../components/FilterPanel";
import { PriceSummary } from "../components/PriceSummary";
import { RequestCard } from "../components/RequestCard";
import { Shell } from "../components/Shell";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import type { CategoriesForCity, Chat, ClientRequest, KnowledgeArticle, PerformerDocument } from "../types";
import { labelChildcare, labelCriminalRecord, labelSelfEmployed, labelStatus, labelTrust, requestDisplayTitle } from "../utils/labels";
import { chatPathForRole, performerNavigation, sectionTitleForPath } from "../routes/navigation";
import { buildPublicAddressFromRequest, buildYandexExactAddressFromRequest, buildYandexMapsSearchUrl } from "../utils/address";
import { formatDateRu, formatTimeRu } from "../utils/dateTime";
import { CityCombobox } from "../components/CityCombobox";
import { UserCitiesPanel } from "../components/UserCitiesPanel";
import { ServiceMessagesPanel } from "../components/ServiceMessagesPanel";
import { AccountSecurityPanel } from "../components/AccountSecurityPanel";

export function PerformerDashboard() {
  const { bootstrap, user, refreshMe } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = performerTabFromPath(location.pathname);
  const routeChatId = chatIdFromPath(location.pathname, "/app/performer/chats");
  const [available, setAvailable] = useState<ClientRequest[]>([]);
  const [mine, setMine] = useState<ClientRequest[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatSearch, setChatSearch] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null);
  const [documents, setDocuments] = useState<PerformerDocument[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [notice, setNotice] = useState("");
  const [preferenceCategories, setPreferenceCategories] = useState<CategoriesForCity | null>(null);
  const [selectedPreferenceIds, setSelectedPreferenceIds] = useState<string[]>([]);
  const [filters, setFilters] = useState({
    categoryId: searchParams.get("category") ?? "",
    district: searchParams.get("district") ?? "",
    date: searchParams.get("date") ?? "",
    maxBudget: searchParams.get("maxBudget") ?? ""
  });
  const [matchFilter, setMatchFilter] = useState(searchParams.get("match") ?? "fit");
  const [supportForm, setSupportForm] = useState({ type: "message", reason: "", description: "", requestId: "" });
  const [profileForm, setProfileForm] = useState({
    displayName: user?.displayName ?? "",
    cityId: user?.cityId ?? "",
    districts: parseJsonArray(user?.performerProfile?.districts).join(", "),
    age: user?.performerProfile?.age ? String(user.performerProfile.age) : "",
    experience: user?.performerProfile?.experience ?? "",
    services: parseJsonArray(user?.performerProfile?.services),
    skills: parseJsonArray(user?.performerProfile?.skills).join(", "),
    readyForHygieneHelp: Boolean(user?.performerProfile?.readyForHygieneHelp),
    readyForPhysicalHelp: Boolean(user?.performerProfile?.readyForPhysicalHelp),
    readyForLimitedMobility: Boolean(user?.performerProfile?.readyForLimitedMobility),
    readyForChildren: Boolean(user?.performerProfile?.readyForChildren),
    readyForUrgentRequests: Boolean(user?.performerProfile?.readyForUrgentRequests),
    canTravelOutsideCity: Boolean(user?.performerProfile?.canTravelOutsideCity),
    readyToProvideDocuments: Boolean(user?.performerProfile?.readyToProvideDocuments),
    schedule: user?.performerProfile?.schedule ?? "",
    selfEmployedStatus: user?.performerProfile?.selfEmployedStatus ?? "self_employed_not_provided",
    criminalRecordCertificateStatus: user?.performerProfile?.criminalRecordCertificateStatus ?? "criminal_record_not_provided",
    profileComment: user?.performerProfile?.profileComment ?? ""
  });

  async function load() {
    const [availableRows, mineRows, chatRows, documentRows, complaintRows, articleRows] = await Promise.all([
      api.requests(),
      api.requests("mine"),
      api.chats(),
      api.performerDocuments(),
      api.complaints(),
      api.knowledge("performer")
    ]);
    setAvailable(availableRows);
    setMine(mineRows);
    setChats(chatRows);
    setDocuments(documentRows);
    setComplaints(complaintRows);
    setArticles(articleRows);
  }

  useEffect(() => {
    load().catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    setActiveChatId(routeChatId);
  }, [routeChatId]);

  useEffect(() => {
    const cityId = profileForm.cityId || user?.cityId;
    if (!cityId) return;
    Promise.all([api.categoriesForHelper(cityId), api.helperCategoryPreferences(cityId)])
      .then(([categoryRows, preferenceRows]) => {
        setPreferenceCategories(categoryRows);
        setSelectedPreferenceIds(preferenceRows.filter((item) => item.isEnabled).map((item) => item.categoryId));
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Не удалось загрузить категории."));
  }, [profileForm.cityId, user?.cityId]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (filters.categoryId) next.set("category", filters.categoryId);
    if (filters.district) next.set("district", filters.district);
    if (filters.date) next.set("date", filters.date);
    if (filters.maxBudget) next.set("maxBudget", filters.maxBudget);
    if (matchFilter && matchFilter !== "fit") next.set("match", matchFilter);
    setSearchParams(next, { replace: true });
  }, [filters, matchFilter, setSearchParams]);

  const filtered = useMemo(() => {
    return available.filter((request) => {
      if (filters.categoryId && request.categoryId !== filters.categoryId) return false;
      if (filters.district && !request.district?.toLowerCase().includes(filters.district.toLowerCase())) return false;
      if (filters.date && request.date?.slice(0, 10) !== filters.date) return false;
      if (filters.maxBudget && (request.budgetAmount ?? 0) > Number(filters.maxBudget)) return false;
      if (matchFilter !== "all" && request.match?.status !== matchFilter) return false;
      return true;
    }).sort((left, right) => Number(requestMatchesPreferences(right, selectedPreferenceIds)) - Number(requestMatchesPreferences(left, selectedPreferenceIds)));
  }, [available, filters, matchFilter, selectedPreferenceIds]);
  const latestSelfEmployedDocument = latestDocument(documents, "self_employed");
  const latestCriminalRecordDocument = latestDocument(documents, "criminal_record");
  const filteredChats = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    const sorted = [...chats].sort((left, right) => (left.request?.publicNumber ?? "").localeCompare(right.request?.publicNumber ?? "", "ru", { numeric: true }));
    if (!query) return sorted;
    return sorted.filter((chat) =>
      [chat.request?.publicNumber, chat.request?.title, chat.client?.displayName, chat.performer?.displayName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [chats, chatSearch]);
  const activeFiltersCount = [
    filters.categoryId,
    filters.district,
    filters.date,
    filters.maxBudget,
    matchFilter !== "fit" ? matchFilter : ""
  ].filter(Boolean).length;

  async function respond(requestId: string) {
    try {
      const result = await api.respondToRequest(requestId, "");
      setNotice(result.warning ?? "Отклик отправлен. Заказчик увидит вашу кандидатуру и сможет выбрать вас для заявки.");
      await load();
      navigate("/app/performer/responses");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Ошибка отклика");
    }
  }

  async function uploadDocument(type: "self_employed" | "criminal_record", file?: File) {
    if (!file) return;
    try {
      const fileData = await readFileAsDataUrl(file);
      await api.uploadPerformerDocument({
        type,
        fileName: file.name,
        fileData
      });
      setNotice("Документ добавлен. Администратор увидит его в карточке помощника.");
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === "MISSING_REQUIRED_CONSENT") {
        setNotice("Перед загрузкой документа примите согласие на обработку документов в блоке “Согласия и документы”.");
        return;
      }
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить документ");
    }
  }

  async function complete(request: ClientRequest) {
    await api.completeRequest(request.id);
    await load();
  }

  async function saveProfile() {
    await api.updatePerformerProfile({
      displayName: profileForm.displayName,
      cityId: profileForm.cityId,
      age: profileForm.age ? Number(profileForm.age) : null,
      experience: profileForm.experience,
      services: profileForm.services,
      skills: splitComma(profileForm.skills),
      districts: splitComma(profileForm.districts),
      readyForHygieneHelp: profileForm.readyForHygieneHelp,
      readyForPhysicalHelp: profileForm.readyForPhysicalHelp,
      readyForLimitedMobility: profileForm.readyForLimitedMobility,
      readyForChildren: profileForm.readyForChildren,
      readyForUrgentRequests: profileForm.readyForUrgentRequests,
      canTravelOutsideCity: profileForm.canTravelOutsideCity,
      readyToProvideDocuments: profileForm.readyToProvideDocuments,
      schedule: profileForm.schedule,
      selfEmployedStatus: profileForm.selfEmployedStatus,
      criminalRecordCertificateStatus: profileForm.criminalRecordCertificateStatus,
      profileComment: profileForm.profileComment
    });
    setNotice("Профиль сохранён. Подходящие заявки будут пересчитаны по новым данным.");
    await refreshMe();
    await load();
  }

  async function saveCategoryPreferences() {
    const cityId = profileForm.cityId || user?.cityId;
    if (!cityId) return setNotice("Сначала выберите город.");
    await api.saveHelperCategoryPreferences({ cityId, categoryIds: selectedPreferenceIds });
    setNotice("Выбранные категории сохранены. Подходящие заявки будут показаны выше.");
    await load();
  }

  async function applyCategoryPreferencesToAllCities() {
    const currentCityId = profileForm.cityId || user?.cityId;
    if (!currentCityId || !preferenceCategories) return setNotice("Сначала выберите категории для основного города.");
    const selectedSlugs = new Set(
      preferenceCategories.categories
        .filter((category) => selectedPreferenceIds.includes(category.id))
        .map((category) => category.slug)
    );
    const cityIds = Array.from(new Set([
      currentCityId,
      ...(user?.userCities ?? [])
        .filter((item) => item.isActive && (item.roleScope === "helper" || item.roleScope === "both"))
        .map((item) => item.cityId)
    ]));
    await Promise.all(cityIds.map(async (cityId) => {
      const availableForCity = cityId === currentCityId ? preferenceCategories : await api.categoriesForHelper(cityId);
      const categoryIds = availableForCity.categories
        .filter((category) => selectedSlugs.has(category.slug))
        .map((category) => category.id);
      await api.saveHelperCategoryPreferences({ cityId, categoryIds });
    }));
    setNotice(`Выбранные категории применены для городов: ${cityIds.length}.`);
    await load();
  }

  async function sendSupport(event: FormEvent) {
    event.preventDefault();
    if (!supportForm.reason.trim()) {
      setNotice("Укажите тему обращения.");
      return;
    }
    await api.createComplaint({
      type: supportForm.type,
      requestId: supportForm.requestId || undefined,
      reason: supportForm.reason,
      description: supportForm.description
    });
    setSupportForm({ type: "message", reason: "", description: "", requestId: "" });
    setNotice("Обращение отправлено администратору.");
    await load();
  }

  function openChat(chatId?: string) {
    if (!chatId) {
      setNotice("Чат по этой заявке ещё не открыт заказчиком.");
      return;
    }
    navigate(chatPathForRole("performer", chatId));
  }

  return (
    <Shell title={sectionTitleForPath(location.pathname, performerNavigation)} navigation={performerNavigation}>
      {notice && <p className="notice">{notice}</p>}

      {activeTab === "Доступные заявки" && (
        <>
          <FilterPanel
            title="Фильтры"
            activeCount={activeFiltersCount}
            onReset={() => {
              setFilters({ categoryId: "", district: "", date: "", maxBudget: "" });
              setMatchFilter("fit");
            }}
          >
            <label>
              Категория
              <select value={filters.categoryId} onChange={(event) => setFilters({ ...filters, categoryId: event.target.value })}>
              <option value="">Все категории</option>
              {bootstrap?.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              </select>
            </label>
            <label>
              Район
              <input value={filters.district} onChange={(event) => setFilters({ ...filters, district: event.target.value })} />
            </label>
            <label>
              Дата
              <input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} />
              <small>{filters.date ? `Выбранная дата: ${formatDateRu(filters.date)}` : "Формат даты: дд.мм.гггг"}</small>
            </label>
            <label>
              Рекомендуемая оплата до
              <input type="number" value={filters.maxBudget} onChange={(event) => setFilters({ ...filters, maxBudget: event.target.value })} />
            </label>
            <label>
              Соответствие профилю
              <select value={matchFilter} onChange={(event) => setMatchFilter(event.target.value)}>
                <option value="fit">Показывать подходящие</option>
                <option value="partial">Частично подходящие</option>
                <option value="not_fit">Скрытые / неподходящие</option>
                <option value="all">Все с объяснением</option>
              </select>
            </label>
          </FilterPanel>
          <div className="list">
            {filtered.map((request) => (
              <RequestCard key={request.id} request={request} priceRole="performer">
                <StatusBadge tone={requestMatchesPreferences(request, selectedPreferenceIds) ? "success" : "neutral"}>
                  {requestMatchesPreferences(request, selectedPreferenceIds) ? "Подходит по вашим категориям" : "Категория не выбрана в вашем профиле"}
                </StatusBadge>
                {request.match && (
                  <div className="notice">
                    <strong>{request.match.label}</strong>
                    <p>{request.match.reasons.join(" ")}</p>
                  </div>
                )}
                {request.category?.isChildcare && (
                  <p className="warning-text">
                    Для этой категории требуется подтверждённый допуск.
                  </p>
                )}
                <div className="trust-row">
                  <button className="secondary-button" type="button" onClick={() => setSelectedRequest(request)}>
                    Посмотреть заявку
                  </button>
                  <button className="primary-button" type="button" onClick={() => respond(request.id)}>
                    <MessageCircle size={18} />
                    Перейти в чат с заказчиком для согласования условий
                  </button>
                </div>
              </RequestCard>
            ))}
            {filtered.length === 0 && <EmptyState title="Подходящих заявок пока нет. Измените фильтры или проверьте профиль." />}
          </div>
        </>
      )}

      {activeTab === "Мои отклики" && (
        <div className="list">
          {responseGroups(mine).map((group) => (
            <section className="plain-section" key={group.title}>
              <h3>{group.title}</h3>
              {group.rows.map((request) => (
                <RequestCard key={`${request.id}-${request.responseId}`} request={request} priceRole="performer">
                  <StatusBadge tone={statusTone(request.responseStatus ?? "")}>
                    {labelStatus(request.responseStatus)}
                  </StatusBadge>
                  <p className="privacy-note">
                    Откройте условия заявки и чат, чтобы согласовать дату, время, длительность, состав работ и оплату.
                  </p>
                  <button className="secondary-button" type="button" onClick={() => setSelectedRequest(request)}>
                    Открыть условия заявки
                  </button>
                  {request.chat?.id && (
                    <button className="secondary-button" type="button" onClick={() => openChat(request.chat?.id)}>
                      Перейти в чат по заявке
                    </button>
                  )}
                  {request.status === "in_progress" && (
                    <button className="secondary-button" type="button" onClick={() => complete(request)}>
                      Завершить заявку
                    </button>
                  )}
                </RequestCard>
              ))}
              {group.rows.length === 0 && <EmptyState title="Нет заявок в этой группе." />}
            </section>
          ))}
        </div>
      )}

      {activeTab === "Баланс" && <BalancePanel />}

      {activeTab === "Чаты" && (
        <div className="admin-chat-layout">
          <label className="search-field">
            <Search size={18} />
            <input
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
              placeholder="Поиск по номеру заявки, заказчику или помощнику"
            />
          </label>
          <aside className="side-list side-list--tall">
            {filteredChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={activeChatId === chat.id ? "side-list__item side-list__item--active" : "side-list__item"}
                onClick={() => navigate(chatPathForRole("performer", chat.id))}
              >
                <strong>{chat.request?.publicNumber ?? "без номера"}</strong>
                <span>{chat.client.displayName}</span>
                <small>{labelStatus(chat.status)}</small>
              </button>
            ))}
          </aside>
          {activeChatId ? <ChatPanel chatId={activeChatId} /> : <p className="empty-text">Нет открытых чатов.</p>}
        </div>
      )}
      {activeTab === "Сообщения от сервиса" && <ServiceMessagesPanel />}

      {activeTab === "Профиль" && (
        <section className="panel-grid">
          <AccountSecurityPanel />
          <div className="metric">
            <Star size={20} />
            <span>Рейтинг</span>
            <strong>{user?.performerProfile?.rating ?? 0}</strong>
          </div>
          <div className="metric">
            <span>Статус профиля</span>
            <strong>{labelTrust(user?.performerProfile?.trustLevel)}</strong>
          </div>
          <div className="metric">
            <span>Выполнено</span>
            <strong>{user?.performerProfile?.completedJobsCount ?? 0}</strong>
          </div>
          <ContactDetails user={user} />
          <UserCitiesPanel />
          <form className="form-grid span-2" onSubmit={(event) => { event.preventDefault(); saveProfile(); }}>
            <h2 className="span-2">Анкета помощника</h2>
            <label>
              Имя
              <input value={profileForm.displayName} onChange={(event) => setProfileForm({ ...profileForm, displayName: event.target.value })} />
            </label>
            <label>Телефон<input value={user?.phone ?? "не указан"} readOnly aria-readonly="true" /></label>
            <CityCombobox cities={bootstrap?.cities ?? []} value={profileForm.cityId} onChange={(cityId) => setProfileForm({ ...profileForm, cityId })} />
            <label>
              Возраст
              <input type="number" value={profileForm.age} onChange={(event) => setProfileForm({ ...profileForm, age: event.target.value })} />
            </label>
            <label className="span-2">
              Район / возможность выезда
              <input value={profileForm.districts} onChange={(event) => setProfileForm({ ...profileForm, districts: event.target.value })} placeholder="Например: Центр, Южный" />
            </label>
            <label className="span-2">
              Опыт помощи / ухода
              <textarea value={profileForm.experience} onChange={(event) => setProfileForm({ ...profileForm, experience: event.target.value })} />
            </label>
            <fieldset className="span-2 checkbox-grid">
              <legend>Основные услуги помощника</legend>
              {bootstrap?.categories.map((category) => (
                <label className="checkbox-row" key={category.id}>
                  <input
                    type="checkbox"
                    checked={profileForm.services.includes(category.name)}
                    onChange={() => setProfileForm({ ...profileForm, services: toggleValue(profileForm.services, category.name) })}
                  />
                  {category.name}
                </label>
              ))}
            </fieldset>
            <fieldset className="span-2 checkbox-grid helper-category-preferences">
              <legend>Какие задачи вы готовы выполнять</legend>
              <p className="privacy-note span-2">Выберите задачи, которые готовы выполнять. Заявки по выбранным категориям будут показываться выше.</p>
              {preferenceCategories?.categories.map((category) => (
                <label className="checkbox-row" key={category.id}>
                  <input type="checkbox" checked={selectedPreferenceIds.includes(category.id)} onChange={() => setSelectedPreferenceIds(toggleValue(selectedPreferenceIds, category.id))} />
                  <span><strong>{category.title}</strong>{category.descriptionForHelper && <small>{category.descriptionForHelper}</small>}</span>
                </label>
              ))}
              {!preferenceCategories?.categories.length && <p className="privacy-note">Для выбранного города категории пока не настроены.</p>}
              <p className="warning-text span-2">Помощник не выполняет медицинские процедуры и не принимает задачи, требующие специальных разрешений или создающие опасность.</p>
              <button className="secondary-button span-2" type="button" onClick={saveCategoryPreferences}>Сохранить выбранные категории</button>
              {(user?.userCities ?? []).filter((item) => item.isActive && (item.roleScope === "helper" || item.roleScope === "both")).length > 1 && (
                <button className="ghost-button span-2" type="button" onClick={applyCategoryPreferencesToAllCities}>Применить ко всем моим городам</button>
              )}
            </fieldset>
            <label className="span-2">
              Дополнительные навыки помощника
              <input value={profileForm.skills} onChange={(event) => setProfileForm({ ...profileForm, skills: event.target.value })} placeholder="Например: готовка, аккуратная уборка, спокойное общение" />
            </label>
            <fieldset className="span-2 checkbox-grid">
              <legend>Готовность к условиям заявок</legend>
              {[
                ["readyForHygieneHelp", "Готовность к гигиенической помощи"],
                ["readyForPhysicalHelp", "Готовность к физической помощи"],
                ["readyForLimitedMobility", "Готовность помогать маломобильным людям"],
                ["readyForChildren", "Готовность помогать с присмотром за детьми"],
                ["readyForUrgentRequests", "Готовность к срочным заявкам"],
                ["canTravelOutsideCity", "Готовность выезжать в другой город"],
                ["readyToProvideDocuments", "Готовность предоставить документы"]
              ].map(([key, label]) => (
                <label className="checkbox-row" key={key}>
                  <input
                    type="checkbox"
                    checked={Boolean((profileForm as any)[key])}
                    onChange={(event) => setProfileForm({ ...profileForm, [key]: event.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label>
              Самозанятость
              <select value={profileForm.selfEmployedStatus} onChange={(event) => setProfileForm({ ...profileForm, selfEmployedStatus: event.target.value })}>
                <option value="self_employed_not_provided">Не предоставлена</option>
                <option value="self_employed_provided">Документ загружен</option>
                <option value="self_employed_verified">Подтверждена</option>
              </select>
            </label>
            <label>
              Справка об отсутствии судимости
              <select value={profileForm.criminalRecordCertificateStatus} onChange={(event) => setProfileForm({ ...profileForm, criminalRecordCertificateStatus: event.target.value })}>
                <option value="criminal_record_not_provided">Не предоставлена</option>
                <option value="criminal_record_uploaded">Загружена</option>
                <option value="criminal_record_verified">Подтверждена</option>
              </select>
            </label>
            <label className="span-2">
              График работы помощника
              <input value={profileForm.schedule} onChange={(event) => setProfileForm({ ...profileForm, schedule: event.target.value })} placeholder="Например: будни после 17:00, выходные по договорённости" />
            </label>
            <label className="span-2">
              Комментарий помощника
              <textarea value={profileForm.profileComment} onChange={(event) => setProfileForm({ ...profileForm, profileComment: event.target.value })} />
            </label>
            <button className="primary-button span-2" type="submit">Сохранить профиль</button>
          </form>
          <p className="privacy-note">
            Паспорт и селфи не являются обязательными для регистрации. Заказчик видит прозрачные статусы доверия.
          </p>
          <ConsentDocumentsPanel
            title="Согласия и документы"
            description="Обязательные документы нужны для откликов, чатов и работы с заявками. Согласие на обработку документов требуется перед загрузкой файлов."
            onAccepted={load}
          />
          <section className="plain-section span-2">
            <h2>Проверки и документы</h2>
            <p className="privacy-note">Паспорт и селфи не требуются. Здесь можно добавить самозанятость и справку.</p>
            <p className="privacy-note">Если согласие на обработку документов ещё не принято, нажмите “Принять текущую версию” в блоке “Согласия и документы”, затем загрузите документ.</p>
            <DocumentCard title="Самозанятость" document={latestSelfEmployedDocument} onUpload={(file) => uploadDocument("self_employed", file)} />
            <DocumentCard title="Справка об отсутствии судимости" document={latestCriminalRecordDocument} onUpload={(file) => uploadDocument("criminal_record", file)} />
          </section>
          <section className="plain-section span-2">
            <div className="card__head">
              <div>
                <p className="eyebrow">Проверка категории</p>
                <h2>Допуск к категории «Няня для малышей»</h2>
              </div>
              <StatusBadge tone={statusTone(user?.performerProfile?.childcareApprovalStatus ?? "")}>
                {labelChildcare(user?.performerProfile?.childcareApprovalStatus)}
              </StatusBadge>
            </div>
            <div className="detail-grid">
              <span>Статус</span>
              <strong>{labelChildcare(user?.performerProfile?.childcareApprovalStatus)}</strong>
              <span>Файл</span>
              <strong>{latestCriminalRecordDocument?.fileName ?? "не загружен"}</strong>
              <span>Дата загрузки</span>
              <strong>{latestCriminalRecordDocument ? formatDateRu(latestCriminalRecordDocument.uploadedAt) : "не загружен"}</strong>
              <span>Дата проверки</span>
              <strong>{latestCriminalRecordDocument?.verifiedAt ? formatDateRu(latestCriminalRecordDocument.verifiedAt) : "не проверен"}</strong>
            </div>
            <p className="privacy-note">
              {user?.performerProfile?.childcareApprovalStatus === "approved"
                ? "Допуск к категории «Няня для малышей» подтверждён."
                : "Для отклика на заявки категории «Няня для малышей» может потребоваться подтверждённая справка."}
            </p>
            <div className="form-inline">
              <label className="secondary-button">
                {latestCriminalRecordDocument ? "Заменить документ" : "Загрузить документ"}
                <input type="file" hidden onChange={(event) => uploadDocument("criminal_record", event.target.files?.[0])} />
              </label>
              {latestCriminalRecordDocument && (
                <button className="secondary-button" type="button" onClick={() => void api.downloadPerformerDocument(latestCriminalRecordDocument.id, latestCriminalRecordDocument.fileName)}>Скачать документ</button>
              )}
            </div>
          </section>
        </section>
      )}

      {activeTab === "Связь с администратором" && (
        <div className="list">
          <form className="form-grid" onSubmit={sendSupport}>
            <label>
              Тип обращения
              <select value={supportForm.type} onChange={(event) => setSupportForm({ ...supportForm, type: event.target.value })}>
                <option value="message">Сообщение</option>
                <option value="question">Вопрос</option>
                <option value="complaint">Жалоба</option>
                <option value="suggestion">Предложение</option>
                <option value="payment_problem">Проблема с оплатой</option>
                <option value="request_problem">Проблема с заявкой</option>
                <option value="client_problem">Проблема с заказчиком</option>
                <option value="performer_problem">Проблема с помощником</option>
                <option value="technical_problem">Техническая проблема</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label>
              Связано с заявкой
              <select value={supportForm.requestId} onChange={(event) => setSupportForm({ ...supportForm, requestId: event.target.value })}>
                <option value="">Не связано</option>
                {mine.map((request) => <option key={request.id} value={request.id}>{request.publicNumber} — {request.title}</option>)}
              </select>
            </label>
            <label className="span-2">
              Тема
              <input value={supportForm.reason} onChange={(event) => setSupportForm({ ...supportForm, reason: event.target.value })} />
            </label>
            <label className="span-2">
              Сообщение
              <textarea value={supportForm.description} onChange={(event) => setSupportForm({ ...supportForm, description: event.target.value })} />
            </label>
            <button className="primary-button span-2" type="submit">Отправить администратору</button>
          </form>
          <div className="data-table">
            <h3>Активные обращения</h3>
            {complaints.filter((complaint) => !["resolved", "rejected"].includes(complaint.status)).map((complaint) => (
              <div className="data-row" key={complaint.id}>
                <strong>{complaint.publicNumber ?? "обращение"} — {complaint.reason}</strong>
                <span>{complaint.request?.publicNumber ?? "без заявки"}</span>
                <StatusBadge tone={statusTone(complaint.status)}>{labelStatus(complaint.status)}</StatusBadge>
                <span>{complaint.adminResponse ?? complaint.adminComment ?? "Ответ администратора пока не добавлен"}</span>
              </div>
            ))}
            <h3>Архив обращений</h3>
            {complaints.filter((complaint) => ["resolved", "rejected"].includes(complaint.status)).map((complaint) => (
              <div className="data-row" key={complaint.id}>
                <strong>{complaint.publicNumber ?? "обращение"} — {complaint.reason}</strong>
                <span>{complaint.request?.publicNumber ?? "без заявки"}</span>
                <StatusBadge tone={statusTone(complaint.status)}>{labelStatus(complaint.status)}</StatusBadge>
                <span>{complaint.adminResponse ?? complaint.adminComment ?? "Ответ администратора пока не добавлен"}</span>
              </div>
            ))}
            {complaints.length === 0 && <p className="empty-text">Обращений пока нет.</p>}
          </div>
        </div>
      )}

      {activeTab === "Помощь / FAQ" && (
        <div className="list">
          {articles.map((article) => (
            <article className="card" key={article.id}>
              <p className="eyebrow">{article.category}</p>
              <h3>{article.title}</h3>
              <p>{article.content}</p>
            </article>
          ))}
        </div>
      )}

      {selectedRequest && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel">
            <div className="card__head">
              <h2>Условия заявки {selectedRequest.publicNumber}</h2>
              <button className="secondary-button" type="button" onClick={() => setSelectedRequest(null)}>Закрыть</button>
            </div>
            <PerformerRequestDetails request={selectedRequest} />
            <div className="trust-row">
              {selectedRequest.chat?.id && (
                <button className="secondary-button" type="button" onClick={() => openChat(selectedRequest.chat?.id)}>
                  Перейти в чат по заявке
                </button>
              )}
              {!selectedRequest.responseId && (
                <button className="primary-button" type="button" onClick={() => respond(selectedRequest.id)}>
                  <MessageCircle size={18} />
                  Перейти в чат с заказчиком для согласования условий
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

function PerformerRequestDetails({ request }: { request: ClientRequest }) {
  const pricing = request.pricing ?? parseJsonObject(request.pricingBreakdownJson);
  const performerPayment = pricing?.performerPaymentAmount ?? request.priceEstimateAmount ?? request.budgetAmount ?? 0;
  const builtPublicAddress = buildPublicAddressFromRequest(request);
  const publicAddress = request.yandexPublicMapAddress || builtPublicAddress || request.publicAddress || "";
  const exactAddress = request.yandexExactMapAddress ?? buildYandexExactAddressFromRequest(request);
  const visibleAddress = request.exactAddressVisible ? exactAddress : publicAddress;
  const mapAddress = request.exactAddressVisible
    ? exactAddress
    : request.yandexPublicMapAddress ?? publicAddress;
  const mapUrl = (request.exactAddressVisible ? request.yandexExactMapUrl : request.yandexPublicMapUrl) || buildYandexMapsSearchUrl(mapAddress);
  return (
    <div className="list">
      <div className="detail-grid">
        <span>Категория</span><strong>{request.category?.name ?? "не указана"}</strong>
        <span>Пакет / уровень помощи</span><strong>{pricing?.packageName ?? "будет уточнён"}</strong>
        <span>Краткое описание</span><strong>{request.title}</strong>
        <span>{request.exactAddressVisible ? "Адрес выполнения" : "Район выполнения"}</span><strong>{visibleAddress}</strong>
        <span>Адрес и контакты</span><strong>{request.exactAddressVisible ? "Точный адрес открыт после перехода заявки в работу." : "Точный адрес будет доступен после согласования условий и перехода заявки в работу."}</strong>
        {request.exactAddressVisible && (
          <>
            <span>Дополнительно</span><strong>{formatAddressDetails(request)}</strong>
            <span>Комментарий к адресу</span><strong>{request.addressComment || "не указан"}</strong>
          </>
        )}
        <span>Дата / время</span><strong>{request.date ? formatDateRu(request.date) : "не указана"} {formatTimeRu(request.timeFrom)}</strong>
        <span>Длительность</span><strong>{request.expectedDurationHours ?? pricing?.durationHours ?? "не указана"} ч</strong>
        <span>Состояние подопечного</span><strong>{formatCondition(request)}</strong>
        <span>Что нужно сделать</span><strong>{request.description}</strong>
        <span>Что входит</span><strong>{pricing?.included?.join(", ") || "Состав работ нужно согласовать в чате по заявке."}</strong>
        <span>Что не входит</span><strong>{pricing?.excluded?.join(", ") || "Медицинские процедуры и действия вне согласованного объёма."}</strong>
        <span>Что нужно согласовать</span><strong>Точный объём работ, время, длительность, адресные детали и итоговую оплату помощнику.</strong>
        <span>Ограничения</span><strong>Сервис не выполняет медицинские процедуры: инъекции, капельницы, перевязки, лечение, диагностика и назначения запрещены.</strong>
      </div>
      {mapUrl && (
        <a className="secondary-button" href={mapUrl} target="_blank" rel="noreferrer">
          {request.exactAddressVisible ? "Открыть точный адрес на Яндекс.Картах" : "Открыть на Яндекс.Картах"}
        </a>
      )}
      <PriceSummary
        pricing={pricing}
        fallbackPayment={performerPayment}
        fallbackServiceFee={request.city?.defaultCommissionAmount ?? 0}
        role="performer"
      />
      {request.match && (
        <div className="notice">
          <strong>{request.match.label}</strong>
          <p>{request.match.reasons.join(" ")}</p>
        </div>
      )}
    </div>
  );
}

function formatAddressDetails(request: ClientRequest) {
  return [
    request.addressEntrance ? `подъезд ${request.addressEntrance}` : "",
    request.addressFloor ? `этаж ${request.addressFloor}` : "",
    request.addressApartment ? `квартира ${request.addressApartment}` : "",
    request.addressIntercom ? `домофон ${request.addressIntercom}` : ""
  ].filter(Boolean).join(", ") || "дополнительные данные не указаны";
}

function responseGroups(requests: ClientRequest[]) {
  return [
    {
      title: "Активные",
      rows: requests.filter((request) =>
        ["discussion", "waiting_client_confirmation", "waiting_performer_confirmation", "in_progress"].includes(request.status)
      )
    },
    {
      title: "Ожидают решения заказчика",
      rows: requests.filter((request) => request.responseStatus === "pending")
    },
    {
      title: "Обсуждение условий",
      rows: requests.filter((request) => request.status === "discussion")
    },
    {
      title: "Ожидают моего подтверждения",
      rows: requests.filter((request) => request.status === "waiting_performer_confirmation")
    },
    {
      title: "В работе",
      rows: requests.filter((request) => request.status === "in_progress")
    },
    {
      title: "Архив",
      rows: requests.filter((request) =>
        ["completed", "cancelled", "archived"].includes(request.status) ||
        ["not_agreed", "rejected_by_client", "expired"].includes(request.responseStatus ?? "")
      )
    }
  ];
}

function DocumentCard({
  title,
  document,
  onUpload
}: {
  title: string;
  document?: PerformerDocument;
  onUpload: (file?: File) => void;
}) {
  return (
    <article className="card">
      <div className="card__head">
        <div>
          <p className="eyebrow">Документ</p>
          <h3>{title}</h3>
        </div>
        <StatusBadge tone={statusTone(document?.status ?? "not_provided")}>
          {document ? labelStatus(document.status) : "Не предоставлена"}
        </StatusBadge>
      </div>
      <div className="meta-row">
        <span>Дата загрузки: {document ? formatDateRu(document.uploadedAt) : "не загружен"}</span>
        <span>Дата проверки: {document?.verifiedAt ? formatDateRu(document.verifiedAt) : "не проверен"}</span>
        <span>Файл: {document?.fileName ?? "не выбран"}</span>
      </div>
      <div className="form-inline">
        <label className="secondary-button">
          <Upload size={18} />
          {document ? "Заменить документ" : "Загрузить документ"}
          <input type="file" hidden onChange={(event) => onUpload(event.target.files?.[0])} />
        </label>
        {document && <button className="secondary-button" type="button" onClick={() => void api.downloadPerformerDocument(document.id, document.fileName)}>Скачать документ</button>}
      </div>
    </article>
  );
}

function parseJsonArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function splitComma(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function requestMatchesPreferences(request: ClientRequest, categoryIds: string[]) {
  const categoryId = request.categorySnapshot?.snapshot?.category?.id;
  return Boolean(categoryId && categoryIds.includes(categoryId));
}

function latestDocument(documents: PerformerDocument[], type: string) {
  return documents
    .filter((document) => document.type === type)
    .sort((left, right) => new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime())[0];
}

function parseJsonObject(value?: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatCondition(request: ClientRequest) {
  const parts = [
    request.hasElderlyPerson ? "пожилой человек" : "",
    request.hasChild ? "ребёнок" : "",
    request.hasLimitedMobility ? "маломобильный человек" : "",
    request.needsHygieneHelp ? "нужна бытовая гигиеническая помощь" : "",
    request.needsCooking ? "готовка" : "",
    request.needsCleaning ? "уборка" : "",
    request.needsWalk ? "прогулка" : "",
    request.hasPets ? "есть домашние животные" : ""
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "особые условия не указаны";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function performerTabFromPath(pathname: string) {
  if (pathname.startsWith("/app/performer/responses")) return "Мои отклики";
  if (pathname.startsWith("/app/performer/balance")) return "Баланс";
  if (pathname.startsWith("/app/performer/chats")) return "Чаты";
  if (pathname.startsWith("/app/performer/messages")) return "Сообщения от сервиса";
  if (pathname.startsWith("/app/performer/profile")) return "Профиль";
  if (pathname.startsWith("/app/performer/support")) return "Связь с администратором";
  if (pathname.startsWith("/app/performer/help")) return "Помощь / FAQ";
  return "Доступные заявки";
}

function chatIdFromPath(pathname: string, prefix: string) {
  const match = pathname.match(new RegExp(`^${prefix}/([^/]+)$`));
  return match?.[1] ?? null;
}
