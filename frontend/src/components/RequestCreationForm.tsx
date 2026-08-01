import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import type { CategoriesForCity, City, DynamicRequestField, StructuredRequestPriceQuote, User } from "../types";
import { CityCombobox } from "./CityCombobox";

type CatalogTask = NonNullable<CategoriesForCity["directions"]>[number]["tasks"][number];
type SelectedTask = CatalogTask & { categoryTitle: string };
type Slot = { id: string; startTime: string; durationMinutes: number };
type FormError = { path: string; message: string };

const frequencies = [
  ["urgent_today", "Срочно / сегодня"], ["once", "Разово"], ["daily", "Ежедневно"], ["weekly", "Еженедельно"],
  ["several_weekly", "Несколько раз в неделю"], ["regular_schedule", "Регулярно по графику"]
] as const;
const weekdays = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [0, "Вс"]] as const;
const durations = [[30, "30 минут"], [60, "1 час"], [90, "1 час 30 минут"], [120, "2 часа"], [180, "3 часа"], [240, "4 часа"]] as const;

export function RequestCreationForm({ cities, user, onCreated }: { cities: City[]; user: User; onCreated: () => Promise<void> }) {
  const [cityId, setCityId] = useState(user.cityId ?? "");
  const [contact, setContact] = useState({ name: user.displayName ?? "", phone: user.phone ?? "" });
  const [editingContact, setEditingContact] = useState(false);
  const [recipientType, setRecipientType] = useState("");
  const [dependentName, setDependentName] = useState("");
  const [dependentAge, setDependentAge] = useState("");
  const [mainState, setMainState] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CategoriesForCity | null>(null);
  const [openDirections, setOpenDirections] = useState<string[]>([]);
  const [selectedTasks, setSelectedTasks] = useState<SelectedTask[]>([]);
  const [taskFieldValues, setTaskFieldValues] = useState<Record<string, Record<string, unknown>>>({});
  const [taskSearch, setTaskSearch] = useState("");
  const [frequency, setFrequency] = useState("once");
  const today = localDate(0);
  const [startDate, setStartDate] = useState(() => localDate(1));
  const [periodMode, setPeriodMode] = useState("endDate");
  const [endDate, setEndDate] = useState("");
  const [weeksCount, setWeeksCount] = useState("");
  const [visitCount, setVisitCount] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([new Date().getDay()]);
  const [globalSlots, setGlobalSlots] = useState<Slot[]>([newSlot("10:00", 120)]);
  const [slotsByDay, setSlotsByDay] = useState<Record<number, Slot[]>>({});
  const [waitingRequired, setWaitingRequired] = useState(false);
  const [waitingMinutes, setWaitingMinutes] = useState(30);
  const [address, setAddress] = useState({ street: "", house: "", apartment: "", entrance: "", floor: "", intercom: "", district: "", comment: "" });
  const [comment, setComment] = useState("");
  const [quote, setQuote] = useState<StructuredRequestPriceQuote | null>(null);
  const [errors, setErrors] = useState<FormError[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const quoteRequestId = useRef(0);

  useEffect(() => {
    if (!cityId) return setCatalog(null);
    api.categoriesForRequest(cityId).then((result) => {
      setCatalog(result);
      setSelectedTasks([]);
      setTaskFieldValues({});
      setOpenDirections(result.directions?.map((direction) => direction.id) ?? []);
    }).catch(() => setCatalog(null));
  }, [cityId]);

  const visibleDirections = useMemo(() => {
    const query = normalize(taskSearch);
    return (catalog?.directions ?? []).map((direction) => ({
      ...direction,
      tasks: direction.tasks.filter((task) => !query || normalize(task.title).includes(query) || task.aliases.some((alias) => normalize(alias).includes(query)))
    })).filter((direction) => direction.tasks.length > 0);
  }, [catalog, taskSearch]);
  const medicalWarning = containsMedicalQuery(taskSearch);
  const hasAccompaniment = selectedTasks.some((task) => task.categorySlug === "accompaniment");
  const usesLegacyAccompanimentFields = hasAccompaniment && !selectedTasks.some((task) => task.categorySlug === "accompaniment" && (task.formFields?.length ?? 0) > 0);
  const recommendedTasks = useMemo(() => {
    const allTasks = (catalog?.directions ?? []).flatMap((direction) => direction.tasks.map((task) => ({ ...task, categoryTitle: direction.title })));
    const selectedSlugs = new Set(selectedTasks.map((task) => task.slug));
    const recommendationSlugs = new Set(selectedTasks.flatMap((task) => task.recommendations?.map((item) => item.taskSlug) ?? []));
    return allTasks.filter((task) => recommendationSlugs.has(task.slug) && !selectedSlugs.has(task.slug));
  }, [catalog, selectedTasks]);
  const safetyRules = useMemo(() => {
    const seen = new Set<string>();
    return (catalog?.directions ?? []).flatMap((direction) => direction.safetyRules ?? []).filter((rule) => {
      const key = `${rule.title}:${rule.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [catalog]);
  const repeating = !["urgent_today", "once"].includes(frequency);
  const usesDaySchedule = ["weekly", "several_weekly", "regular_schedule"].includes(frequency);
  const schedule = useMemo(() => buildSchedule(), [frequency, startDate, endDate, weeksCount, visitCount, periodMode, selectedDays, globalSlots, slotsByDay]);

  useEffect(() => {
    const requestId = ++quoteRequestId.current;
    if (!cityId || !recipientType || !mainState || selectedTasks.length === 0) return setQuote(null);
    const handle = window.setTimeout(() => {
      api.calculateRequestPrice({
        cityId,
        recipientType,
        dependentState: { mainState, features },
        selectedTasks: selectedTasks.map(taskPayload),
        taskFieldValues,
        frequency,
        schedule,
        accompanimentWaitingMinutes: usesLegacyAccompanimentFields && waitingRequired ? waitingMinutes : 0,
        queryText: `${taskSearch} ${comment}`
      }).then((result) => {
        if (quoteRequestId.current === requestId) setQuote(result);
      }).catch(() => {
        if (quoteRequestId.current === requestId) setQuote(null);
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [cityId, recipientType, mainState, features, selectedTasks, taskFieldValues, frequency, schedule, usesLegacyAccompanimentFields, waitingRequired, waitingMinutes, taskSearch, comment]);

  function buildSchedule() {
    const finite = repeating ? {
      endDate: periodMode === "endDate" ? endDate || null : null,
      weeksCount: periodMode === "weeks" && weeksCount ? Number(weeksCount) : null,
      visitCount: periodMode === "visits" && visitCount ? Number(visitCount) : null
    } : {};
    if (usesDaySchedule) {
      return {
        frequency,
        startDate: frequency === "urgent_today" ? today : startDate,
        ...finite,
        daysOfWeek: selectedDays,
        daySchedules: selectedDays.map((dayOfWeek) => ({ dayOfWeek, slots: slotsByDay[dayOfWeek] ?? globalSlots }))
      };
    }
    return { frequency, startDate: frequency === "urgent_today" ? today : startDate, ...finite, slots: globalSlots };
  }

  function toggleTask(task: CatalogTask, direction: { title: string; slug: string }) {
    const current = selectedTasks.some((item) => item.id === task.id);
    if (current) {
      setSelectedTasks(selectedTasks.filter((item) => item.id !== task.id));
      setTaskFieldValues((values) => Object.fromEntries(Object.entries(values).filter(([key]) => key !== taskIdentity(task))));
    } else {
      setSelectedTasks([...selectedTasks, { ...task, categoryTitle: direction.title, categorySlug: direction.slug }]);
    }
  }

  function toggleDay(day: number) {
    if (frequency === "weekly") return setSelectedDays([day]);
    setSelectedDays(selectedDays.includes(day) ? selectedDays.filter((item) => item !== day) : [...selectedDays, day]);
  }

  function updateSlot(day: number | null, id: string, patch: Partial<Slot>) {
    if (day === null) return setGlobalSlots(globalSlots.map((slot) => slot.id === id ? { ...slot, ...patch } : slot));
    const rows = slotsByDay[day] ?? globalSlots;
    setSlotsByDay({ ...slotsByDay, [day]: rows.map((slot) => slot.id === id ? { ...slot, ...patch } : slot) });
  }

  function addSlot(day: number | null) {
    if (day === null) return setGlobalSlots([...globalSlots, newSlot("14:00", 120)]);
    setSlotsByDay({ ...slotsByDay, [day]: [...(slotsByDay[day] ?? globalSlots), newSlot("14:00", 120)] });
  }

  function removeSlot(day: number | null, id: string) {
    if (day === null) return setGlobalSlots(globalSlots.filter((slot) => slot.id !== id));
    setSlotsByDay({ ...slotsByDay, [day]: (slotsByDay[day] ?? globalSlots).filter((slot) => slot.id !== id) });
  }

  function validate() {
    const next: FormError[] = [];
    if (!cityId) next.push({ path: "cityId", message: "Выберите город Подопечного." });
    if (!contact.name.trim()) next.push({ path: "contactName", message: "Укажите имя контактного лица." });
    if (!contact.phone.trim()) next.push({ path: "contactPhone", message: "Укажите телефон контактного лица." });
    if (!recipientType) next.push({ path: "recipientType", message: "Выберите, кому нужна помощь." });
    if (recipientType && recipientType !== "self" && !dependentName.trim()) next.push({ path: "dependentName", message: "Укажите имя Подопечного." });
    if (recipientType === "child" && !dependentAge) next.push({ path: "dependentAge", message: "Укажите возраст Подопечного." });
    if (!mainState) next.push({ path: "dependentMainState", message: "Выберите основное состояние Подопечного." });
    if (selectedTasks.length === 0) next.push({ path: "selectedTasks", message: "Выберите хотя бы одну задачу." });
    for (const task of selectedTasks) {
      for (const field of task.formFields ?? []) {
        const value = taskFieldValues[taskIdentity(task)]?.[field.id];
        const values = taskFieldValues[taskIdentity(task)] ?? {};
        if (isDynamicFieldRequired(field, values) && (value === undefined || value === null || value === "" || value === false)) next.push({ path: `taskFieldValues.${taskIdentity(task)}.${field.id}`, message: `Заполните поле «${field.label}».` });
      }
      if (task.requiresComment && !comment.trim()) next.push({ path: "comment", message: `Добавьте комментарий для задачи «${task.title}».` });
    }
    if (!startDate) next.push({ path: "schedule.startDate", message: "Укажите дату." });
    if (repeating && periodMode === "endDate" && !endDate) next.push({ path: "schedule.endDate", message: "Укажите дату окончания." });
    if (repeating && periodMode === "weeks" && !weeksCount) next.push({ path: "schedule.weeksCount", message: "Укажите количество недель." });
    if (repeating && periodMode === "visits" && !visitCount) next.push({ path: "schedule.visitCount", message: "Укажите количество визитов." });
    if (usesDaySchedule && selectedDays.length === 0) next.push({ path: "schedule.days", message: "Выберите хотя бы один день недели." });
    const scheduledSlots = usesDaySchedule
      ? selectedDays.flatMap((day) => slotsByDay[day] ?? globalSlots)
      : globalSlots;
    for (const slot of scheduledSlots) {
      if (!slot.startTime) next.push({ path: `schedule.visitSlots.${slot.id}.startTime`, message: "Укажите время начала визита." });
    }
    const slotsBySchedule = usesDaySchedule ? selectedDays.map((day) => slotsByDay[day] ?? globalSlots) : [globalSlots];
    for (const slots of slotsBySchedule) {
      const sorted = [...slots].sort((left, right) => left.startTime.localeCompare(right.startTime));
      for (let index = 1; index < sorted.length; index += 1) {
        if (timeMinutes(sorted[index - 1].startTime) + sorted[index - 1].durationMinutes > timeMinutes(sorted[index].startTime)) {
          next.push({ path: `schedule.visitSlots.${sorted[index].id}.startTime`, message: "Визиты не должны пересекаться." });
          break;
        }
      }
    }
    if (!address.street.trim()) next.push({ path: "address.street", message: "Укажите улицу." });
    if (!address.house.trim()) next.push({ path: "address.house", message: "Укажите дом." });
    if (usesLegacyAccompanimentFields && !comment.trim()) next.push({ path: "comment", message: "Укажите место назначения и действия в процессе сопровождения." });
    return next;
  }

  function focusError(error: FormError) {
    window.setTimeout(() => {
      const field = formRef.current?.querySelector<HTMLElement>(`[data-field-path="${CSS.escape(error.path)}"]`);
      field?.scrollIntoView({ behavior: "smooth", block: "center" });
      field?.focus({ preventScroll: true });
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const nextErrors = validate();
    setErrors(nextErrors);
    if (nextErrors.length) {
      if (["contactName", "contactPhone"].includes(nextErrors[0].path)) setEditingContact(true);
      return focusError(nextErrors[0]);
    }
    try {
      setSubmitting(true);
      const created = await api.createRequest({
        cityId,
        contactName: contact.name,
        contactPhone: contact.phone,
        recipientType,
        dependentName: recipientType === "self" ? undefined : dependentName,
        dependentAge: dependentAge ? Number(dependentAge) : undefined,
        dependentMainState: mainState,
        dependentStateFeatures: features,
        selectedTasks: selectedTasks.map(taskPayload),
        taskFieldValues,
        scheduleV2: schedule,
        accompanimentWaitingMinutes: usesLegacyAccompanimentFields && waitingRequired ? waitingMinutes : 0,
        addressStreet: address.street,
        addressHouse: address.house,
        addressApartment: address.apartment || undefined,
        addressEntrance: address.entrance || undefined,
        addressFloor: address.floor || undefined,
        addressIntercom: address.intercom || undefined,
        addressComment: address.comment || undefined,
        district: address.district || undefined,
        comment: comment || undefined
      });
      await api.publishRequest(created.id);
      setMessage("Заявка создана.");
      await onCreated();
    } catch (error: any) {
      const validationErrors = error?.details?.validationErrors as FormError[] | undefined;
      if (validationErrors?.length) {
        setErrors(validationErrors);
        focusError(validationErrors[0]);
      }
      setMessage(error instanceof Error ? error.message : "Не удалось создать заявку.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (path: string) => errors.find((error) => error.path === path)?.message;
  return (
    <form className="request-builder" onSubmit={submit} ref={formRef} noValidate>
      {message && <p className="notice">{message}</p>}
      <FormSection number="1" title="Город и контактное лицо">
        <div data-field-path="cityId" tabIndex={-1} className={fieldError("cityId") ? "field-error" : ""}>
          <CityCombobox cities={cities} value={cityId} onChange={setCityId} label="Город Подопечного" />
          <FieldError text={fieldError("cityId")} />
        </div>
        <div className="contact-summary">
          <div><strong>{contact.name || "Имя не указано"}</strong><span>{contact.phone || "Телефон не указан"}</span></div>
          <button className="secondary-button" type="button" onClick={() => setEditingContact(!editingContact)}>Изменить</button>
        </div>
        {editingContact && <div className="request-builder__grid"><label>Имя<input data-field-path="contactName" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /></label><label>Телефон<input data-field-path="contactPhone" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} /></label></div>}
        <FieldError text={fieldError("contactName") ?? fieldError("contactPhone")} />
      </FormSection>

      <FormSection number="2" title="Кому нужна помощь?">
        <div className="choice-grid" data-field-path="recipientType" tabIndex={-1}>
          {[["self", "Мне"], ["adult", "Взрослому человеку"], ["elderly", "Пожилому человеку"], ["child", "Ребёнку"]].map(([value, label]) => <Choice key={value} selected={recipientType === value} onClick={() => setRecipientType(value)}>{label}</Choice>)}
        </div>
        <FieldError text={fieldError("recipientType")} />
        {recipientType && recipientType !== "self" && <div className="request-builder__grid"><label>Имя Подопечного<input data-field-path="dependentName" value={dependentName} onChange={(event) => setDependentName(event.target.value)} className={fieldError("dependentName") ? "field-error" : ""} /></label><label>Возраст Подопечного<input type="number" min="0" max="120" data-field-path="dependentAge" value={dependentAge} onChange={(event) => setDependentAge(event.target.value)} /></label></div>}
      </FormSection>

      <FormSection number="3" title={recipientType === "self" ? "Ваше состояние" : "Состояние Подопечного"}>
        <div className="choice-grid" data-field-path="dependentMainState" tabIndex={-1}>
          {[["independent", "Самостоятельно передвигается"], ["light_support", "Нужна лёгкая поддержка"], ["limited_mobility", "Маломобильный"], ["bedridden", "Лежачий"]].map(([value, label]) => <Choice key={value} selected={mainState === value} onClick={() => setMainState(value)}>{label}</Choice>)}
        </div>
        <FieldError text={fieldError("dependentMainState")} />
        <fieldset className="compact-checks"><legend>Особенности</legend>{[["fall_risk", "Есть риск падения"], ["movement_help", "Нужна помощь при передвижении"], ["hygiene_help", "Нужна помощь с гигиеной"], ["toilet_help", "Нужна помощь с туалетом"], ["diaper_help", "Нужна помощь со сменой подгузника"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={features.includes(value)} onChange={() => setFeatures(toggle(features, value))} />{label}</label>)}</fieldset>
      </FormSection>

      <FormSection number="4" title="Что нужно сделать?">
        <label className="task-search">Найти задачу<input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} /></label>
        {medicalWarning && <p className="notice">Сервис не принимает задачи с медицинскими процедурами. При угрозе жизни или здоровью обращайтесь в экстренные службы.</p>}
        <div className="task-directions" data-field-path="selectedTasks" tabIndex={-1}>
          {visibleDirections.map((direction) => <section className="task-direction" key={direction.id}><button type="button" className="task-direction__head" onClick={() => setOpenDirections(toggle(openDirections, direction.id))}><span><strong>{direction.title}</strong>{direction.subtitle && <small>{direction.subtitle}</small>}</span><span>{openDirections.includes(direction.id) ? "−" : "+"}</span></button>{openDirections.includes(direction.id) && <div className="task-options">{direction.tasks.map((task) => <label key={task.id}><input type="checkbox" checked={selectedTasks.some((item) => item.id === task.id)} onChange={() => toggleTask(task, direction)} /><span><strong>{task.title}</strong>{task.description && <small>{task.description}</small>}{task.customerHint && <small>{task.customerHint}</small>}</span></label>)}</div>}</section>)}
        </div>
        <FieldError text={fieldError("selectedTasks")} />
        {selectedTasks.length > 0 && <div className="selected-tasks"><strong>Вы выбрали</strong>{selectedTasks.map((task) => <span key={task.id}>{task.title}<button type="button" aria-label={`Убрать ${task.title}`} onClick={() => toggleTask(task, { title: task.categoryTitle, slug: task.categorySlug })}><X size={15} /></button></span>)}<p>Выбранные задачи будут выполняться во время каждого визита.</p></div>}
        {recommendedTasks.length > 0 && <div className="task-recommendations"><strong>Также часто требуется</strong>{recommendedTasks.map((task) => <button type="button" className="secondary-button" key={task.id} onClick={() => toggleTask(task, { title: task.categoryTitle, slug: task.categorySlug })}><Plus size={16} />{task.title}</button>)}<small>Добавьте только если это действительно нужно.</small></div>}
        {selectedTasks.some((task) => (task.formFields?.length ?? 0) > 0) && <div className="dynamic-task-fields">{selectedTasks.filter((task) => (task.formFields?.length ?? 0) > 0).map((task) => { const values = taskFieldValues[taskIdentity(task)] ?? {}; return <section key={task.id}><h4>{task.title}</h4>{task.formFields!.filter((field) => isDynamicFieldVisible(field, values)).map((field) => <DynamicField key={field.id} task={task} field={field} required={isDynamicFieldRequired(field, values)} value={values[field.id]} onChange={(value) => setTaskFieldValues((current) => ({ ...current, [taskIdentity(task)]: { ...(current[taskIdentity(task)] ?? {}), [field.id]: value } }))} error={fieldError(`taskFieldValues.${taskIdentity(task)}.${field.id}`)} />)}</section>; })}</div>}
        {usesLegacyAccompanimentFields && <div className="notice"><p>Укажите место назначения в комментарии.</p><label className="checkbox-row"><input type="checkbox" checked={waitingRequired} onChange={(event) => setWaitingRequired(event.target.checked)} />Нужно ожидание</label>{waitingRequired && <label>Продолжительность ожидания, минут<input type="number" step="30" min="30" value={waitingMinutes} onChange={(event) => setWaitingMinutes(Number(event.target.value))} /></label>}</div>}
      </FormSection>

      <FormSection number="5" title="Как часто и когда нужна помощь">
        <div className="frequency-tabs">{frequencies.map(([value, label]) => <Choice key={value} selected={frequency === value} onClick={() => setFrequency(value)}>{label}</Choice>)}</div>
        <label>Дата начала<input data-field-path="schedule.startDate" type="date" min={today} value={frequency === "urgent_today" ? today : startDate} disabled={frequency === "urgent_today"} onChange={(event) => setStartDate(event.target.value)} /></label>
        {usesDaySchedule && <div className="weekday-picker" data-field-path="schedule.days" tabIndex={-1}>{weekdays.map(([value, label]) => <Choice key={value} selected={selectedDays.includes(value)} onClick={() => toggleDay(value)}>{label}</Choice>)}</div>}
        {repeating && <div className="finite-period"><strong>Конечный период</strong><select value={periodMode} onChange={(event) => setPeriodMode(event.target.value)}><option value="endDate">Дата окончания</option><option value="weeks">Количество недель</option><option value="visits">Точное количество визитов</option></select>{periodMode === "endDate" && <input data-field-path="schedule.endDate" type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} />}{periodMode === "weeks" && <input data-field-path="schedule.weeksCount" type="number" min="1" value={weeksCount} onChange={(event) => setWeeksCount(event.target.value)} />}{periodMode === "visits" && <input data-field-path="schedule.visitCount" type="number" min="1" value={visitCount} onChange={(event) => setVisitCount(event.target.value)} />}</div>}
        {!usesDaySchedule ? <VisitSlots slots={globalSlots} errors={errors} onChange={(id, patch) => updateSlot(null, id, patch)} onAdd={() => addSlot(null)} onRemove={(id) => removeSlot(null, id)} /> : selectedDays.map((day) => <div className="day-schedule" key={day}><h4>{weekdays.find(([value]) => value === day)?.[1]}</h4><VisitSlots slots={slotsByDay[day] ?? globalSlots} errors={errors} onChange={(id, patch) => updateSlot(day, id, patch)} onAdd={() => addSlot(day)} onRemove={(id) => removeSlot(day, id)} /></div>)}
        {usesDaySchedule && selectedDays.length > 1 && <button className="secondary-button" type="button" onClick={() => { const first = slotsByDay[selectedDays[0]] ?? globalSlots; setSlotsByDay(Object.fromEntries(selectedDays.map((day) => [day, first.map((slot) => ({ ...slot, id: crypto.randomUUID() }))]))); }}>Скопировать время на выбранные дни</button>}
        {quote && <p className="visit-total"><strong>{quote.visitCount ?? 0} визитов · {formatDuration(quote.totalDurationMinutes ?? 0)}</strong></p>}
      </FormSection>

      <FormSection number="6" title="Где нужна помощь">
        <div className="request-builder__grid"><label>Улица<input data-field-path="address.street" value={address.street} onChange={(event) => setAddress({ ...address, street: event.target.value })} /></label><label>Дом<input data-field-path="address.house" value={address.house} onChange={(event) => setAddress({ ...address, house: event.target.value })} /></label><label>Квартира<input value={address.apartment} onChange={(event) => setAddress({ ...address, apartment: event.target.value })} /></label><label>Подъезд<input value={address.entrance} onChange={(event) => setAddress({ ...address, entrance: event.target.value })} /></label><label>Этаж<input value={address.floor} onChange={(event) => setAddress({ ...address, floor: event.target.value })} /></label><label>Домофон<input value={address.intercom} onChange={(event) => setAddress({ ...address, intercom: event.target.value })} /></label><label>Район или ориентир<input value={address.district} onChange={(event) => setAddress({ ...address, district: event.target.value })} /></label><label>Комментарий к адресу<input value={address.comment} onChange={(event) => setAddress({ ...address, comment: event.target.value })} /></label></div>
        <p className="privacy-note">Точный адрес скрыт до согласования условий и перехода заявки в работу.</p>
      </FormSection>

      <FormSection number="7" title="Рекомендуемая стоимость">
        {selectedTasks.length === 0 ? <p>Выберите хотя бы одну задачу, чтобы увидеть ориентировочную сумму.</p> : !quote ? <p>Укажите длительность визита, чтобы рассчитать точную ориентировочную сумму.</p> : <div className="request-quote"><p className="request-quote__amount">{quote.totalHelpAmount == null ? "Часть задач требует согласования" : <>Ориентировочная сумма помощи: <strong>{formatMoney(quote.totalHelpAmount)}</strong></>}</p><p>{quote.visitCount ?? 0} визитов · {formatDuration(quote.totalDurationMinutes ?? 0)}</p><div className="request-quote__visits">{quote.expandedVisits?.map((visit) => <article key={visit.id}><strong>Визит {visit.sequence}</strong><span>{new Date(`${visit.date}T00:00:00`).toLocaleDateString("ru-RU")} · {visit.startTime}–{visit.endTime}</span><span>{formatDuration(visit.durationMinutes)} · {visit.calculatedHelpPrice == null ? `Рассчитанная часть ${formatMoney(visit.calculatedSubtotal ?? 0)}` : formatMoney(visit.calculatedHelpPrice)}</span></article>)}</div><p>Сервисный сбор Заказчика: {formatMoney(quote.customerServiceFeeTotal ?? 0)}</p><p>Сервисный сбор Помощника: {formatMoney(quote.helperServiceFeeTotal ?? 0)}</p><p>{quote.sourceMessage}</p>{(quote.unpricedTasks?.length ?? 0) > 0 && <p>Без ориентира: {quote.unpricedTasks?.map((task) => task.taskTemplateTitle).join(", ")}. Рассчитанная часть не является точным итогом; условия уточняются в чате.</p>}<p>Оплата помощи производится Помощнику напрямую. Сервисный сбор списывается с внутреннего баланса сервиса.</p></div>}
      </FormSection>

      <FormSection number="8" title="Комментарий">
        <label>Комментарий к заявке<textarea data-field-path="comment" value={comment} onChange={(event) => setComment(event.target.value)} /></label><FieldError text={fieldError("comment")} />
      </FormSection>
      <details className="request-safety"><summary>Ограничения и безопасность · Подробнее</summary><p>Сервис принимает бытовые и организационные задачи. Медицинские процедуры не принимаются.</p>{safetyRules.length > 0 && <ul>{safetyRules.map((rule) => <li key={`${rule.title}:${rule.description}`}><strong>{rule.title}.</strong> {rule.description}</li>)}</ul>}</details>
      <section className="request-builder__submit"><h2>Проверка и создание</h2><button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Создаём..." : "Создать заявку"}</button></section>
    </form>
  );
}

function FormSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) { return <section className="request-builder__section"><h2><span>{number}</span>{title}</h2>{children}</section>; }
function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" className={`choice-button${selected ? " is-selected" : ""}`} onClick={onClick}>{children}</button>; }
function FieldError({ text }: { text?: string }) { return text ? <span className="field-error-text">{text}</span> : null; }
function DynamicField({ task, field, required, value, onChange, error }: { task: SelectedTask; field: DynamicRequestField; required: boolean; value: unknown; onChange: (value: unknown) => void; error?: string }) {
  const path = `taskFieldValues.${taskIdentity(task)}.${field.id}`;
  const control = field.type === "textarea"
    ? <textarea value={String(value ?? "")} placeholder={field.placeholder ?? undefined} onChange={(event) => onChange(event.target.value)} />
    : field.type === "select"
      ? <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Выберите</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : field.type === "checkbox"
        ? <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        : <input type={field.type} value={String(value ?? "")} min={field.min ?? undefined} max={field.max ?? undefined} placeholder={field.placeholder ?? undefined} onChange={(event) => onChange(field.type === "number" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />;
  return <label className={error ? "field-error" : ""} data-field-path={path}>{field.label}{required && <strong> *</strong>}{control}{field.helpText && <small>{field.helpText}</small>}<FieldError text={error} /></label>;
}
function isDynamicFieldVisible(field: DynamicRequestField, values: Record<string, unknown>) { return !field.requiredWhen || values[field.requiredWhen.fieldId] === field.requiredWhen.equals; }
function isDynamicFieldRequired(field: DynamicRequestField, values: Record<string, unknown>) { return Boolean(field.required || (field.requiredWhen && values[field.requiredWhen.fieldId] === field.requiredWhen.equals)); }
function VisitSlots({ slots, errors, onChange, onAdd, onRemove }: { slots: Slot[]; errors: FormError[]; onChange: (id: string, patch: Partial<Slot>) => void; onAdd: () => void; onRemove: (id: string) => void }) { return <div className="visit-slots">{slots.map((slot, index) => { const error = errors.find((item) => item.path === `schedule.visitSlots.${slot.id}.startTime`); return <div className={`visit-slot${error ? " field-error" : ""}`} key={slot.id}><strong>Визит {index + 1}</strong><label>Время начала<input data-field-path={`schedule.visitSlots.${slot.id}.startTime`} type="time" value={slot.startTime} onChange={(event) => onChange(slot.id, { startTime: event.target.value })} />{error && <FieldError text={error.message} />}</label><label>Длительность<select value={slot.durationMinutes} onChange={(event) => onChange(slot.id, { durationMinutes: Number(event.target.value) })}>{durations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><span>Окончание<strong>{slotEnd(slot)}</strong></span>{slots.length > 1 && <button className="icon-button" type="button" title="Удалить визит" onClick={() => onRemove(slot.id)}><Trash2 size={18} /></button>}</div>; })}<button className="secondary-button" type="button" onClick={onAdd}><Plus size={17} />Добавить ещё один визит</button></div>; }
function newSlot(startTime: string, durationMinutes: number): Slot { return { id: crypto.randomUUID(), startTime, durationMinutes }; }
function taskPayload(task: SelectedTask) { return { categoryId: task.categoryId, subcategoryId: task.subcategoryId ?? undefined, taskTemplateId: task.taskTemplateId ?? undefined }; }
function taskIdentity(task: Pick<SelectedTask, "categoryId" | "subcategoryId" | "taskTemplateId">) { return `${task.categoryId}:${task.subcategoryId ?? "root"}:${task.taskTemplateId ?? "none"}`; }
function toggle<T>(values: T[], value: T) { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
function normalize(value: string) { return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim(); }
function containsMedicalQuery(value: string) { const query = normalize(value); return ["укол", "инъекц", "капельниц", "перевяз", "обработка ран", "диагност", "лечение"].some((term) => query.includes(term)); }
function slotEnd(slot: Slot) { const [h, m] = slot.startTime.split(":").map(Number); const total = h * 60 + m + slot.durationMinutes; return total > 1440 ? "за пределами суток" : `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
function timeMinutes(value: string) { const [hours = 0, minutes = 0] = value.split(":").map(Number); return hours * 60 + minutes; }
function formatMoney(value: number) { return `${value.toLocaleString("ru-RU")} ₽`; }
function formatDuration(minutes: number) { return minutes % 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes / 60} ч`; }
function localDate(offsetDays: number) { const date = new Date(); date.setDate(date.getDate() + offsetDays); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
