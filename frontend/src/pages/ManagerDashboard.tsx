import { Ban, Eye, Plus, RefreshCcw, ShieldCheck, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Shell } from "../components/Shell";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { managerNavigation, sectionTitleForPath } from "../routes/navigation";
import type { Chat, City, ClientRequest, ManagerCreateRequestInput, ManagerUserDetails, ServiceCategory, User } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";
import { labelStatus } from "../utils/labels";
import { ServiceCommunicationsPage } from "./ServiceCommunicationsPage";
import { UserServiceCommunicationPanel } from "../components/UserServiceCommunicationPanel";
import { VisitReservePanel } from "../components/VisitReservePanel";

type ManagerRecord = Record<string, any>;

export function ManagerDashboard() {
  const { user, bootstrap } = useAuth();
  const location = useLocation();
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [complaints, setComplaints] = useState<ManagerRecord[]>([]);
  const [payments, setPayments] = useState<ManagerRecord[]>([]);
  const [transactions, setTransactions] = useState<ManagerRecord[]>([]);
  const [selectedUser, setSelectedUser] = useState<ManagerUserDetails | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<{ title: string; row: ManagerRecord } | null>(null);
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingRequest, setIsCreatingRequest] = useState(false);
  const [requestForm, setRequestForm] = useState<ManagerRequestFormState>(emptyManagerRequestForm);

  const activeTab = useMemo(
    () => sectionTitleForPath(location.pathname, managerNavigation),
    [location.pathname]
  );

  async function load() {
    setIsLoading(true);
    setNotice("");
    try {
      const [summaryRows, userRows, requestRows, chatRows, complaintRows, paymentRows, transactionRows] = await Promise.all([
        api.managerSummary(),
        api.managerUsers(),
        api.managerRequests(),
        api.managerChats(),
        api.managerComplaints(),
        api.managerPayments(),
        api.managerTransactions()
      ]);
      setSummary(summaryRows);
      setUsers(userRows);
      setRequests(requestRows);
      setChats(chatRows);
      setComplaints(complaintRows as ManagerRecord[]);
      setPayments(paymentRows as ManagerRecord[]);
      setTransactions(transactionRows as ManagerRecord[]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить кабинет менеджера.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openUser(userRow: User) {
    try {
      setSelectedUser(await api.managerUser(userRow.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось открыть профиль пользователя.");
    }
  }

  async function blockUser(userRow: User) {
    const reason = window.prompt("Укажите причину блокировки:");
    if (!reason?.trim()) return;
    try {
      await api.managerBlockUser(userRow.id, reason.trim());
      setNotice("Пользователь заблокирован. Действие сохранено в журнале.");
      setSelectedUser(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Блокировка недоступна.");
    }
  }

  async function unblockUser(userRow: User) {
    try {
      await api.managerUnblockUser(userRow.id);
      setNotice("Блокировка менеджера снята. Действие сохранено в журнале.");
      setSelectedUser(null);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Разблокировка недоступна.");
    }
  }

  async function openDetail(kind: "request" | "chat" | "complaint", id: string) {
    try {
      const row = kind === "request"
        ? await api.managerRequest(id)
        : kind === "chat"
          ? await api.managerChat(id)
          : await apiFetchManagerComplaint(id);
      setSelectedDetail({
        title: kind === "request" ? "Карточка заявки" : kind === "chat" ? "Карточка чата" : "Карточка обращения",
        row: row as ManagerRecord
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось открыть карточку.");
    }
  }

  function apiFetchManagerComplaint(id: string) {
    return api.managerComplaint(id);
  }

  async function createRequest(event: React.FormEvent) {
    event.preventDefault();
    setIsCreatingRequest(true);
    setNotice("");
    try {
      const input: ManagerCreateRequestInput = {
        customerUserId: requestForm.customerUserId,
        cityId: requestForm.cityId,
        categoryId: requestForm.categoryId,
        contactName: optionalText(requestForm.contactName),
        contactPhone: optionalText(requestForm.contactPhone),
        helpFor: requestForm.helpFor || undefined,
        dependentAge: optionalNumber(requestForm.dependentAge),
        title: requestForm.title.trim(),
        description: requestForm.description.trim(),
        addressStreet: requestForm.addressStreet.trim(),
        addressHouse: requestForm.addressHouse.trim(),
        addressApartment: optionalText(requestForm.addressApartment),
        date: optionalText(requestForm.date),
        timeFrom: optionalText(requestForm.timeFrom),
        timeTo: optionalText(requestForm.timeTo),
        expectedDurationHours: optionalNumber(requestForm.expectedDurationHours),
        urgency: requestForm.urgency,
        priceEstimateAmount: optionalNumber(requestForm.priceEstimateAmount),
        comment: optionalText(requestForm.comment)
      };
      await api.managerCreateRequest(input);
      setRequestForm(emptyManagerRequestForm);
      setNotice("Черновик заявки создан для Заказчика. Действие сохранено в журнале.");
      const requestRows = await api.managerRequests();
      setRequests(requestRows);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось создать заявку.");
    } finally {
      setIsCreatingRequest(false);
    }
  }

  return (
    <Shell title={sectionTitleForPath(location.pathname, managerNavigation)} navigation={managerNavigation} variant="admin">
      <section className="plain-section manager-access-banner">
        <div className="card__head">
          <div>
            <p className="eyebrow">Операционный доступ</p>
            <h2>Кабинет менеджера</h2>
          </div>
          <ShieldCheck size={24} aria-hidden="true" />
        </div>
        <p>Вы можете помогать с операционной работой, но не можете менять системные настройки и роли пользователей.</p>
      </section>

      {notice && <p className="notice">{notice}</p>}
      {isLoading && <p>Загрузка данных...</p>}

      {activeTab === "Главная" && (
        <div className="list">
          <section className="panel-grid">
            {Object.entries(summary).map(([key, value]) => (
              <div className="metric" key={key} data-audit-card>
                <UserRoundCheck size={20} />
                <span>{summaryLabel(key)}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <button className="secondary-button" type="button" onClick={() => void load()}>
            <RefreshCcw size={18} /> Обновить
          </button>
        </div>
      )}

      {activeTab === "Пользователи" && (
        <section className="plain-section">
          <h2>Пользователи</h2>
          {users.length === 0 ? <EmptyState title="Пользователей пока нет." /> : (
            <div className="data-table" data-audit-table>
              {users.map((userRow) => (
                <div className="data-row" key={userRow.id}>
                  <button className="link-button" type="button" onClick={() => void openUser(userRow)}>
                    <Eye size={16} /> {userRow.displayName}
                  </button>
                  <span>{roleLabel(userRow.role)}</span>
                  <span>{userRow.city?.name ?? "город не выбран"}</span>
                  <StatusBadge tone={statusTone(userRow.status)}>{labelStatus(userRow.status)}</StatusBadge>
                  {userRow.status === "blocked" && userRow.blockedByRole === "manager" ? (
                    <button className="secondary-button" type="button" onClick={() => void unblockUser(userRow)}>
                      Разблокировать
                    </button>
                  ) : userRow.status === "blocked" ? (
                    <span>Разблокирует Администратор</span>
                  ) : userRow.status !== "archived" && !["manager", "admin", "superadmin"].includes(userRow.role) ? (
                    <button className="secondary-button" type="button" onClick={() => void blockUser(userRow)}>
                      <Ban size={16} /> Заблокировать
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "Заявки" && (
        <div className="list">
          <ManagerRequestForm
            value={requestForm}
            onChange={setRequestForm}
            onSubmit={createRequest}
            customers={users.filter((row) => row.role === "client" && row.status === "active")}
            cities={(bootstrap?.cities ?? []).filter((city) => city.isActive && city.serviceStatus === "active")}
            categories={(bootstrap?.categories ?? []).filter((category) => category.isActive)}
            isSubmitting={isCreatingRequest}
          />
          <ReadOnlyRows title="Заявки" rows={requests} render={(row) => requestRow(row, () => void openDetail("request", row.id))} />
        </div>
      )}
      {activeTab === "Чаты" && <ServiceCommunicationsPage canBroadcast={false} requestChats={<ReadOnlyRows title="Чаты" rows={chats} render={(row) => chatRow(row, () => void openDetail("chat", row.id))} />} />}
      {activeTab === "Обращения" && <ReadOnlyRows title="Обращения" rows={complaints} render={(row) => complaintRow(row, () => void openDetail("complaint", row.id))} />}
      {activeTab === "Платежи" && <ReadOnlyRows title="Платежи" rows={payments} render={paymentRow} />}
      {activeTab === "Операции баланса" && <ReadOnlyRows title="Операции баланса" rows={transactions} render={transactionRow} />}
      {activeTab === "Резерв визитов" && <VisitReservePanel canReconcile={false} />}

      {activeTab === "Профиль менеджера" && user && (
        <section className="plain-section">
          <h2>Профиль менеджера</h2>
          <div className="detail-grid">
            <span>Имя / Логин</span><strong>{user.displayName}</strong>
            <span>Телефон</span><strong data-contact-field="phone">{user.phone?.trim() || "не указан"}</strong>
            <span>Email</span><strong data-contact-field="email">{user.email?.trim() || "не указан"}</strong>
            <span>VK ID</span><strong>{user.identities?.some((identity) => identity.provider === "vk") ? "привязан" : "не привязан"}</strong>
          </div>
        </section>
      )}

      {selectedUser && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" data-user-modal-backdrop onClick={() => setSelectedUser(null)}>
          <section className="modal-panel" data-user-modal-content onClick={(event) => event.stopPropagation()}>
            <div className="card__head">
              <h2>{selectedUser.user.displayName}</h2>
              <button className="secondary-button" type="button" onClick={() => setSelectedUser(null)}>Закрыть</button>
            </div>
            <h3>Основные данные</h3>
            <UserServiceCommunicationPanel userId={selectedUser.user.id} />
            <div className="detail-grid">
              <span>Роль</span><strong>{roleLabel(selectedUser.user.role)}</strong>
              <span>Статус</span><strong>{labelStatus(selectedUser.user.status)}</strong>
              <span>Город</span><strong>{selectedUser.user.city?.name ?? "не выбран"}</strong>
              <span>Телефон</span><strong data-contact-field="phone">{selectedUser.user.phone?.trim() || "не указан"}</strong>
              <span>Email</span><strong data-contact-field="email">{selectedUser.user.email?.trim() || "не указан"}</strong>
              <span>Дата регистрации</span><strong>{selectedUser.user.createdAt ? formatDateTimeRu(selectedUser.user.createdAt) : "не указана"}</strong>
              <span>Источник регистрации</span><strong>{registrationSourceLabel(selectedUser.user.registrationSource)}</strong>
            </div>
            {isUserBalanceRole(selectedUser.user.role) ? <>
              <h3>Финансы</h3>
              <div className="detail-grid">
                <span>Основной баланс</span><strong>{selectedUser.finance.mainBalance} ₽</strong>
                <span>Бонусный баланс</span><strong>{selectedUser.finance.bonusBalance} ₽</strong>
                <span>Доступно</span><strong>{selectedUser.finance.availableBalance} ₽</strong>
              </div>
              <div className="data-table" data-audit-table>
                {selectedUser.finance.balanceTransactions.length === 0 ? <p>Операций баланса пока нет.</p> : selectedUser.finance.balanceTransactions.map((row) => (
                  <div className="data-row" key={row.id}>
                    <strong>{formatDateTimeRu(row.createdAt)}</strong>
                    <span>{row.type}</span>
                    <span>{row.amount > 0 ? "+" : ""}{row.amount} ₽</span>
                    <span>{row.comment ? `${row.reason}: ${row.comment}` : row.reason}</span>
                    <span>{formatBalanceChange(row.balanceBefore, row.balanceAfter)}</span>
                  </div>
                ))}
              </div>
            </> : <p className="notice">Баланс не применяется к служебной роли.</p>}
            <h3>Активность</h3>
            <div className="detail-grid">
              <span>Заявки</span><strong>{selectedUser.activity.requestsCount}</strong>
              <span>Отклики</span><strong>{selectedUser.activity.responsesCount}</strong>
              <span>Чаты</span><strong>{selectedUser.activity.chatsCount}</strong>
              <span>Обращения</span><strong>{selectedUser.activity.complaintsCount}</strong>
              <span>Последняя активность</span><strong>{formatDateTimeRu(selectedUser.activity.lastActivityAt)}</strong>
            </div>
            <h3>Доступ</h3>
            <div className="detail-grid">
              <span>Причина блокировки</span><strong>{selectedUser.user.blockReason ?? "нет"}</strong>
              <span>Кем заблокирован</span><strong>{selectedUser.user.blockedByRole ? roleLabel(selectedUser.user.blockedByRole) : "нет"}</strong>
              <span>Дата блокировки</span><strong>{selectedUser.user.blockedAt ? formatDateTimeRu(selectedUser.user.blockedAt) : "нет"}</strong>
            </div>
            {selectedUser.user.status === "blocked" && selectedUser.user.blockedByRole === "manager" ? (
              <button className="secondary-button" type="button" onClick={() => void unblockUser(selectedUser.user)}>Разблокировать</button>
            ) : selectedUser.user.status === "active" && !["manager", "admin", "superadmin"].includes(selectedUser.user.role) ? (
              <button className="secondary-button" type="button" onClick={() => void blockUser(selectedUser.user)}><Ban size={16} /> Заблокировать</button>
            ) : null}
          </section>
        </div>
      )}

      {selectedDetail && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel">
            <div className="card__head">
              <h2>{selectedDetail.title}</h2>
              <button className="secondary-button" type="button" onClick={() => setSelectedDetail(null)}>Закрыть</button>
            </div>
            <div className="detail-grid">
              {detailRows(selectedDetail.row).map(([label, value]) => (
                <div className="detail-grid__row" key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

function ReadOnlyRows({ title, rows, render }: { title: string; rows: any[]; render: (row: any) => React.ReactNode }) {
  return (
    <section className="plain-section">
      <div className="card__head"><h2>{title}</h2><span>Только просмотр</span></div>
      {rows.length === 0 ? <EmptyState title="Данных пока нет." /> : (
        <div className="data-table" data-audit-table>{rows.map(render)}</div>
      )}
    </section>
  );
}

type ManagerRequestFormState = {
  customerUserId: string;
  cityId: string;
  categoryId: string;
  contactName: string;
  contactPhone: string;
  helpFor: "" | NonNullable<ManagerCreateRequestInput["helpFor"]>;
  dependentAge: string;
  title: string;
  description: string;
  addressStreet: string;
  addressHouse: string;
  addressApartment: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  expectedDurationHours: string;
  urgency: NonNullable<ManagerCreateRequestInput["urgency"]>;
  priceEstimateAmount: string;
  comment: string;
};

const emptyManagerRequestForm: ManagerRequestFormState = {
  customerUserId: "",
  cityId: "",
  categoryId: "",
  contactName: "",
  contactPhone: "",
  helpFor: "",
  dependentAge: "",
  title: "",
  description: "",
  addressStreet: "",
  addressHouse: "",
  addressApartment: "",
  date: "",
  timeFrom: "",
  timeTo: "",
  expectedDurationHours: "",
  urgency: "normal",
  priceEstimateAmount: "",
  comment: ""
};

function ManagerRequestForm({
  value,
  onChange,
  onSubmit,
  customers,
  cities,
  categories,
  isSubmitting
}: {
  value: ManagerRequestFormState;
  onChange: (value: ManagerRequestFormState) => void;
  onSubmit: (event: React.FormEvent) => void;
  customers: User[];
  cities: City[];
  categories: ServiceCategory[];
  isSubmitting: boolean;
}) {
  const set = (field: keyof ManagerRequestFormState, nextValue: string) => onChange({ ...value, [field]: nextValue });
  return (
    <section className="plain-section">
      <div className="card__head">
        <div><p className="eyebrow">Операционная работа</p><h2>Создать заявку от имени Заказчика</h2></div>
        <Plus size={22} aria-hidden="true" />
      </div>
      <p>Заявка будет создана для выбранного Заказчика. Все действия менеджера сохраняются в журнале.</p>
      <p className="privacy-note">Менеджер не может менять баланс пользователя. Для финансовых корректировок обратитесь к администратору. Отклик Помощника автоматически не создаётся.</p>
      <form className="form-grid manager-request-form" onSubmit={onSubmit}>
        <label>Заказчик<select required value={value.customerUserId} onChange={(event) => set("customerUserId", event.target.value)}><option value="">Выберите Заказчика</option>{customers.map((row) => <option key={row.id} value={row.id}>{row.displayName} · {row.phone || row.email || "контакт не указан"}</option>)}</select></label>
        <label>Город<select required value={value.cityId} onChange={(event) => set("cityId", event.target.value)}><option value="">Выберите подключённый город</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label>
        <label>Категория / пакет<select required value={value.categoryId} onChange={(event) => set("categoryId", event.target.value)}><option value="">Выберите формат помощи</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Для кого нужна помощь<select value={value.helpFor} onChange={(event) => set("helpFor", event.target.value)}><option value="">Не указано</option><option value="elderly">Пожилой человек</option><option value="child">Ребёнок</option><option value="limited_mobility">Человек с ограниченной мобильностью</option><option value="home_family">Дом и семья</option><option value="other">Другое</option></select></label>
        <label>Контактное имя<input value={value.contactName} onChange={(event) => set("contactName", event.target.value)} placeholder="По умолчанию имя Заказчика" /></label>
        <label>Контактный телефон<input value={value.contactPhone} onChange={(event) => set("contactPhone", event.target.value)} placeholder="По умолчанию телефон Заказчика" /></label>
        <label>Возраст Подопечного<input type="number" min="1" max="120" value={value.dependentAge} onChange={(event) => set("dependentAge", event.target.value)} /></label>
        <label>Ориентир стоимости, ₽<input type="number" min="1" max="100000" step="1" value={value.priceEstimateAmount} onChange={(event) => set("priceEstimateAmount", event.target.value)} /></label>
        <label className="span-full">Название заявки<input required minLength={4} maxLength={160} value={value.title} onChange={(event) => set("title", event.target.value)} /></label>
        <label className="span-full">Описание<textarea required minLength={10} maxLength={4000} value={value.description} onChange={(event) => set("description", event.target.value)} /></label>
        <label>Улица<input required value={value.addressStreet} onChange={(event) => set("addressStreet", event.target.value)} /></label>
        <label>Дом<input required value={value.addressHouse} onChange={(event) => set("addressHouse", event.target.value)} /></label>
        <label>Квартира<input value={value.addressApartment} onChange={(event) => set("addressApartment", event.target.value)} /></label>
        <label>Дата<input type="date" value={value.date} onChange={(event) => set("date", event.target.value)} /></label>
        <label>Время с<input type="time" value={value.timeFrom} onChange={(event) => set("timeFrom", event.target.value)} /></label>
        <label>Время до<input type="time" value={value.timeTo} onChange={(event) => set("timeTo", event.target.value)} /></label>
        <label>Длительность, часов<input type="number" min="0.5" max="24" step="0.5" value={value.expectedDurationHours} onChange={(event) => set("expectedDurationHours", event.target.value)} /></label>
        <label>Срочность<select value={value.urgency} onChange={(event) => set("urgency", event.target.value)}><option value="normal">Обычная</option><option value="urgent">Срочная</option><option value="regular">Регулярная</option></select></label>
        <label className="span-full">Комментарий<textarea maxLength={2000} value={value.comment} onChange={(event) => set("comment", event.target.value)} /></label>
        <button className="primary-button span-full" type="submit" disabled={isSubmitting || customers.length === 0 || cities.length === 0}>{isSubmitting ? "Создание..." : "Создать черновик заявки"}</button>
      </form>
    </section>
  );
}

function requestRow(row: any, onOpen: () => void) {
  return <div className="data-row" key={row.id}><strong>{row.publicNumber ?? row.id}</strong><span>{row.title}{row.createdByRole === "manager" && <small className="manager-origin-badge">Создано менеджером{row.createdByManager?.displayName ? `: ${row.createdByManager.displayName}` : ""}</small>}</span><span>{labelStatus(row.status)}</span><span>{row.city?.name ?? ""}</span><button className="secondary-button" type="button" onClick={onOpen}>Открыть</button></div>;
}

function chatRow(row: any, onOpen: () => void) {
  return <div className="data-row" key={row.id}><strong>{row.request?.publicNumber ?? row.id}</strong><span>{row.client?.displayName}</span><span>{row.performer?.displayName}</span><span>{labelStatus(row.status)}</span><button className="secondary-button" type="button" onClick={onOpen}>Открыть</button></div>;
}

function complaintRow(row: any, onOpen: () => void) {
  return <div className="data-row" key={row.id}><strong>{row.publicNumber ?? row.id}</strong><span>{row.fromUser?.displayName}</span><span>{row.reason}</span><span>{labelStatus(row.status)}</span><button className="secondary-button" type="button" onClick={onOpen}>Открыть</button></div>;
}

function paymentRow(row: any) {
  return <div className="data-row" key={row.id}><strong>{row.orderId}</strong><span>{row.user?.displayName}</span><span>{row.amount} ₽</span><span>{labelStatus(row.status)}</span></div>;
}

function transactionRow(row: any) {
  return <div className="data-row" key={row.id}><strong>{row.user?.displayName}</strong><span>{row.amount} ₽</span><span>{row.reason}</span><span>{formatDateTimeRu(row.createdAt)}</span></div>;
}

function roleLabel(role: string) {
  if (role === "client") return "Заказчик";
  if (role === "performer") return "Помощник";
  if (role === "manager") return "Менеджер";
  if (role === "superadmin") return "Суперадминистратор";
  if (role === "admin") return "Администратор";
  return "Профиль не завершён";
}

function isUserBalanceRole(role: string) {
  return role === "client" || role === "performer";
}

function summaryLabel(key: string) {
  const labels: Record<string, string> = {
    usersTotal: "Пользователи",
    requestsTotal: "Заявки",
    chatsTotal: "Чаты",
    complaintsTotal: "Обращения",
    paymentsTotal: "Платежи",
    blockedUsersTotal: "Заблокированы"
  };
  return labels[key] ?? key;
}

function registrationSourceLabel(source?: User["registrationSource"]) {
  if (source === "vk_pending") return "VK, профиль не завершён";
  if (source === "vk") return "VK";
  return "Обычная регистрация";
}

function optionalText(value: string) {
  return value.trim() || undefined;
}

function optionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatBalanceChange(before?: number | null, after?: number | null) {
  if (before == null || after == null) return "баланс не зафиксирован";
  return `${before} → ${after} ₽`;
}

function detailRows(row: ManagerRecord): Array<[string, string]> {
  const categorySnapshot = (row as any).categorySnapshot?.snapshot;
  const values: Array<[string, unknown]> = [
    ["Внутренний ID", row.id],
    ["Номер", row.publicNumber ?? row.orderId],
    ["Название", row.title],
    ["Статус", row.status ? labelStatus(row.status) : undefined],
    ["Источник", row.createdByRole === "manager" ? `Заявку создал менеджер${row.createdByManager?.displayName ? `: ${row.createdByManager.displayName}` : ""}` : undefined],
    ["Заказчик", row.client?.displayName ?? row.fromUser?.displayName],
    ["Помощник", row.performer?.displayName],
    ["Причина", row.reason],
    ["Описание", row.description],
    ["Применённая структура", categorySnapshot?.structureTitle ? `${categorySnapshot.structureTitle} ${categorySnapshot.structureVersion} (${categorySnapshot.fallbackStatus})` : undefined],
    ["Категория", categorySnapshot?.category?.title],
    ["Задача", categorySnapshot?.subcategory?.title],
    ["Как часто нужна помощь", categorySnapshot?.frequencyTitle],
    ["Дополнительная задача", categorySnapshot?.additionalTaskSubcategoryTitle],
    ["Ориентировочная сумма", categorySnapshot?.finalCalculatedRecommendedPrice != null ? `${categorySnapshot.finalCalculatedRecommendedPrice} ₽` : undefined],
    ["Дата создания", row.createdAt ? formatDateTimeRu(row.createdAt) : undefined]
  ];
  return values.filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null)
    .map(([label, value]) => [label, String(value)]);
}
