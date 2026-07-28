import { Ban, Eye, RefreshCcw, ShieldCheck, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Shell } from "../components/Shell";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { managerNavigation, sectionTitleForPath } from "../routes/navigation";
import type { Chat, ClientRequest, User } from "../types";
import { formatDateTimeRu } from "../utils/dateTime";
import { labelStatus } from "../utils/labels";

type ManagerRecord = Record<string, any>;

export function ManagerDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [complaints, setComplaints] = useState<ManagerRecord[]>([]);
  const [payments, setPayments] = useState<ManagerRecord[]>([]);
  const [transactions, setTransactions] = useState<ManagerRecord[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<{ title: string; row: ManagerRecord } | null>(null);
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);

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
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Блокировка недоступна.");
    }
  }

  async function unblockUser(userRow: User) {
    try {
      await api.managerUnblockUser(userRow.id);
      setNotice("Блокировка менеджера снята. Действие сохранено в журнале.");
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

      {activeTab === "Заявки" && <ReadOnlyRows title="Заявки" rows={requests} render={(row) => requestRow(row, () => void openDetail("request", row.id))} />}
      {activeTab === "Чаты" && <ReadOnlyRows title="Чаты" rows={chats} render={(row) => chatRow(row, () => void openDetail("chat", row.id))} />}
      {activeTab === "Обращения" && <ReadOnlyRows title="Обращения" rows={complaints} render={(row) => complaintRow(row, () => void openDetail("complaint", row.id))} />}
      {activeTab === "Платежи" && <ReadOnlyRows title="Платежи" rows={payments} render={paymentRow} />}
      {activeTab === "Операции баланса" && <ReadOnlyRows title="Операции баланса" rows={transactions} render={transactionRow} />}

      {activeTab === "Профиль менеджера" && user && (
        <section className="plain-section">
          <h2>Профиль менеджера</h2>
          <div className="detail-grid">
            <span>Имя / Логин</span><strong>{user.displayName}</strong>
            <span>Телефон</span><strong>{user.phone ?? "не указан"}</strong>
            <span>Email</span><strong>{user.email ?? "не указан"}</strong>
            <span>VK ID</span><strong>{user.identities?.some((identity) => identity.provider === "vk") ? "привязан" : "не привязан"}</strong>
          </div>
        </section>
      )}

      {selectedUser && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal-panel">
            <div className="card__head">
              <h2>{selectedUser.displayName}</h2>
              <button className="secondary-button" type="button" onClick={() => setSelectedUser(null)}>Закрыть</button>
            </div>
            <div className="detail-grid">
              <span>Роль</span><strong>{roleLabel(selectedUser.role)}</strong>
              <span>Статус</span><strong>{labelStatus(selectedUser.status)}</strong>
              <span>Город</span><strong>{selectedUser.city?.name ?? "не выбран"}</strong>
              <span>Телефон</span><strong>{selectedUser.phone ?? "не указан"}</strong>
              <span>Email</span><strong>{selectedUser.email ?? "не указан"}</strong>
              <span>Дата регистрации</span><strong>{formatDateTimeRu((selectedUser as any).createdAt)}</strong>
              <span>Причина блокировки</span><strong>{selectedUser.blockReason ?? "нет"}</strong>
              <span>Кем заблокирован</span><strong>{selectedUser.blockedByRole ? roleLabel(selectedUser.blockedByRole) : "нет"}</strong>
            </div>
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

function requestRow(row: any, onOpen: () => void) {
  return <div className="data-row" key={row.id}><strong>{row.publicNumber ?? row.id}</strong><span>{row.title}</span><span>{labelStatus(row.status)}</span><span>{row.city?.name ?? ""}</span><button className="secondary-button" type="button" onClick={onOpen}>Открыть</button></div>;
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

function detailRows(row: ManagerRecord): Array<[string, string]> {
  const values: Array<[string, unknown]> = [
    ["Внутренний ID", row.id],
    ["Номер", row.publicNumber ?? row.orderId],
    ["Название", row.title],
    ["Статус", row.status ? labelStatus(row.status) : undefined],
    ["Заказчик", row.client?.displayName ?? row.fromUser?.displayName],
    ["Помощник", row.performer?.displayName],
    ["Причина", row.reason],
    ["Описание", row.description],
    ["Дата создания", row.createdAt ? formatDateTimeRu(row.createdAt) : undefined]
  ];
  return values.filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null)
    .map(([label, value]) => [label, String(value)]);
}
