import { Check, MessageCircle, Plus, Star } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { BalancePanel } from "../components/BalancePanel";
import { ChatPanel } from "../components/ChatPanel";
import { ConsentDocumentsPanel } from "../components/ConsentDocumentsPanel";
import { ContactDetails } from "../components/ContactDetails";
import { EmptyState } from "../components/EmptyState";
import { RequestCard } from "../components/RequestCard";
import { PriceSummary } from "../components/PriceSummary";
import { Shell } from "../components/Shell";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import type { CategoriesForCity, Chat, ClientRequest, KnowledgeArticle, PricingQuote, StructuredRequestPriceQuote } from "../types";
import { labelCriminalRecord, labelStatus, requestDisplayTitle } from "../utils/labels";
import { chatPathForRole, clientNavigation, sectionTitleForPath } from "../routes/navigation";
import { formatDateRu, formatTimeRu } from "../utils/dateTime";
import { CityCombobox } from "../components/CityCombobox";
import { UserCitiesPanel } from "../components/UserCitiesPanel";
import { ServiceMessagesPanel } from "../components/ServiceMessagesPanel";
import { RequestCreationForm } from "../components/RequestCreationForm";
import { AccountSecurityPanel } from "../components/AccountSecurityPanel";

export function ClientDashboard() {
  const { bootstrap, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = clientTabFromPath(location.pathname);
  const routeChatId = chatIdFromPath(location.pathname, "/app/client/chats");
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [supportForm, setSupportForm] = useState({ type: "message", reason: "", description: "", requestId: "" });
  const [reviewForm, setReviewForm] = useState({ requestId: "", toUserId: "", rating: 5, text: "", likedText: "", improvementText: "" });
  const [editingRequest, setEditingRequest] = useState<ClientRequest | null>(null);
  const [editForm, setEditForm] = useState({
    contactName: user?.displayName ?? "",
    contactPhone: user?.phone ?? "",
    packageId: "",
    selectedAddonIds: [] as string[],
    helpFor: "",
    additionalActions: [] as string[],
    dependentState: [] as string[],
    dependentAge: "",
    scheduleType: "once",
    regularPeriod: "",
    repeatedVisitsAllowed: false,
    hygieneLevel: "none",
    physicalLoadLevel: "none",
    taskVolumeLevel: "basic",
    urgencyFlags: [] as string[],
    transportOption: "city",
    title: "",
    description: "",
    addressText: "",
    addressStreet: "",
    addressHouse: "",
    addressApartment: "",
    addressEntrance: "",
    addressFloor: "",
    addressIntercom: "",
    addressComment: "",
    district: "",
    categoryId: "",
    structuredCategoryId: "",
    structuredSubcategoryId: "",
    categoryTaskTemplateId: "",
    cityId: user?.cityId ?? "",
    date: "",
    timeFrom: "",
    timeTo: "",
    expectedDurationHours: 2,
    urgency: "normal",
    hasPets: false,
    physicalHelpLevel: "",
    paymentComment: "",
    comment: ""
  });
  const [form, setForm] = useState({
    contactName: user?.displayName ?? "",
    contactPhone: user?.phone ?? "",
    packageId: "",
    selectedAddonIds: [] as string[],
    helpFor: "",
    additionalActions: [] as string[],
    dependentState: [] as string[],
    dependentAge: "",
    scheduleType: "once",
    regularPeriod: "",
    repeatedVisitsAllowed: false,
    hygieneLevel: "none",
    physicalLoadLevel: "none",
    taskVolumeLevel: "basic",
    urgencyFlags: [] as string[],
    transportOption: "city",
    title: "",
    description: "",
    addressText: "",
    addressStreet: "",
    addressHouse: "",
    addressApartment: "",
    addressEntrance: "",
    addressFloor: "",
    addressIntercom: "",
    addressComment: "",
    district: "",
    categoryId: "",
    structuredCategoryId: "",
    structuredSubcategoryId: "",
    categoryTaskTemplateId: "",
    frequencyCode: "once",
    categorySpecificFormatCode: "",
    hasAdditionalTask: false,
    additionalCategoryId: "",
    additionalSubcategoryId: "",
    additionalTaskTemplateId: "",
    cityId: user?.cityId ?? "",
    date: "",
    timeFrom: "",
    timeTo: "",
    expectedDurationHours: 2,
    urgency: "normal",
    hasElderlyPerson: false,
    hasChild: false,
    hasLimitedMobility: false,
    physicalHelpLevel: "",
    needsCooking: false,
    needsCleaning: false,
    needsWalk: false,
    needsHygieneHelp: false,
    hasPets: false,
    paymentComment: "",
    comment: ""
  });
  const [structuredQuote, setStructuredQuote] = useState<StructuredRequestPriceQuote | null>(null);
  const [editQuote, setEditQuote] = useState<PricingQuote | null>(null);
  const [structuredCategories, setStructuredCategories] = useState<CategoriesForCity | null>(null);

  async function load() {
    const [requestRows, chatRows, complaintRows, articleRows] = await Promise.all([
      api.requests(),
      api.chats(),
      api.complaints(),
      api.knowledge("client")
    ]);
    setRequests(requestRows);
    setChats(chatRows);
    setComplaints(complaintRows);
    setArticles(articleRows);
  }

  async function confirmStructureUpdate(request: ClientRequest) {
    if (!request.pendingStructureUpdate) return;
    try {
      await api.confirmRequestStructureUpdate(request.pendingStructureUpdate.id);
      setMessage("Обновлённые данные подтверждены. Заявка снова доступна Помощникам.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось подтвердить обновление заявки."); }
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    setActiveChatId(routeChatId);
  }, [routeChatId]);

  useEffect(() => {
    const cityId = form.cityId || user?.cityId;
    if (!cityId) return setStructuredCategories(null);
    api.categoriesForRequest(cityId).then(setStructuredCategories).catch(() => setStructuredCategories(null));
  }, [form.cityId, user?.cityId]);

  useEffect(() => {
    if (!form.cityId || !form.structuredCategoryId || !form.structuredSubcategoryId) {
      setStructuredQuote(null);
      return;
    }
    const selectedSubcategory = structuredCategories?.categories
      .find((category) => category.id === form.structuredCategoryId)
      ?.children?.find((category) => category.id === form.structuredSubcategoryId);
    if (selectedSubcategory?.taskTemplates?.length && !form.categoryTaskTemplateId) {
      setStructuredQuote(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api.calculateRequestPrice({
        cityId: form.cityId,
        categoryId: form.structuredCategoryId,
        subcategoryId: form.structuredSubcategoryId,
        taskTemplateId: form.categoryTaskTemplateId || undefined,
        frequencyCode: form.frequencyCode,
        categorySpecificFormatCode: form.categorySpecificFormatCode || undefined,
        durationMinutes: Math.round(Number(form.expectedDurationHours) * 60),
        queryText: `${form.title} ${form.description}`,
        additionalTask: form.hasAdditionalTask && form.additionalCategoryId && form.additionalSubcategoryId ? {
          categoryId: form.additionalCategoryId,
          subcategoryId: form.additionalSubcategoryId,
          taskTemplateId: form.additionalTaskTemplateId || undefined
        } : undefined
      }).then(setStructuredQuote).catch(() => setStructuredQuote(null));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [
    form.cityId,
    form.structuredCategoryId,
    form.structuredSubcategoryId,
    form.categoryTaskTemplateId,
    form.frequencyCode,
    form.categorySpecificFormatCode,
    form.expectedDurationHours,
    form.title,
    form.description,
    form.hasAdditionalTask,
    form.additionalCategoryId,
    form.additionalSubcategoryId,
    form.additionalTaskTemplateId,
    structuredCategories
  ]);

  useEffect(() => {
    if (!editingRequest || !editForm.categoryId) {
      setEditQuote(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api.priceQuote(buildPricingPayload(editForm)).then(setEditQuote).catch(() => setEditQuote(null));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [
    editingRequest,
    editForm.categoryId,
    editForm.packageId,
    editForm.selectedAddonIds,
    editForm.expectedDurationHours,
    editForm.scheduleType,
    editForm.additionalActions,
    editForm.dependentState,
    editForm.helpFor,
    editForm.hygieneLevel,
    editForm.physicalLoadLevel,
    editForm.taskVolumeLevel,
    editForm.urgencyFlags,
    editForm.transportOption,
    editForm.date,
    editForm.timeFrom,
    editForm.hasPets
  ]);

  async function createRequest(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const errors = validateRequestForm();
    setFormErrors(errors);
    if (errors.length > 0) {
      setMessage("Заполните обязательные поля.");
      return;
    }
    try {
      const cityName = bootstrap?.cities.find((city) => city.id === (form.cityId || user?.cityId))?.name ?? "";
      const hasLimitedMobility = derivedHasLimitedMobility(form);
      const needsHygieneHelp = derivedNeedsHygiene(form);
      const needsCooking = form.additionalActions.some((action) => ["simple_cooking", "full_cooking"].includes(action));
      const needsCleaning = form.additionalActions.some((action) => ["light_cleaning", "laundry", "ironing", "bed_linen"].includes(action));
      const needsWalk = form.additionalActions.includes("walk");
      const request = await api.createRequest({
        ...form,
        additionalActions: buildSavedActions(form),
        categoryId: form.categoryId || undefined,
        structuredCategoryId: form.structuredCategoryId || undefined,
        structuredSubcategoryId: form.structuredSubcategoryId || undefined,
        categoryTaskTemplateId: form.categoryTaskTemplateId || undefined,
        frequencyCode: form.frequencyCode,
        categorySpecificFormatCode: form.categorySpecificFormatCode || undefined,
        additionalTask: form.hasAdditionalTask && form.additionalCategoryId && form.additionalSubcategoryId ? {
          categoryId: form.additionalCategoryId,
          subcategoryId: form.additionalSubcategoryId,
          taskTemplateId: form.additionalTaskTemplateId || undefined
        } : undefined,
        cityId: form.cityId || user?.cityId,
        helpFor: form.helpFor || undefined,
        dependentAge: form.dependentAge ? Number(form.dependentAge) : undefined,
        approximateAddressText: [cityName, form.district || "примерный район"].filter(Boolean).join(", "),
        addressText: "",
        addressStreet: form.addressStreet,
        addressHouse: form.addressHouse,
        addressApartment: form.addressApartment,
        addressEntrance: form.addressEntrance,
        addressFloor: form.addressFloor,
        addressIntercom: form.addressIntercom,
        addressComment: form.addressComment,
        expectedDurationHours: Number(form.expectedDurationHours),
        hasElderlyPerson: form.helpFor === "elderly",
        hasChild: form.helpFor === "child",
        hasLimitedMobility,
        needsCooking,
        needsCleaning,
        needsWalk,
        needsHygieneHelp,
        hygieneLevel: form.hygieneLevel,
        physicalLoadLevel: form.physicalLoadLevel,
        taskVolumeLevel: form.taskVolumeLevel,
        urgencyFlags: form.urgencyFlags,
        isRemoteAddress: form.transportOption === "separate",
        transportOption: form.transportOption,
        urgency: form.scheduleType === "urgent" ? "urgent" : form.scheduleType === "regular" ? "regular" : form.urgency,
        comment: [
          form.comment,
          form.addressComment ? `Комментарий к адресу: ${form.addressComment}` : "",
          form.paymentComment ? `Комментарий по оплате: ${form.paymentComment}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      });
      await api.publishRequest(request.id);
      setMessage("Заявка создана и опубликована.");
      navigate("/app/client/requests");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка создания заявки");
    }
  }

  async function accept(responseId: string) {
    try {
      const result = await api.acceptResponse(responseId);
      setMessage("Чат по заявке открыт. Обсудите дату, время, объём работ и условия выполнения.");
      await load();
      navigate(chatPathForRole("client", result.chat.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось принять отклик");
    }
  }

  async function complete(request: ClientRequest) {
    await api.completeRequest(request.id);
    await load();
  }

  function openRequestEditor(request: ClientRequest) {
    setEditingRequest(request);
    const additionalActions = parseJsonArray(request.additionalActionsJson);
    const dependentState = parseJsonArray(request.dependentStateJson);
    const pricingOptions = extractStoredPricingOptions(additionalActions, request.physicalHelpLevel);
    const parsedAddress = splitLegacyAddress(request);
    const addressComment = request.addressComment ?? extractCommentLine(request.comment, "Комментарий к адресу:");
    const paymentComment = extractCommentLine(request.comment, "Комментарий по оплате:");
    setEditForm({
      contactName: request.contactName ?? user?.displayName ?? "",
      contactPhone: request.contactPhone ?? user?.phone ?? "",
      packageId: pricingOptions.packageId || request.pricing?.packageId || "",
      selectedAddonIds: pricingOptions.selectedAddonIds,
      helpFor: request.helpFor ?? "",
      additionalActions: additionalActions.filter((action) => additionalActionOptions.some((option) => option.value === action)),
      dependentState,
      dependentAge: request.dependentAge ? String(request.dependentAge) : "",
      scheduleType: request.scheduleType ?? "once",
      regularPeriod: request.regularPeriod ?? "",
      repeatedVisitsAllowed: Boolean(request.repeatedVisitsAllowed),
      hygieneLevel: pricingOptions.hygieneLevel,
      physicalLoadLevel: pricingOptions.physicalLoadLevel,
      taskVolumeLevel: pricingOptions.taskVolumeLevel,
      urgencyFlags: pricingOptions.urgencyFlags,
      transportOption: pricingOptions.transportOption,
      title: request.title,
      description: request.description,
      addressText: request.addressText ?? "",
      addressStreet: request.addressStreet ?? parsedAddress.street,
      addressHouse: request.addressHouse ?? parsedAddress.house,
      addressApartment: request.addressApartment ?? "",
      addressEntrance: request.addressEntrance ?? "",
      addressFloor: request.addressFloor ?? "",
      addressIntercom: request.addressIntercom ?? "",
      addressComment,
      district: request.district ?? "",
      categoryId: request.categoryId,
      structuredCategoryId: request.categorySnapshot?.snapshot?.category?.id ?? "",
      structuredSubcategoryId: request.categorySnapshot?.snapshot?.subcategory?.id ?? "",
      categoryTaskTemplateId: "",
      cityId: request.cityId,
      date: request.date ? request.date.slice(0, 10) : "",
      timeFrom: request.timeFrom ?? "",
      timeTo: request.timeTo ?? "",
      expectedDurationHours: request.expectedDurationHours ?? 2,
      urgency: request.urgency ?? "normal",
      hasPets: request.hasPets,
      physicalHelpLevel: request.physicalHelpLevel ?? "",
      paymentComment,
      comment: stripGeneratedCommentLines(request.comment)
    });
  }

  async function saveRequestEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingRequest) return;
    const editErrors = [
      !editForm.cityId ? "Укажите город." : "",
      !editForm.addressStreet.trim() ? "Укажите улицу." : "",
      !editForm.addressHouse.trim() ? "Укажите дом." : ""
    ].filter(Boolean);
    if (editErrors.length > 0) {
      setMessage(editErrors.join(" "));
      return;
    }
    const cityName = bootstrap?.cities.find((city) => city.id === (editForm.cityId || user?.cityId))?.name ?? "";
    const hasLimitedMobility = derivedHasLimitedMobility(editForm);
    const needsHygieneHelp = derivedNeedsHygiene(editForm);
    const needsCooking = editForm.additionalActions.some((action) => ["simple_cooking", "full_cooking"].includes(action));
    const needsCleaning = editForm.additionalActions.some((action) => ["light_cleaning", "laundry", "ironing", "bed_linen"].includes(action));
    const needsWalk = editForm.additionalActions.includes("walk");
    const updated = await api.updateRequest(editingRequest.id, {
      ...editForm,
      additionalActions: buildSavedActions(editForm),
      categoryId: editForm.categoryId,
      structuredCategoryId: editForm.structuredCategoryId || undefined,
      structuredSubcategoryId: editForm.structuredSubcategoryId || undefined,
      categoryTaskTemplateId: editForm.categoryTaskTemplateId || undefined,
      cityId: editForm.cityId || user?.cityId,
      helpFor: editForm.helpFor || undefined,
      dependentAge: editForm.dependentAge ? Number(editForm.dependentAge) : undefined,
      approximateAddressText: [cityName, editForm.district || "примерный район"].filter(Boolean).join(", "),
      addressText: "",
      addressStreet: editForm.addressStreet,
      addressHouse: editForm.addressHouse,
      addressApartment: editForm.addressApartment,
      addressEntrance: editForm.addressEntrance,
      addressFloor: editForm.addressFloor,
      addressIntercom: editForm.addressIntercom,
      addressComment: editForm.addressComment,
      expectedDurationHours: Number(editForm.expectedDurationHours),
      hasElderlyPerson: editForm.helpFor === "elderly",
      hasChild: editForm.helpFor === "child",
      hasLimitedMobility,
      needsCooking,
      needsCleaning,
      needsWalk,
      needsHygieneHelp,
      hygieneLevel: editForm.hygieneLevel,
      physicalLoadLevel: editForm.physicalLoadLevel,
      taskVolumeLevel: editForm.taskVolumeLevel,
      urgencyFlags: editForm.urgencyFlags,
      isRemoteAddress: editForm.transportOption === "separate",
      transportOption: editForm.transportOption,
      urgency: editForm.scheduleType === "urgent" ? "urgent" : editForm.scheduleType === "regular" ? "regular" : editForm.urgency,
      timeTo: editForm.timeTo || undefined,
      comment: [
        editForm.comment,
        editForm.addressComment ? `Комментарий к адресу: ${editForm.addressComment}` : "",
        editForm.paymentComment ? `Комментарий по оплате: ${editForm.paymentComment}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    });
    setEditingRequest(null);
    setMessage(`Заявка ${updated.publicNumber ?? ""} обновлена.`);
    await load();
  }

  function openRequestChat(request: ClientRequest) {
    const chatId = request.chat?.id ?? request.chats?.[0]?.id;
    if (!chatId) {
      setMessage("По этой заявке чат ещё не открыт.");
      return;
    }
    navigate(chatPathForRole("client", chatId));
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!reviewForm.requestId || !reviewForm.toUserId || !reviewForm.text.trim()) {
      setMessage("Заполните оценку и комментарий к отзыву.");
      return;
    }
    await api.createReview(reviewForm.requestId, {
      toUserId: reviewForm.toUserId,
      rating: Number(reviewForm.rating),
      text: reviewForm.text,
      likedText: reviewForm.likedText,
      improvementText: reviewForm.improvementText
    });
    setReviewForm({ requestId: "", toUserId: "", rating: 5, text: "", likedText: "", improvementText: "" });
    setMessage("Отзыв сохранён.");
    await load();
  }

  async function sendSupport(event: FormEvent) {
    event.preventDefault();
    if (!supportForm.reason.trim()) {
      setMessage("Укажите тему обращения.");
      return;
    }
    await api.createComplaint({
      type: supportForm.type,
      requestId: supportForm.requestId || undefined,
      reason: supportForm.reason,
      description: supportForm.description
    });
    setSupportForm({ type: "message", reason: "", description: "", requestId: "" });
    setMessage("Обращение отправлено администратору.");
    await load();
  }

  function validateRequestForm() {
    const errors: string[] = [];
    if (!form.cityId && !user?.cityId) errors.push("Укажите город.");
    if (!form.structuredCategoryId) errors.push("Выберите категорию.");
    if (!form.structuredSubcategoryId) errors.push("Выберите задачу внутри категории.");
    if (!form.title.trim()) errors.push("Коротко опишите, какая помощь нужна");
    if (!form.description.trim()) errors.push("Опишите задачу");
    if (!form.addressStreet.trim()) errors.push("Укажите улицу.");
    if (!form.addressHouse.trim()) errors.push("Укажите дом.");
    if (!form.date) errors.push("Укажите дату");
    if (!form.timeFrom) errors.push("Укажите время");
    if (!Number(form.expectedDurationHours)) errors.push("Укажите длительность");
    if (form.helpFor === "child" && !form.dependentAge) errors.push("Укажите возраст ребёнка");
    return errors;
  }

  return (
    <Shell title={sectionTitleForPath(location.pathname, clientNavigation)} navigation={clientNavigation}>
      {message && <p className="notice">{message}</p>}

      {activeTab === "Мои заявки" && (
        <div className="list">
          {requests.filter((request) => request.status !== "completed").map((request) => (
            <RequestCard key={request.id} request={request} onTitleClick={() => openRequestEditor(request)}>
              {request.isHiddenFromPerformers && request.pendingStructureUpdate && <div className="notice"><strong>Заявка временно скрыта от Помощников.</strong><p>Проверьте изменения структуры и подтвердите обновлённые данные.</p><button className="primary-button" type="button" onClick={() => confirmStructureUpdate(request)}>Подтвердить обновлённые данные</button></div>}
              <button className="secondary-button" type="button" onClick={() => openRequestEditor(request)}>
                Редактировать
              </button>
              <button className="secondary-button" type="button" onClick={() => openRequestChat(request)}>
                <MessageCircle size={18} />
                Перейти в чат
              </button>
              {request.responses && request.responses.length > 0 && (
                <div className="response-list">
                  {request.responses.map((response) => (
                    <div key={response.id} className="response-row">
                      <div>
                        <strong>{response.performer?.displayName ?? "Помощник"}</strong>
                        <div className="trust-row">
                          <StatusBadge tone={response.performer?.childcareWarning ? "danger" : "success"}>
                            {labelCriminalRecord(response.performer?.criminalRecordCertificateStatus)}
                          </StatusBadge>
                          <span>рейтинг {response.performer?.rating ?? 0}</span>
                          <span>{response.performer?.completedJobsCount ?? 0} заявок</span>
                        </div>
                      </div>
                      {response.status === "pending" && (
                        <button className="primary-button" type="button" onClick={() => accept(response.id)}>
                  <MessageCircle size={18} />
                  Открыть чат по заявке
                </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {request.status === "in_progress" && (
                <button className="secondary-button" type="button" onClick={() => complete(request)}>
                  <Check size={18} />
                  Завершить заявку
                </button>
              )}
              {request.status === "completed" && request.selectedPerformerId && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setReviewForm({ ...reviewForm, requestId: request.id, toUserId: request.selectedPerformerId ?? "" })}
                >
                  <Star size={18} />
                  Оценить помощника
                </button>
              )}
            </RequestCard>
          ))}
          {requests.filter((request) => request.status !== "completed").length === 0 && (
            <EmptyState
              title="Активных заявок пока нет."
              action={<button className="primary-button" type="button" onClick={() => navigate("/app/client/requests/new")}>Создать заявку</button>}
            />
          )}
        </div>
      )}

      {activeTab === "Выполненные заявки" && (
        <div className="list">
          {requests.filter((request) => request.status === "completed").map((request) => (
            <RequestCard key={request.id} request={request} onTitleClick={() => openRequestEditor(request)}>
              <button className="secondary-button" type="button" onClick={() => openRequestChat(request)}>
                <MessageCircle size={18} />
                Перейти в чат
              </button>
              {request.selectedPerformerId && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setReviewForm({ ...reviewForm, requestId: request.id, toUserId: request.selectedPerformerId ?? "" })}
                >
                  <Star size={18} />
                  Оценить помощника
                </button>
              )}
            </RequestCard>
          ))}
          {requests.filter((request) => request.status === "completed").length === 0 && <EmptyState title="Выполненных заявок пока нет." />}
        </div>
      )}

      {reviewForm.requestId && (
        <form className="form-grid" onSubmit={submitReview}>
          <h3 className="span-2">
            Оценить помощника по заявке {requests.find((request) => request.id === reviewForm.requestId)?.publicNumber ?? ""}
          </h3>
          <p className="privacy-note span-2">Ваш отзыв поможет другим заказчикам выбрать помощника.</p>
          <label>
            Оценка
            <select value={reviewForm.rating} onChange={(event) => setReviewForm({ ...reviewForm, rating: Number(event.target.value) })}>
              {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
            </select>
          </label>
          <label className="span-2">
            Комментарий
            <textarea value={reviewForm.text} onChange={(event) => setReviewForm({ ...reviewForm, text: event.target.value })} />
          </label>
          <label className="span-2">
            Что понравилось
            <input value={reviewForm.likedText} onChange={(event) => setReviewForm({ ...reviewForm, likedText: event.target.value })} />
          </label>
          <label className="span-2">
            Что можно улучшить
            <input value={reviewForm.improvementText} onChange={(event) => setReviewForm({ ...reviewForm, improvementText: event.target.value })} />
          </label>
          <button className="primary-button span-2" type="submit">Сохранить отзыв</button>
        </form>
      )}

      {activeTab === "Создать заявку" && user && (
        <RequestCreationForm
          cities={bootstrap?.cities ?? []}
          user={user}
          onCreated={async () => {
            await load();
            navigate("/app/client/requests");
          }}
        />
      )}

      {(activeTab as string) === "__legacy_create_request" && (
        <form className="form-grid" onSubmit={createRequest}>
          <h2 className="form-section-title span-2">Контакты и направление помощи</h2>
          {formErrors.length > 0 && (
            <div className="notice span-2">
              <strong>Заполните поля:</strong>
              <ul>
                {formErrors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </div>
          )}
          <CityCombobox cities={bootstrap?.cities ?? []} value={form.cityId} onChange={(cityId) => setForm({ ...form, cityId, structuredCategoryId: "", structuredSubcategoryId: "", categoryTaskTemplateId: "", additionalCategoryId: "", additionalSubcategoryId: "", additionalTaskTemplateId: "" })} label="Город Подопечного" />
          {form.cityId && bootstrap?.cities.find((city) => city.id === form.cityId)?.serviceStatus !== "active" && (
            <p className="notice">В этом городе пока может быть мало Помощников. Заявка будет доступна тем, кто зарегистрируется в этом городе.</p>
          )}
          <label>
            Имя
            <input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />
          </label>
          <label>
            Телефон
            <input value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} />
          </label>
          <label>
            Категория
            <select value={form.structuredCategoryId} onChange={(event) => setForm({ ...form, structuredCategoryId: event.target.value, structuredSubcategoryId: "", categoryTaskTemplateId: "", categorySpecificFormatCode: "" })} disabled={!form.cityId}>
              <option value="">Выберите направление</option>
              {structuredCategories?.categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
            </select>
          </label>
          <label>
            Подкатегория / задача
            <select value={form.structuredSubcategoryId} onChange={(event) => setForm({ ...form, structuredSubcategoryId: event.target.value, categoryTaskTemplateId: "" })} disabled={!form.structuredCategoryId}>
              <option value="">Выберите задачу</option>
              {structuredCategories?.categories.find((category) => category.id === form.structuredCategoryId)?.children?.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
            </select>
          </label>
          {form.structuredSubcategoryId && (structuredCategories?.categories
            .find((category) => category.id === form.structuredCategoryId)
            ?.children?.find((category) => category.id === form.structuredSubcategoryId)?.taskTemplates?.length ?? 0) > 0 && (
            <label>
              Типовая задача
              <select value={form.categoryTaskTemplateId} onChange={(event) => setForm({ ...form, categoryTaskTemplateId: event.target.value })}>
                <option value="">Выберите типовую задачу</option>
                {structuredCategories?.categories
                  .find((category) => category.id === form.structuredCategoryId)
                  ?.children?.find((category) => category.id === form.structuredSubcategoryId)?.taskTemplates?.map((task) => (
                    <option key={task.id} value={task.id}>{task.title}</option>
                  ))}
              </select>
            </label>
          )}
          {form.structuredCategoryId && <CategoryGuidance categories={structuredCategories} categoryId={form.structuredCategoryId} />}
          <label>
            Как часто нужна помощь?
            <select value={form.frequencyCode} onChange={(event) => setForm({ ...form, frequencyCode: event.target.value })}>
              {requestFrequencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {form.structuredCategoryId && (
            <label>
              {categorySpecificQuestion(structuredCategories?.categories.find((category) => category.id === form.structuredCategoryId)?.slug)}
              <select value={form.categorySpecificFormatCode} onChange={(event) => setForm({ ...form, categorySpecificFormatCode: event.target.value })}>
                <option value="">По согласованию</option>
                {categorySpecificOptions(structuredCategories?.categories.find((category) => category.id === form.structuredCategoryId)?.slug).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          <section className="span-2 details-box request-additional-task">
            <h3>Нужно что-то ещё?</h3>
            {!form.hasAdditionalTask ? (
              <button className="secondary-button" type="button" onClick={() => setForm({ ...form, hasAdditionalTask: true })}>Добавить дополнительную задачу</button>
            ) : (
              <div className="form-grid">
                <label>
                  Дополнительная категория
                  <select value={form.additionalCategoryId} onChange={(event) => setForm({ ...form, additionalCategoryId: event.target.value, additionalSubcategoryId: "", additionalTaskTemplateId: "" })}>
                    <option value="">Выберите категорию</option>
                    {structuredCategories?.categories.filter((category) => category.id !== form.structuredCategoryId).map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
                  </select>
                </label>
                <label>
                  Дополнительная задача
                  <select value={form.additionalSubcategoryId} onChange={(event) => setForm({ ...form, additionalSubcategoryId: event.target.value, additionalTaskTemplateId: "" })} disabled={!form.additionalCategoryId}>
                    <option value="">Выберите задачу</option>
                    {structuredCategories?.categories.find((category) => category.id === form.additionalCategoryId)?.children?.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
                  </select>
                </label>
                <button className="link-button span-2" type="button" onClick={() => setForm({ ...form, hasAdditionalTask: false, additionalCategoryId: "", additionalSubcategoryId: "", additionalTaskTemplateId: "" })}>Убрать дополнительную задачу</button>
              </div>
            )}
          </section>
          <label>
            Кому нужна помощь
            <select value={form.helpFor} onChange={(event) => setForm({ ...form, helpFor: event.target.value })}>
              <option value="">Выберите вариант</option>
              <option value="elderly">Пожилому человеку</option>
              <option value="child">Ребёнку</option>
              <option value="limited_mobility">Маломобильному человеку</option>
              <option value="home_family">Для дома / семьи</option>
              <option value="other">Другое</option>
            </select>
          </label>
          <label className="span-2">
            Коротко опишите, какая помощь нужна
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Например: Помощь с уборкой и приготовлением еды"
            />
          </label>
          <h2 className="form-section-title span-2">Адрес выполнения</h2>
          <label>
            Улица
            <input value={form.addressStreet} onChange={(event) => setForm({ ...form, addressStreet: event.target.value })} placeholder="Например: ул. Мира" />
          </label>
          <label>
            Дом
            <input value={form.addressHouse} onChange={(event) => setForm({ ...form, addressHouse: event.target.value })} placeholder="Например: 1" />
          </label>
          <label>
            Квартира
            <input value={form.addressApartment} onChange={(event) => setForm({ ...form, addressApartment: event.target.value })} />
          </label>
          <label>
            Подъезд
            <input value={form.addressEntrance} onChange={(event) => setForm({ ...form, addressEntrance: event.target.value })} />
          </label>
          <label>
            Этаж
            <input value={form.addressFloor} onChange={(event) => setForm({ ...form, addressFloor: event.target.value })} />
          </label>
          <label>
            Домофон
            <input value={form.addressIntercom} onChange={(event) => setForm({ ...form, addressIntercom: event.target.value })} />
          </label>
          <label className="span-2">
            Комментарий к адресу
            <input
              value={form.addressComment}
              onChange={(event) => setForm({ ...form, addressComment: event.target.value })}
              placeholder="Например: подъезд, этаж, домофон, ориентир. Эта информация скрыта до подтверждения заявки."
            />
          </label>
          <label>
            Район или ориентир
            <input
              value={form.district}
              onChange={(event) => setForm({ ...form, district: event.target.value })}
              placeholder="Например: Центр"
            />
          </label>
          <p className="privacy-note span-2">
            Точный адрес, квартира, подъезд, этаж и домофон будут скрыты от помощников до согласования условий и перехода заявки в работу.
          </p>
          <h2 className="form-section-title span-2">Задачи и состояние подопечного</h2>
          <label className="span-2">
            Описание
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          {containsMedicalProcedure(`${form.title} ${form.description}`) && (
            <p className="notice span-2">Сервис не принимает задачи с медицинскими процедурами. При угрозе жизни или здоровью обращайтесь в экстренные службы.</p>
          )}
          {containsDiaperTask(`${form.title} ${form.description}`) && structuredCategories?.categories.find((category) => category.id === form.structuredCategoryId)?.slug.includes("home-help") && (
            <p className="notice span-2">Задача «Смена подгузника» относится к категории «Уход на дому без медицинских процедур». Вы можете добавить её как дополнительную задачу.</p>
          )}
          <fieldset className="span-2 checkbox-grid">
            <legend>Дополнительные действия</legend>
            {additionalActionOptions.map((option) => (
              <label className="checkbox-row" key={option.value}>
                <input
                  type="checkbox"
                  checked={form.additionalActions.includes(option.value)}
                  onChange={() => setForm({ ...form, additionalActions: toggleValue(form.additionalActions, option.value) })}
                />
                <span className="checkbox-copy">
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.hasPets}
                onChange={(event) => setForm({ ...form, hasPets: event.target.checked })}
              />
              Есть домашние животные
            </label>
          </fieldset>
          <fieldset className="span-2 checkbox-grid">
            <legend>Состояние подопечного</legend>
            {dependentStateOptions.map((option) => (
              <label className="checkbox-row" key={option.value}>
                <input
                  type="checkbox"
                  checked={form.dependentState.includes(option.value)}
                  onChange={() => setForm({ ...form, dependentState: toggleValue(form.dependentState, option.value) })}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <label>
            Возраст подопечного
            <input
              type="number"
              min={0}
              value={form.dependentAge}
              onChange={(event) => setForm({ ...form, dependentAge: event.target.value })}
              placeholder="Например: 72"
            />
          </label>
          <label>
            Уровень гигиенической помощи
            <select value={form.hygieneLevel} onChange={(event) => setForm({ ...form, hygieneLevel: event.target.value })}>
              {hygieneLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Уровень физической помощи
            <select
              value={form.physicalLoadLevel}
              onChange={(event) => setForm({ ...form, physicalLoadLevel: event.target.value, physicalHelpLevel: event.target.value })}
            >
              {physicalLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Объём задач
            <select value={form.taskVolumeLevel} onChange={(event) => setForm({ ...form, taskVolumeLevel: event.target.value })}>
              {taskVolumeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Адрес и транспорт
            <select value={form.transportOption} onChange={(event) => setForm({ ...form, transportOption: event.target.value })}>
              <option value="city">В пределах города</option>
              <option value="separate">Удалённый адрес / СНТ / дача</option>
            </select>
            <small>Транспорт для СНТ, дач и удалённых адресов согласуется отдельно.</small>
          </label>
          <h2 className="form-section-title span-2">Дата, время и регулярность</h2>
          <label>
            График помощи
            <select value={form.scheduleType} onChange={(event) => setForm({ ...form, scheduleType: event.target.value })}>
              <option value="once">Разово</option>
              <option value="regular">Регулярно</option>
              <option value="urgent">Срочно</option>
            </select>
          </label>
          <label>
            Дата
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            <small>{form.date ? `Выбранная дата: ${formatDateRu(form.date)}` : "Формат даты: дд.мм.гггг"}</small>
          </label>
          <label className="span-2">
            Период, если регулярно
            <input
              value={form.regularPeriod}
              onChange={(event) => setForm({ ...form, regularPeriod: event.target.value })}
              placeholder="Например: 2 раза в неделю в течение месяца"
            />
          </label>
          <label className="checkbox-row span-2">
            <input
              type="checkbox"
              checked={form.repeatedVisitsAllowed}
              onChange={(event) => setForm({ ...form, repeatedVisitsAllowed: event.target.checked })}
            />
            Возможны повторные визиты
          </label>
          <label>
            С
            <input
              type="time"
              value={form.timeFrom}
              onChange={(event) => setForm({ ...form, timeFrom: event.target.value })}
            />
            <small>{form.timeFrom ? `Время: ${formatTimeRu(form.timeFrom)}` : "Формат времени: 10:00"}</small>
          </label>
          <label>
            До
            <input type="time" value={form.timeTo} onChange={(event) => setForm({ ...form, timeTo: event.target.value })} />
            <small>{form.timeTo ? `Время: ${formatTimeRu(form.timeTo)}` : "Формат времени: 12:00"}</small>
          </label>
          <label>
            Длительность, часов
            <input
              type="number"
              min={1}
              step={0.5}
              value={form.expectedDurationHours}
              onChange={(event) => setForm({ ...form, expectedDurationHours: Number(event.target.value) })}
            />
          </label>
          <fieldset className="span-2 checkbox-grid">
            <legend>Возможные доплаты</legend>
            {pricingAddonOptions.map((option) => (
              <label className="checkbox-row" key={option.value}>
                <input
                  type="checkbox"
                  checked={form.selectedAddonIds.includes(option.value)}
                  onChange={() => setForm({ ...form, selectedAddonIds: toggleValue(form.selectedAddonIds, option.value) })}
                />
                <span className="checkbox-copy"><span>{option.label}</span><small>{option.description}</small></span>
              </label>
            ))}
          </fieldset>
          <h2 className="form-section-title span-2">Рекомендуемая стоимость</h2>
          <section className="span-2 structured-price-summary" aria-live="polite">
            {!form.cityId ? <p>Выберите город Подопечного, чтобы увидеть доступные направления помощи.</p>
              : !form.structuredCategoryId ? <p>Выберите категорию, чтобы увидеть ориентировочную сумму.</p>
                : !form.structuredSubcategoryId ? <p>Выберите задачу внутри категории, чтобы уточнить ориентир.</p>
                  : !structuredQuote ? <p>Для этой задачи ориентир пока не задан. Итоговая сумма согласуется в чате.</p>
                    : (
                      <>
                        {structuredQuote.finalCalculatedRecommendedPrice !== null ? (
                          <p className="structured-price-summary__amount">Ориентировочная сумма: <strong>{structuredQuote.finalCalculatedRecommendedPrice.toLocaleString("ru-RU")} ₽</strong></p>
                        ) : <p>Для этой задачи ориентир пока не задан. Итоговая сумма согласуется в чате.</p>}
                        {structuredQuote.breakdown.map((line) => (
                          <p key={`${line.kind}-${line.categoryTitle}`}>
                            {line.kind === "main" ? "Основная задача" : "Дополнительная задача"}: {line.subcategoryTitle ?? line.taskTemplateTitle ?? line.categoryTitle} — {line.calculatedRecommendedPrice === null ? "по согласованию" : `${line.calculatedRecommendedPrice.toLocaleString("ru-RU")} ₽`}
                          </p>
                        ))}
                        {structuredQuote.baseRange?.min !== null && structuredQuote.baseRange && (
                          <p>База ориентиров: {formatStructuredRange(structuredQuote.baseRange.min, structuredQuote.baseRange.max)}.</p>
                        )}
                        {structuredQuote.sourceMessage && <p>{structuredQuote.sourceMessage}</p>}
                        <p>{structuredQuote.userMessage}</p>
                        {structuredQuote.frequencyCode === "several_weekly" && <p>При регулярной помощи условия можно согласовать в чате.</p>}
                        {structuredQuote.warnings.map((warning) => <p className="notice" key={warning}>{warning}</p>)}
                      </>
                    )}
          </section>
          <label className="span-2">
            Комментарий по оплате
            <input
              value={form.paymentComment}
              onChange={(event) => setForm({ ...form, paymentComment: event.target.value })}
              placeholder="Например: если объём помощи изменится, согласуем сумму до начала визита"
            />
          </label>
          <label className="span-2">
            Комментарий
            <textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
          </label>
          <h2 className="form-section-title span-2">Проверка и публикация</h2>
          <button className="primary-button span-2" type="submit">
            <Plus size={18} />
            Создать и опубликовать
          </button>
          <p className="privacy-note span-2">
            Инъекции, капельницы, перевязки, лечение, диагностика и другие медицинские процедуры не публикуются.
          </p>
        </form>
      )}

      {activeTab === "Мой баланс" && <BalancePanel />}

      {activeTab === "Мой профиль" && (
        <section className="panel-grid panel-grid--compact">
          <AccountSecurityPanel />
          <ContactDetails user={user} />
          <div className="metric">
            <span>Имя</span>
            <strong>{user?.displayName ?? "Не указано"}</strong>
          </div>
          <div className="metric">
            <span>Телефон</span>
            <strong>{user?.phone ?? "Не указан"}</strong>
          </div>
          <div className="metric">
            <span>Город</span>
            <strong>{bootstrap?.cities.find((city) => city.id === user?.cityId)?.name ?? "Не выбран"}</strong>
          </div>
          <div className="metric">
            <span>Основной баланс</span>
            <strong>{user?.balance ?? 0} ₽</strong>
          </div>
          <div className="metric">
            <span>Бонусный баланс</span>
            <strong>{user?.bonusBalance ?? 0} ₽</strong>
          </div>
          <div className="metric">
            <span>Доступно для заявок</span>
            <strong>{(user?.balance ?? 0) + (user?.bonusBalance ?? 0)} ₽</strong>
          </div>
          <div className="metric">
            <span>Заявок всего</span>
            <strong>{requests.length}</strong>
          </div>
          <div className="metric">
            <span>Активных обращений</span>
            <strong>{complaints.filter((complaint) => !["resolved", "rejected"].includes(complaint.status)).length}</strong>
          </div>
          <section className="plain-section span-2">
            <h2>Профиль заказчика</h2>
            <p className="privacy-note">Редактирование профиля будет доступно позже.</p>
          </section>
          <UserCitiesPanel />
          <ConsentDocumentsPanel />
        </section>
      )}

      {activeTab === "Чаты" && (
        <div className="split">
          <aside className="side-list">
            <strong>Активные чаты</strong>
            {chats.filter((chat) => !chat.archivedAt && !["not_agreed", "archived", "completed"].includes(chat.status)).map((chat) => (
              <button key={chat.id} type="button" onClick={() => navigate(chatPathForRole("client", chat.id))}>
                {requestDisplayTitle(chat.request)}
              </button>
            ))}
            <strong>Архивные чаты</strong>
            {chats.filter((chat) => chat.archivedAt || ["not_agreed", "archived", "completed"].includes(chat.status)).map((chat) => (
              <button key={chat.id} type="button" onClick={() => navigate(chatPathForRole("client", chat.id))}>
                {requestDisplayTitle(chat.request)}
              </button>
            ))}
          </aside>
          {activeChatId ? <ChatPanel chatId={activeChatId} /> : <p className="empty-text">Нет открытых чатов.</p>}
        </div>
      )}
      {activeTab === "Сообщения от сервиса" && <ServiceMessagesPanel />}

      {activeTab === "Мои обращения" && (
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
                {requests.map((request) => <option key={request.id} value={request.id}>{request.publicNumber} — {request.title}</option>)}
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
              <StatusBadge tone="info">{labelStatus(complaint.status)}</StatusBadge>
              <span>{complaint.adminResponse ?? complaint.adminComment ?? "Ответ администратора пока не добавлен"}</span>
            </div>
          ))}
          <h3>Архив обращений</h3>
          {complaints.filter((complaint) => ["resolved", "rejected"].includes(complaint.status)).map((complaint) => (
            <div className="data-row" key={complaint.id}>
              <strong>{complaint.publicNumber ?? "обращение"} — {complaint.reason}</strong>
              <span>{complaint.request?.publicNumber ?? "без заявки"}</span>
              <StatusBadge tone="info">{labelStatus(complaint.status)}</StatusBadge>
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

      {activeTab === "Согласия" && (
        <ConsentDocumentsPanel />
      )}

      {editingRequest && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel">
            <div className="card__head">
              <h2>Редактировать заявку {editingRequest.publicNumber}</h2>
              <button className="secondary-button" type="button" onClick={() => setEditingRequest(null)}>Закрыть</button>
            </div>
            {editingRequest.status === "in_progress" ? (
              <p className="notice">Заявка уже в работе. Для изменения условий создайте запрос на изменение.</p>
            ) : ["completed", "archived"].includes(editingRequest.status) ? (
              <p className="notice">Выполненную или архивную заявку редактировать нельзя. История остаётся доступной для просмотра.</p>
            ) : (
              <form className="form-grid" onSubmit={saveRequestEdit}>
                <h3 className="form-section-title span-2">Кому и какая помощь нужна</h3>
                <CityCombobox cities={bootstrap?.cities ?? []} value={editForm.cityId} onChange={(cityId) => setEditForm({ ...editForm, cityId })} label="Город Подопечного" />
                <label>
                  Категория
                  <select value={editForm.categoryId} onChange={(event) => setEditForm({ ...editForm, categoryId: event.target.value })}>
                    <option value="">Выберите категорию</option>
                    {bootstrap?.categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label className="span-2">
                  Пакет помощи
                  <select value={editForm.packageId} onChange={(event) => setEditForm({ ...editForm, packageId: event.target.value })}>
                    <option value="">Подобрать по заявке</option>
                    {pricingPackageOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label} — {option.price}</option>
                    ))}
                  </select>
                  <small>Действия внутри выбранного пакета и согласованного времени не создают отдельную доплату.</small>
                </label>
                <label>
                  Кому нужна помощь
                  <select value={editForm.helpFor} onChange={(event) => setEditForm({ ...editForm, helpFor: event.target.value })}>
                    <option value="">Выберите вариант</option>
                    <option value="elderly">Пожилому человеку</option>
                    <option value="child">Ребёнку</option>
                    <option value="limited_mobility">Маломобильному человеку</option>
                    <option value="home_family">Для дома / семьи</option>
                    <option value="other">Другое</option>
                  </select>
                </label>
                <label className="span-2">
                  Коротко опишите, какая помощь нужна
                  <input value={editForm.title} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })} />
                </label>
                <h3 className="form-section-title span-2">Адрес выполнения</h3>
                <label>
                  Улица
                  <input value={editForm.addressStreet} onChange={(event) => setEditForm({ ...editForm, addressStreet: event.target.value })} />
                </label>
                <label>
                  Дом
                  <input value={editForm.addressHouse} onChange={(event) => setEditForm({ ...editForm, addressHouse: event.target.value })} />
                </label>
                <label>
                  Квартира
                  <input value={editForm.addressApartment} onChange={(event) => setEditForm({ ...editForm, addressApartment: event.target.value })} />
                </label>
                <label>
                  Подъезд
                  <input value={editForm.addressEntrance} onChange={(event) => setEditForm({ ...editForm, addressEntrance: event.target.value })} />
                </label>
                <label>
                  Этаж
                  <input value={editForm.addressFloor} onChange={(event) => setEditForm({ ...editForm, addressFloor: event.target.value })} />
                </label>
                <label>
                  Домофон
                  <input value={editForm.addressIntercom} onChange={(event) => setEditForm({ ...editForm, addressIntercom: event.target.value })} />
                </label>
                <label className="span-2">
                  Комментарий к адресу
                  <input value={editForm.addressComment} onChange={(event) => setEditForm({ ...editForm, addressComment: event.target.value })} />
                </label>
                <label>
                  Район или ориентир
                  <input value={editForm.district} onChange={(event) => setEditForm({ ...editForm, district: event.target.value })} />
                </label>
                <p className="privacy-note span-2">
                  Точный адрес, квартира, подъезд, этаж и домофон будут скрыты от помощников до согласования условий и перехода заявки в работу.
                </p>
                <h3 className="form-section-title span-2">Задачи и состояние подопечного</h3>
                <label className="span-2">
                  Описание
                  <textarea value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} />
                </label>
                <fieldset className="span-2 checkbox-grid">
                  <legend>Дополнительные действия</legend>
                  {additionalActionOptions.map((option) => (
                    <label className="checkbox-row" key={option.value}>
                      <input
                        type="checkbox"
                        checked={editForm.additionalActions.includes(option.value)}
                        onChange={() => setEditForm({ ...editForm, additionalActions: toggleValue(editForm.additionalActions, option.value) })}
                      />
                      <span className="checkbox-copy">
                        <span>{option.label}</span>
                        {option.description && <small>{option.description}</small>}
                      </span>
                    </label>
                  ))}
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={editForm.hasPets}
                      onChange={(event) => setEditForm({ ...editForm, hasPets: event.target.checked })}
                    />
                    Есть домашние животные
                  </label>
                </fieldset>
                <fieldset className="span-2 checkbox-grid">
                  <legend>Состояние подопечного</legend>
                  {dependentStateOptions.map((option) => (
                    <label className="checkbox-row" key={option.value}>
                      <input
                        type="checkbox"
                        checked={editForm.dependentState.includes(option.value)}
                        onChange={() => setEditForm({ ...editForm, dependentState: toggleValue(editForm.dependentState, option.value) })}
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
                <label>
                  Возраст подопечного
                  <input
                    type="number"
                    min={0}
                    value={editForm.dependentAge}
                    onChange={(event) => setEditForm({ ...editForm, dependentAge: event.target.value })}
                  />
                </label>
                <label>
                  Уровень гигиенической помощи
                  <select value={editForm.hygieneLevel} onChange={(event) => setEditForm({ ...editForm, hygieneLevel: event.target.value })}>
                    {hygieneLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  Уровень физической помощи
                  <select
                    value={editForm.physicalLoadLevel}
                    onChange={(event) => setEditForm({ ...editForm, physicalLoadLevel: event.target.value, physicalHelpLevel: event.target.value })}
                  >
                    {physicalLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  Объём задач
                  <select value={editForm.taskVolumeLevel} onChange={(event) => setEditForm({ ...editForm, taskVolumeLevel: event.target.value })}>
                    {taskVolumeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  Адрес и транспорт
                  <select value={editForm.transportOption} onChange={(event) => setEditForm({ ...editForm, transportOption: event.target.value })}>
                    <option value="city">В пределах города</option>
                    <option value="separate">Удалённый адрес / СНТ / дача</option>
                  </select>
                  <small>Транспорт для СНТ, дач и удалённых адресов согласуется отдельно.</small>
                </label>
                <h3 className="form-section-title span-2">Дата, время и регулярность</h3>
                <label>
                  График помощи
                  <select value={editForm.scheduleType} onChange={(event) => setEditForm({ ...editForm, scheduleType: event.target.value })}>
                    <option value="once">Разово</option>
                    <option value="regular">Регулярно</option>
                    <option value="urgent">Срочно</option>
                  </select>
                </label>
                <label>
                  Дата
                  <input type="date" value={editForm.date} onChange={(event) => setEditForm({ ...editForm, date: event.target.value })} />
                  <small>{editForm.date ? `Выбранная дата: ${formatDateRu(editForm.date)}` : "Формат даты: дд.мм.гггг"}</small>
                </label>
                <label className="span-2">
                  Период, если регулярно
                  <input value={editForm.regularPeriod} onChange={(event) => setEditForm({ ...editForm, regularPeriod: event.target.value })} />
                </label>
                <label className="checkbox-row span-2">
                  <input
                    type="checkbox"
                    checked={editForm.repeatedVisitsAllowed}
                    onChange={(event) => setEditForm({ ...editForm, repeatedVisitsAllowed: event.target.checked })}
                  />
                  Возможны повторные визиты
                </label>
                <label>
                  С
                  <input type="time" value={editForm.timeFrom} onChange={(event) => setEditForm({ ...editForm, timeFrom: event.target.value })} />
                  <small>{editForm.timeFrom ? `Время: ${formatTimeRu(editForm.timeFrom)}` : "Формат времени: 10:00"}</small>
                </label>
                <label>
                  До
                  <input type="time" value={editForm.timeTo} onChange={(event) => setEditForm({ ...editForm, timeTo: event.target.value })} />
                  <small>{editForm.timeTo ? `Время: ${formatTimeRu(editForm.timeTo)}` : "Формат времени: 12:00"}</small>
                </label>
                <label>
                  Длительность, часов
                  <input type="number" min={1} step={0.5} value={editForm.expectedDurationHours} onChange={(event) => setEditForm({ ...editForm, expectedDurationHours: Number(event.target.value) })} />
                </label>
                <fieldset className="span-2 checkbox-grid">
                  <legend>Возможные доплаты</legend>
                  {pricingAddonOptions.map((option) => (
                    <label className="checkbox-row" key={option.value}>
                      <input
                        type="checkbox"
                        checked={editForm.selectedAddonIds.includes(option.value)}
                        onChange={() => setEditForm({ ...editForm, selectedAddonIds: toggleValue(editForm.selectedAddonIds, option.value) })}
                      />
                      <span className="checkbox-copy"><span>{option.label}</span><small>{option.description}</small></span>
                    </label>
                  ))}
                </fieldset>
                <h3 className="form-section-title span-2">Обновлённый расчёт</h3>
                <section className="span-2">
                  <PriceSummary pricing={editQuote} fallbackPayment={editingRequest.priceEstimateAmount} role="client" />
                </section>
                <label className="span-2">
                  Комментарий по оплате
                  <input value={editForm.paymentComment} onChange={(event) => setEditForm({ ...editForm, paymentComment: event.target.value })} />
                </label>
                <label className="span-2">
                  Комментарий
                  <textarea value={editForm.comment} onChange={(event) => setEditForm({ ...editForm, comment: event.target.value })} />
                </label>
                <button className="primary-button span-2" type="submit">Сохранить изменения</button>
              </form>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}

const additionalActionOptions = [
  { value: "light_cleaning", label: "Лёгкая уборка", description: "Влияет на бытовой формат визита." },
  { value: "laundry", label: "стирка", description: "Расширяет бытовой объём." },
  { value: "ironing", label: "глажка", description: "Расширяет бытовой объём." },
  { value: "bed_linen", label: "смена постельного", description: "Может повысить объём бытового визита." },
  { value: "simple_cooking", label: "помощь с простой едой", description: "Если действие входит в пакет и укладывается во время, отдельной доплаты нет." },
  { value: "full_cooking", label: "приготовление еды", description: "Объём и время согласуются до подтверждения заявки." },
  { value: "food_help", label: "помощь с едой", description: "Может входить в бытовую помощь или присмотр." },
  { value: "clothes_help", label: "помощь с одеждой", description: "Влияет на уровень физической поддержки." },
  { value: "wash_help", label: "помощь умыться", description: "Лёгкая гигиена влияет на формат ухода." },
  { value: "toilet_help", label: "помощь с туалетом", description: "Поднимает уровень ухода." },
  { value: "diaper_change", label: "смена подгузника", description: "Не отдельная услуга, но повышает формат визита." },
  { value: "washing", label: "подмывание", description: "Повышает уровень ухода и требует согласования." },
  { value: "movement_help", label: "помощь при передвижении", description: "Влияет на физическую нагрузку." },
  { value: "escort", label: "сопровождение", description: "Переводит заявку в формат сопровождения." },
  { value: "walk", label: "прогулка", description: "Учитывается как сопровождение." },
  { value: "errands", label: "покупки / поручения", description: "Учитывается как поручение или сопровождение." },
  { value: "companionship", label: "присмотр и общение", description: "Влияет на длительный присмотр." },
  { value: "hygiene", label: "бытовая гигиеническая помощь", description: "Объём должен быть безопасным и заранее согласованным." }
];

const requestFrequencyOptions = [
  { value: "once", label: "Разово" },
  { value: "several_weekly", label: "Несколько раз в неделю" },
  { value: "daily", label: "Ежедневно" },
  { value: "regular_schedule", label: "Регулярно по графику" },
  { value: "urgent_today", label: "Срочно / сегодня" },
  { value: "unknown", label: "Пока не знаю, обсудить в чате" }
];

function categorySpecificQuestion(slug?: string) {
  if (slug?.includes("accompan")) return "Какой формат сопровождения?";
  if (slug?.includes("supervision") || slug?.includes("care")) return "Какая помощь нужна?";
  if (slug?.includes("shopping") || slug?.includes("delivery")) return "Что нужно сделать?";
  return "Дополнительное уточнение";
}

function categorySpecificOptions(slug?: string) {
  if (slug?.includes("accompan")) return [
    { value: "one_way", label: "В одну сторону" },
    { value: "round_trip", label: "Туда и обратно" },
    { value: "with_waiting", label: "С ожиданием" }
  ];
  if (slug?.includes("supervision") || slug?.includes("care")) return [
    { value: "companionship", label: "Побыть рядом" },
    { value: "hygiene_help", label: "Помощь с гигиеной" },
    { value: "diaper_change", label: "Смена подгузника" },
    { value: "dressing_help", label: "Помощь переодеться" },
    { value: "meal_help", label: "Помощь с приёмом пищи" },
    { value: "walk_supervision", label: "Прогулка и присмотр" }
  ];
  if (slug?.includes("shopping") || slug?.includes("delivery")) return [
    { value: "buy_deliver", label: "Купить и принести" },
    { value: "pickup_order", label: "Забрать заказ" },
    { value: "transfer_item", label: "Передать вещь" }
  ];
  return [];
}

function containsMedicalProcedure(value: string) {
  const normalized = value.toLocaleLowerCase("ru-RU");
  return ["укол", "инъекц", "капельниц", "перевяз", "обработка ран", "назначить лекар", "медицинский уход"].some((term) => normalized.includes(term));
}

function containsDiaperTask(value: string) {
  const normalized = value.toLocaleLowerCase("ru-RU");
  return normalized.includes("подгузник") || normalized.includes("памперс");
}

const pricingPackageOptions = [
  { value: "short_help", label: "Короткая помощь", price: "400–700 ₽" },
  { value: "home_help_2h", label: "Бытовая помощь 2 часа", price: "700–1 100 ₽" },
  { value: "supervision_2h", label: "Присмотр 2 часа", price: "700–1 200 ₽" },
  { value: "accompaniment_standard", label: "Сопровождение стандарт", price: "800–1 500 ₽" },
  { value: "help_3_4h", label: "Помощь 3–4 часа", price: "1 200–2 000 ₽" },
  { value: "regular_help", label: "Регулярная помощь", price: "по согласованию, обычно от 700 ₽" }
];

const pricingAddonOptions = [
  { value: "extra_hour", label: "Дополнительный час", description: "250–400 ₽/час" },
  { value: "waiting", label: "Ожидание сверх согласованного", description: "200–300 ₽/час" },
  { value: "second_address", label: "Второй адрес", description: "150–300 ₽" },
  { value: "shopping", label: "Покупки как отдельное поручение", description: "200–400 ₽" },
  { value: "simple_meal_extra", label: "Помощь с простой едой сверх пакета", description: "150–300 ₽" },
  { value: "urgent", label: "Срочная заявка", description: "200–500 ₽" },
  { value: "transport_expenses", label: "Транспорт / такси / парковка", description: "по факту расходов" }
];

const hygieneLevelOptions = [
  { value: "none", label: "Нет гигиенической помощи" },
  { value: "hygieneLight", label: "Лёгкая гигиена" },
  { value: "hygieneHousehold", label: "Бытовая гигиеническая помощь" },
  { value: "hygieneIntimate", label: "Интимная гигиена / подмывание" }
];

const physicalLevelOptions = [
  { value: "none", label: "Нет физической помощи" },
  { value: "physicalLight", label: "Лёгкая физическая поддержка" },
  { value: "physicalMedium", label: "Средняя физическая помощь" },
  { value: "physicalHeavy", label: "Тяжёлая физическая помощь" }
];

const taskVolumeOptions = [
  { value: "minimal", label: "Минимальный объём" },
  { value: "basic", label: "Базовый объём" },
  { value: "extended", label: "Расширенный объём" },
  { value: "manual", label: "Объём нужно уточнить в чате" }
];

const dependentStateOptions = [
  { value: "independent", label: "Самостоятельный" },
  { value: "light_support", label: "Нужна лёгкая поддержка" },
  { value: "regular_help", label: "Нужна регулярная помощь" },
  { value: "limited_mobility", label: "Маломобильный" },
  { value: "bedridden", label: "Лежачий" },
  { value: "fall_risk", label: "Есть риск падения" },
  { value: "hygiene_help", label: "Нужна гигиеническая помощь" },
  { value: "toilet_help", label: "Нужна помощь с туалетом" },
  { value: "diaper_help", label: "Нужна помощь с подгузником" },
  { value: "child", label: "Ребёнок" }
];

function CategoryGuidance({ categories, categoryId }: { categories: CategoriesForCity | null; categoryId: string }) {
  const category = categories?.categories.find((item) => item.id === categoryId);
  if (!category) return null;
  const pricing = category.pricingRules?.[0];
  const range = pricing?.recommendedMinPrice != null
    ? pricing.recommendedMaxPrice != null
      ? `${pricing.recommendedMinPrice.toLocaleString("ru-RU")}–${pricing.recommendedMaxPrice.toLocaleString("ru-RU")} ₽`
      : `от ${pricing.recommendedMinPrice.toLocaleString("ru-RU")} ₽`
    : "по согласованию";
  return (
    <div className="notice span-2 category-guidance">
      <strong>{category.title}</strong>
      {category.descriptionForCustomer && <p>{category.descriptionForCustomer}</p>}
      <p>Ориентир по похожим задачам: {range}. Итоговая сумма согласуется в чате.</p>
      {category.safetyRules?.map((rule) => <p key={rule.id}>{rule.isBlocking ? "Не принимается: " : "Важно: "}{rule.description}</p>)}
      {category.slug === "other" && <p>Опишите задачу. Сервис не принимает задачи с медицинскими процедурами, опасными работами, ремонтом, передачей паролей, оформлением кредитов и покупкой запрещённых товаров.</p>}
    </div>
  );
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function buildPricingPayload(form: {
  categoryId: string;
  packageId: string;
  selectedAddonIds: string[];
  expectedDurationHours: number | string;
  scheduleType: string;
  date?: string;
  timeFrom?: string;
  helpFor: string;
  additionalActions: string[];
  dependentState: string[];
  hygieneLevel?: string;
  physicalLoadLevel?: string;
  physicalHelpLevel?: string;
  taskVolumeLevel?: string;
  urgencyFlags?: string[];
  transportOption?: string;
  hasPets: boolean;
}) {
  const additionalActions = buildSavedActions(form);
  return {
    categoryId: form.categoryId,
    packageId: form.packageId,
    selectedAddonIds: form.selectedAddonIds,
    expectedDurationHours: Number(form.expectedDurationHours) || 1,
    durationHours: Number(form.expectedDurationHours) || 1,
    scheduleType: form.scheduleType,
    date: form.date || undefined,
    timeFrom: form.timeFrom || undefined,
    time: form.timeFrom || undefined,
    helpFor: form.helpFor || undefined,
    selectedActions: additionalActions,
    additionalActions,
    dependentState: form.dependentState,
    hygieneLevel: form.hygieneLevel,
    physicalLoadLevel: form.physicalLoadLevel || form.physicalHelpLevel,
    physicalHelpLevel: form.physicalLoadLevel || form.physicalHelpLevel,
    taskVolumeLevel: form.taskVolumeLevel,
    urgencyFlags: form.urgencyFlags ?? [],
    isRemoteAddress: form.transportOption === "separate",
    transportOption: form.transportOption,
    urgency: form.scheduleType === "urgent" ? "urgent" : form.scheduleType === "regular" ? "regular" : "normal",
    hasLimitedMobility: derivedHasLimitedMobility(form),
    needsCooking: additionalActions.some((action) => ["simple_cooking", "full_cooking"].includes(action)),
    needsCleaning: additionalActions.some((action) => ["light_cleaning", "laundry", "ironing", "bed_linen"].includes(action)),
    needsWalk: additionalActions.includes("walk") || additionalActions.includes("escort"),
    needsHygieneHelp: derivedNeedsHygiene(form),
    hasPets: form.hasPets
  };
}

function buildSavedActions(form: { additionalActions: string[]; packageId?: string; selectedAddonIds?: string[]; hygieneLevel?: string; physicalLoadLevel?: string; taskVolumeLevel?: string; transportOption?: string; urgencyFlags?: string[] }) {
  return Array.from(new Set([
    ...form.additionalActions,
    form.packageId ? `pricingPackage:${form.packageId}` : "",
    ...(form.selectedAddonIds ?? []).map((id) => `pricingAddon:${id}`),
    form.hygieneLevel && form.hygieneLevel !== "none" ? form.hygieneLevel : "",
    form.physicalLoadLevel && form.physicalLoadLevel !== "none" ? form.physicalLoadLevel : "",
    form.taskVolumeLevel && form.taskVolumeLevel !== "basic" ? `taskVolume:${form.taskVolumeLevel}` : "",
    form.transportOption === "separate" ? "transportSeparate" : "",
    ...(form.urgencyFlags ?? [])
  ].filter(Boolean)));
}

function extractStoredPricingOptions(actions: string[], physicalHelpLevel?: string | null) {
  const taskVolume = actions.find((action) => action.startsWith("taskVolume:"))?.split(":")[1];
  const storedPackage = actions.find((action) => action.startsWith("pricingPackage:"))?.split(":")[1];
  return {
    packageId: pricingPackageOptions.some((option) => option.value === storedPackage) ? storedPackage! : "",
    selectedAddonIds: actions
      .filter((action) => action.startsWith("pricingAddon:"))
      .map((action) => action.split(":")[1])
      .filter((id) => pricingAddonOptions.some((option) => option.value === id)),
    hygieneLevel: actions.includes("hygieneIntimate") || actions.includes("washing") ? "hygieneIntimate"
      : actions.includes("hygieneHousehold") || actions.includes("hygiene") ? "hygieneHousehold"
        : actions.includes("hygieneLight") || actions.includes("wash_help") ? "hygieneLight"
          : "none",
    physicalLoadLevel: actions.includes("physicalHeavy") || physicalHelpLevel === "physicalHeavy" ? "physicalHeavy"
      : actions.includes("physicalMedium") || physicalHelpLevel === "physicalMedium" ? "physicalMedium"
        : actions.includes("physicalLight") || physicalHelpLevel === "physicalLight" ? "physicalLight"
          : "none",
    taskVolumeLevel: taskVolume && taskVolumeOptions.some((option) => option.value === taskVolume) ? taskVolume : "basic",
    transportOption: actions.includes("transportSeparate") ? "separate" : "city",
    urgencyFlags: []
  };
}

function derivedHasLimitedMobility(form: { helpFor: string; dependentState: string[]; additionalActions: string[]; physicalLoadLevel?: string; physicalHelpLevel?: string }) {
  return (
    form.helpFor === "limited_mobility" ||
    form.dependentState.some((state) => ["limited_mobility", "bedridden", "fall_risk"].includes(state)) ||
    form.additionalActions.includes("movement_help") ||
    ["physicalLight", "physicalMedium", "physicalHeavy"].includes(form.physicalLoadLevel || form.physicalHelpLevel || "")
  );
}

function derivedNeedsHygiene(form: { dependentState: string[]; additionalActions: string[]; hygieneLevel?: string }) {
  return (
    Boolean(form.hygieneLevel && form.hygieneLevel !== "none") ||
    form.dependentState.some((state) => ["hygiene_help", "toilet_help", "diaper_help"].includes(state)) ||
    form.additionalActions.some((action) => ["wash_help", "toilet_help", "diaper_change", "washing", "hygiene"].includes(action))
  );
}

function parseJsonArray(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function formatQuoteRange(min?: number, max?: number | null) {
  if (min === undefined) return "по согласованию";
  const format = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
  return max === null || max === undefined ? `от ${format(min)} ₽` : `${format(min)}–${format(max)} ₽`;
}

function formatStructuredRange(min: number | null, max: number | null) {
  if (min === null) return "по согласованию";
  const format = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
  return max === null ? `от ${format(min)} ₽` : `${format(min)}–${format(max)} ₽`;
}

function extractCommentLine(comment: string | null | undefined, prefix: string) {
  return (comment ?? "")
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim() ?? "";
}

function stripGeneratedCommentLines(comment: string | null | undefined) {
  return (comment ?? "")
    .split("\n")
    .filter((line) => !line.startsWith("Комментарий к адресу:") && !line.startsWith("Комментарий по оплате:"))
    .join("\n")
    .trim();
}

function splitLegacyAddress(request: ClientRequest) {
  const cityName = request.city?.name ?? request.addressCity ?? "";
  const raw = request.addressText ?? request.fullAddress ?? "";
  const withoutCity = cityName && raw.startsWith(cityName) ? raw.slice(cityName.length).replace(/^,\s*/, "") : raw;
  const parts = withoutCity.split(",").map((item) => item.trim()).filter(Boolean);
  return {
    street: request.addressStreet ?? parts[0] ?? "",
    house: request.addressHouse ?? parts[1]?.replace(/^дом\s+/i, "") ?? ""
  };
}

function clientTabFromPath(pathname: string) {
  if (pathname.startsWith("/app/client/requests/completed")) return "Выполненные заявки";
  if (pathname.startsWith("/app/client/requests/new")) return "Создать заявку";
  if (pathname.startsWith("/app/client/balance")) return "Мой баланс";
  if (pathname.startsWith("/app/client/chats")) return "Чаты";
  if (pathname.startsWith("/app/client/messages")) return "Сообщения от сервиса";
  if (pathname.startsWith("/app/client/profile")) return "Мой профиль";
  if (pathname.startsWith("/app/client/support")) return "Мои обращения";
  if (pathname.startsWith("/app/client/help")) return "Помощь / FAQ";
  if (pathname.startsWith("/app/client/consents")) return "Согласия";
  return "Мои заявки";
}

function chatIdFromPath(pathname: string, prefix: string) {
  const match = pathname.match(new RegExp(`^${prefix}/([^/]+)$`));
  return match?.[1] ?? null;
}
