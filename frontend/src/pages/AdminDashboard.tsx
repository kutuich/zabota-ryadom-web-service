import { Archive, Ban, BookOpen, CheckCircle2, Coins, Download, RefreshCcw, Search, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { AdminPaymentsPage } from "./AdminPaymentsPage";
import { AdminNpdRegisterPage } from "./AdminNpdRegisterPage";
import { AdminCategoryStructuresPage } from "./AdminCategoryStructuresPage";
import { ServiceCommunicationsPage } from "./ServiceCommunicationsPage";
import { UserServiceCommunicationPanel } from "../components/UserServiceCommunicationPanel";
import { Shell } from "../components/Shell";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import { ChatPanel } from "../components/ChatPanel";
import { EmptyState } from "../components/EmptyState";
import { PriceSummary } from "../components/PriceSummary";
import { AgreedTermsSummary } from "../components/AgreedTermsSummary";
import { ResponsiveDataList } from "../components/ResponsiveDataList";
import type { AdminBalanceAdjustmentInput, AdminBalanceTransaction, Chat, City, ClientRequest, KnowledgeArticle, LegalDocument, OAuthPendingRestoreSafety, ServiceCategory, TrialBalanceSettings, User, UserArchiveSafety, UserConsent, UserConsentStatus } from "../types";
import { labelChildcare, labelCriminalRecord, labelSelfEmployed, labelStatus, labelTrust, requestDisplayTitle } from "../utils/labels";
import { adminNavigation, chatPathForRole, sectionTitleForPath } from "../routes/navigation";
import { downloadXlsx, downloadZip } from "../utils/xlsx";
import { buildPublicAddressFromRequest, buildYandexExactAddressFromRequest, buildYandexMapsSearchUrl } from "../utils/address";
import { formatDateRu, formatDateTimeRu, formatTimeRu } from "../utils/dateTime";
import { useAuth } from "../context/AuthContext";

const summaryLabels: Record<string, string> = {
  usersTotal: "Пользователей",
  clientsTotal: "Заказчиков",
  performersTotal: "Помощников",
  requestsTotal: "Заявок",
  chatsTotal: "Чатов",
  complaintsTotal: "Жалоб",
  managersTotal: "Менеджеры",
  riskFlagsTotal: "Риски"
};

const balanceUserRoles = new Set(["client", "performer"]);

const lockedServiceFeeSettingKeys = new Set([
  "clientServiceFeeAmount",
  "performerServiceFeeAmount",
  "performerCommissionAmount",
  "serviceCommissionAmount"
]);
const hiddenLegacySettingKeys = new Set(["trialBalanceSettings", ...lockedServiceFeeSettingKeys]);

export function AdminDashboard() {
  const { startActing } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = adminTabFromPath(location.pathname);
  const routeChatId = chatIdFromPath(location.pathname, "/app/admin/chats");
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<ClientRequest[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<AdminBalanceTransaction[]>([]);
  const [settings, setSettings] = useState<any[]>([]);
  const [trialBalanceSettings, setTrialBalanceSettings] = useState<TrialBalanceSettings>({
    enabled: false,
    amount: 100,
    autoGrantNewUsers: false,
    lastBulkGrantAt: null,
    totals: { totalUsers: 0, usersWithTrialBonus: 0, eligibleUsers: 0 }
  });
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [knowledge, setKnowledge] = useState<KnowledgeArticle[]>([]);
  const [legalDocuments, setLegalDocuments] = useState<LegalDocument[]>([]);
  const [legalConsents, setLegalConsents] = useState<UserConsent[]>([]);
  const [legalExportLogs, setLegalExportLogs] = useState<any[]>([]);
  const [adminCategories, setAdminCategories] = useState<ServiceCategory[]>([]);
  const [adminCities, setAdminCities] = useState<City[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatSearch, setChatSearch] = useState("");
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [cityInfoCityId, setCityInfoCityId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedUserLegalStatuses, setSelectedUserLegalStatuses] = useState<UserConsentStatus[]>([]);
  const [selectedUserArchiveSafety, setSelectedUserArchiveSafety] = useState<UserArchiveSafety | null>(null);
  const [selectedOAuthRestoreSafety, setSelectedOAuthRestoreSafety] = useState<OAuthPendingRestoreSafety | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ClientRequest | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<{ request: ClientRequest; response: any } | null>(null);
  const [expandedBalanceUserId, setExpandedBalanceUserId] = useState<string | null>(null);
  const [selectedBalanceUserId, setSelectedBalanceUserId] = useState("");
  const [balanceUserSearch, setBalanceUserSearch] = useState("");
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [orderingArticleId, setOrderingArticleId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [balanceAdjustmentForm, setBalanceAdjustmentForm] = useState<AdminBalanceAdjustmentInput>(() => createBalanceAdjustmentDraft());
  const [balanceAdjustmentError, setBalanceAdjustmentError] = useState("");
  const [isAdjustingBalance, setIsAdjustingBalance] = useState(false);
  const categories = adminCategories;

  async function openActingCabinet(role: "customer" | "helper") {
    try {
      const result = await startActing(role);
      navigate(result.nextPath, { replace: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось открыть кабинет.");
    }
  }

  async function load() {
    const [summaryRows, userRows, requestRows, chatRows, complaintRows, cityRows, categoryRows, transactionRows, settingRows, knowledgeRows, legalDocumentRows, legalConsentRows, legalExportLogRows, trialSettingsRows] = await Promise.all([
      api.adminSummary(),
      api.adminUsers(),
      api.adminRequests(),
      api.adminChats(),
      api.adminComplaints(),
      api.adminCities(),
      api.adminCategories(),
      api.adminTransactions(),
      api.adminSettings(),
      api.adminKnowledge(),
      api.adminLegalDocuments(),
      api.adminLegalConsents(),
      api.adminLegalExportLogs(),
      api.getTrialBalanceSettings()
    ]);
    setSummary(summaryRows);
    setUsers(userRows);
    setRequests(requestRows);
    setChats(chatRows);
    setComplaints(complaintRows);
    setAdminCities(cityRows);
    setAdminCategories(categoryRows);
    setTransactions(transactionRows);
    setSettings(settingRows);
    setTrialBalanceSettings(trialSettingsRows);
    setSettingDrafts(Object.fromEntries((settingRows as any[]).map((setting) => [setting.key, setting.valueJson])));
    setKnowledge(knowledgeRows);
    setLegalDocuments(legalDocumentRows);
    setLegalConsents(legalConsentRows as any);
    setLegalExportLogs(legalExportLogRows as any[]);
  }

  useEffect(() => {
    load().catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    setActiveChatId(routeChatId);
  }, [routeChatId]);

  const clients = useMemo(() => users.filter((user) => user.role === "client"), [users]);
  const performers = useMemo(() => users.filter((user) => user.role === "performer"), [users]);
  const activeUsers = useMemo(() => users.filter((user) => user.status !== "archived"), [users]);
  const archivedUsers = useMemo(() => users.filter((user) => user.status === "archived"), [users]);
  const balanceUsers = useMemo(() => users.filter((user) => balanceUserRoles.has(user.role)), [users]);
  const filteredBalanceUsers = useMemo(() => {
    const query = balanceUserSearch.trim().toLowerCase();
    if (!query) return balanceUsers;
    return balanceUsers.filter((user) => [user.displayName, user.phone, user.email, user.city?.name]
      .filter(Boolean).join(" ").toLowerCase().includes(query));
  }, [balanceUserSearch, balanceUsers]);
  const selectedBalanceUser = balanceUsers.find((user) => user.id === selectedBalanceUserId) ?? null;
  const selectedCity = adminCities.find((city) => city.id === cityInfoCityId) ?? null;
  const selectedCityRequests = cityInfoCityId ? requests.filter((request) => request.cityId === cityInfoCityId) : [];
  const selectedCityResponses = selectedCityRequests.flatMap((request) => (request.responses ?? []).map((response: any) => ({ request, response })));
  const selectedCityClients = cityInfoCityId ? users.filter((user) => userHasCity(user, cityInfoCityId) && user.role === "client") : [];
  const selectedCityPerformers = cityInfoCityId ? users.filter((user) => userHasCity(user, cityInfoCityId) && user.role === "performer") : [];
  const sortedChats = useMemo(() => [...chats].sort((left, right) => {
    const leftNumber = left.request?.publicNumber ?? "";
    const rightNumber = right.request?.publicNumber ?? "";
    return leftNumber.localeCompare(rightNumber, "ru", { numeric: true });
  }), [chats]);
  const filteredChats = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    if (!query) return sortedChats;
    return sortedChats.filter((chat) =>
      [
        chat.request?.publicNumber,
        chat.request?.title,
        chat.client?.displayName,
        chat.performer?.displayName,
        chat.status
      ].filter(Boolean).join(" ").toLowerCase().includes(query)
    );
  }, [chatSearch, sortedChats]);
  const sortedKnowledge = useMemo(() => [...knowledge].sort((left: any, right: any) => {
    const byOrder = left.sortOrder - right.sortOrder;
    if (byOrder !== 0) return byOrder;
    return String(left.createdAt ?? left.title).localeCompare(String(right.createdAt ?? right.title), "ru");
  }), [knowledge]);

  async function block(userId: string) {
    const reason = window.prompt("Укажите причину блокировки:", "Ручная блокировка администратором");
    if (!reason?.trim()) return;
    await api.adminBlockUser(userId, reason.trim());
    setNotice("Пользователь заблокирован. История заявок, платежей, баланса и согласий сохранена.");
    await load();
  }

  async function unblock(userId: string) {
    await api.adminUnblockUser(userId);
    setNotice("Пользователь разблокирован.");
    await load();
  }

  async function requestArchive(user: User) {
    const reason = window.prompt("Укажите причину планирования архивирования:");
    if (!reason?.trim()) return;
    const result = await api.adminRequestUserArchive(user.id, reason.trim());
    setSelectedUser(result.user);
    setSelectedUserArchiveSafety(result.safety);
    setNotice("Архивирование запланировано. Профиль будет архивирован после выполнения условий безопасности.");
    await load();
  }

  async function archiveUser(user: User) {
    if (!window.confirm(`Проверить и архивировать профиль ${user.displayName}?`)) return;
    const reason = window.prompt("Укажите итоговую причину архивирования:", user.archiveReason ?? "");
    if (!reason?.trim()) return;
    try {
      const result = await api.adminArchiveUser(user.id, reason.trim());
      setSelectedUser(result.user);
      setSelectedUserArchiveSafety(result.safety);
      setNotice("Профиль архивирован. Финансовая, юридическая и операционная история сохранена.");
      await load();
    } catch (error) {
      const safety = error instanceof ApiError ? error.details as UserArchiveSafety | undefined : undefined;
      if (safety) setSelectedUserArchiveSafety(safety);
      setNotice(error instanceof Error ? error.message : "Архивирование сейчас недоступно.");
    }
  }

  async function cancelPendingOAuthRegistration(user: User) {
    if (!window.confirm(`Отменить незавершённую VK-регистрацию ${user.displayName}?`)) return;
    try {
      await api.adminCancelPendingOAuthRegistration(user.id);
      setSelectedUser(null);
      setNotice("Незавершённая VK-регистрация отменена. Запись сохранена в архиве.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось отменить незавершённую регистрацию.");
    }
  }

  async function restorePendingOAuthRegistration(user: User) {
    if (!window.confirm("Восстановить незавершённую VK-регистрацию? Пользователь сможет снова войти через VK и заполнить профиль.")) return;
    try {
      const result = await api.adminRestorePendingOAuthRegistration(user.id);
      setSelectedUser(result.user);
      setSelectedOAuthRestoreSafety(null);
      setNotice("Незавершённая VK-регистрация восстановлена.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось восстановить незавершённую регистрацию.");
    }
  }

  async function openUserProfile(user: User) {
    setSelectedUser(user);
    setBalanceAdjustmentForm(createBalanceAdjustmentDraft());
    setBalanceAdjustmentError("");
    setSelectedUserLegalStatuses([]);
    setSelectedUserArchiveSafety(null);
    setSelectedOAuthRestoreSafety(null);
    if (isArchivedIncompleteVkRegistration(user)) {
      try {
        setSelectedOAuthRestoreSafety(await api.adminOAuthPendingRestoreSafety(user.id));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Не удалось проверить возможность восстановления.");
      }
      return;
    }
    if (isIncompleteVkRegistration(user)) return;
    try {
      const [legalStatuses, safety] = await Promise.all([
        api.adminUserLegalConsents(user.id),
        api.adminUserArchiveSafety(user.id)
      ]);
      setSelectedUserLegalStatuses(legalStatuses);
      setSelectedUserArchiveSafety(safety);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось загрузить юридические согласия пользователя.");
    }
  }

  async function submitBalanceAdjustment(targetUser = selectedUser) {
    if (!targetUser) return;
    if (!Number.isSafeInteger(balanceAdjustmentForm.amount) || balanceAdjustmentForm.amount <= 0 || balanceAdjustmentForm.amount > 100_000) {
      setBalanceAdjustmentError("Укажите целую сумму от 1 до 100000 ₽.");
      return;
    }
    if (balanceAdjustmentForm.comment.trim().length < 10) {
      setBalanceAdjustmentError("Укажите комментарий не короче 10 символов.");
      return;
    }
    const action = balanceAdjustmentForm.direction === "credit"
      ? `начислить ${balanceAdjustmentForm.amount} ₽ на ${balanceAdjustmentForm.wallet === "main" ? "основной баланс" : "бонусный баланс"}`
      : `списать ${balanceAdjustmentForm.amount} ₽ с ${balanceAdjustmentForm.wallet === "main" ? "основного баланса" : "бонусного баланса"}`;
    if (!window.confirm(
      `Вы действительно хотите ${action} пользователя ${targetUser.displayName}? Операция будет записана в историю и аудит.`
    )) return;

    setIsAdjustingBalance(true);
    setBalanceAdjustmentError("");
    try {
      const result = await api.adminAdjustBalance(targetUser.id, {
        ...balanceAdjustmentForm,
        comment: balanceAdjustmentForm.comment.trim()
      });
      setSelectedUser((current) => current?.id === targetUser.id ? { ...current, ...result.user } : current);
      setBalanceAdjustmentForm(createBalanceAdjustmentDraft());
      setNotice("Корректировка баланса выполнена.");
      await load();
    } catch (error) {
      setBalanceAdjustmentError(error instanceof Error ? error.message : "Не удалось провести корректировку баланса.");
    } finally {
      setIsAdjustingBalance(false);
    }
  }

  async function assignManager(user: User) {
    if (!window.confirm(`Назначить ${user.displayName} менеджером?`)) return;
    const reason = window.prompt("Комментарий к назначению (необязательно):") ?? undefined;
    try {
      const updated = await api.adminAssignManager(user.id, reason?.trim() || undefined);
      setSelectedUser(updated);
      setNotice("Пользователь назначен менеджером. Предыдущая роль сохранена.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось назначить менеджера.");
    }
  }

  async function revokeManager(user: User) {
    if (!window.confirm(`Снять роль менеджера у ${user.displayName}?`)) return;
    let restoreRole = user.roleBeforeManager ?? undefined;
    if (!restoreRole) {
      const answer = window.prompt("Укажите роль для восстановления: client или performer");
      if (answer !== "client" && answer !== "performer") {
        setNotice("Нужно выбрать роль Заказчика или Помощника.");
        return;
      }
      restoreRole = answer;
    }
    const reason = window.prompt("Комментарий к снятию роли (необязательно):") ?? undefined;
    try {
      const updated = await api.adminRevokeManager(user.id, restoreRole, reason?.trim() || undefined);
      setSelectedUser(updated);
      setNotice("Роль менеджера снята. Предыдущая роль восстановлена.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Не удалось снять роль менеджера.");
    }
  }

  async function verifyPerformer(user: User) {
    if (!window.confirm(`Изменить статус проверки помощника ${user.displayName}?`)) return;
    await api.adminUpdatePerformerVerification(user.id, {
      verificationStatuses: [
        "phone_verified",
        "profile_completed",
        "self_employed_verified",
        "criminal_record_verified",
        "trusted_by_reviews"
      ],
      selfEmployedStatus: "self_employed_verified",
      criminalRecordCertificateStatus: "criminal_record_verified",
      trustLevel: "manual_verified",
      childcareApprovalStatus: "approved"
    });
    await load();
  }

  async function markPerformerNotVerified(user: User) {
    if (!window.confirm(`Снять проверку у помощника ${user.displayName}?`)) return;
    await api.adminUpdatePerformerVerification(user.id, {
      verificationStatuses: ["phone_verified", "profile_completed", "documents_optional"],
      selfEmployedStatus: "self_employed_provided",
      criminalRecordCertificateStatus: "criminal_record_not_provided",
      trustLevel: "not_verified",
      childcareApprovalStatus: "missing_criminal_record"
    });
    await load();
  }

  async function updateDocumentStatus(documentId: string, status: string) {
    await api.adminUpdatePerformerDocumentStatus(documentId, status, status === "verified" ? "Подтверждено администратором" : "Отклонено администратором");
    await load();
  }

  async function updateCityConnection(city: City, isActive: boolean) {
    const updated = await api.adminUpdateCity(city.id, {
      serviceStatus: isActive ? "active" : "inactive",
      status: isActive ? "active" : "inactive"
    });
    setAdminCities((current) => current.map((item) => item.id === updated.id ? updated : item));
    setNotice(`${updated.name}: сервис ${isActive ? "активирован" : "деактивирован"}.`);
  }

  async function saveSettings() {
    const editableSettings = settings.filter((setting: any) => !hiddenLegacySettingKeys.has(setting.key));
    await Promise.all(editableSettings.map((setting: any) => api.adminUpdateSetting(setting.key, settingDrafts[setting.key] ?? setting.valueJson)));
    setNotice("Настройки сервиса сохранены и записаны в audit log.");
    await load();
  }

  async function saveTrialBalanceSettings() {
    const updated = await api.updateTrialBalanceSettings({
      enabled: trialBalanceSettings.enabled,
      amount: 100,
      autoGrantNewUsers: trialBalanceSettings.autoGrantNewUsers
    });
    setTrialBalanceSettings(updated);
    setNotice("Настройки пробного периода сохранены.");
  }

  async function grantTrialBalanceToAll() {
    const confirmed = window.confirm(
      "Начисление необратимо. Пользователи, которые уже получали пробный баланс, не получат его повторно."
    );
    if (!confirmed) return;
    const summary = await api.grantTrialBalanceToAll();
    setNotice(
      `Проверено: ${summary.checked}. Начислено: ${summary.granted}. ` +
      `Уже получали: ${summary.skippedAlreadyGranted}. ` +
      `Пропущено: ${summary.skippedBlocked + summary.skippedAdmin}. Ошибок: ${summary.errors.length}.`
    );
    await load();
  }

  async function saveKnowledgeArticle(article: KnowledgeArticle) {
    const updated = await api.adminUpdateKnowledge(article.id, article);
    setKnowledge((current) => current.map((item) => item.id === updated.id ? updated : item));
    setEditingArticle(null);
    await load();
  }

  async function toggleKnowledgeArticle(article: KnowledgeArticle) {
    await api.adminUpdateKnowledge(article.id, { isPublished: !article.isPublished });
    await load();
  }

  async function updateKnowledgeOrder(article: KnowledgeArticle, position: number) {
    const next = sortedKnowledge.filter((item) => item.id !== article.id);
    next.splice(Math.max(0, Math.min(position - 1, next.length)), 0, article);
    await Promise.all(next.map((item, index) => api.adminUpdateKnowledge(item.id, { sortOrder: (index + 1) * 10 })));
    setOrderingArticleId(null);
    setNotice("Порядок отображения обновлён.");
    await load();
  }

  function updateSettingDraft(key: string, valueJson: string) {
    setSettingDrafts((current) => ({ ...current, [key]: valueJson }));
  }

  function openChat(chatId: string) {
    setChatSearch("");
    navigate(chatPathForRole("admin", chatId));
  }

  function exportRequests() {
    downloadXlsx(`zabota-requests-${dateStamp()}.xlsx`, [{
      name: "Заявки",
      rows: [
        requestExportHeader(),
        ...requests.map(requestExportRow)
      ]
    }]);
  }

  function exportResponses() {
    downloadXlsx(`zabota-responses-${dateStamp()}.xlsx`, [{
      name: "Отклики",
      rows: [
        [
          "Номер заявки",
          "Город",
          "Категория",
          "Заказчик",
          "Помощник",
          "Статус отклика",
          "Дата отклика",
          "Есть чат",
          "Статус чата",
          "Оплата помощнику",
          "Сервисный сбор помощника",
          "Доход помощника после сервисного сбора"
        ],
        ...requests.flatMap((request) => (request.responses ?? []).map((response: any) => {
          const pricing = request.pricing ?? parseJsonObject(request.pricingBreakdownJson);
          const chat = chats.find((item) => item.requestId === request.id && item.performerId === response.performerId) ?? request.chat;
          const agreedTerms = chat?.agreedTerms;
          return [
            request.publicNumber ?? "",
            request.city?.name ?? "",
            request.category?.name ?? "",
            (request as any).client?.displayName ?? "",
            response.performer?.displayName ?? "",
            labelStatus(response.status),
            formatDateTimeRu(response.createdAt),
            chat ? "да" : "нет",
            chat ? labelStatus(chat.status) : "",
            agreedTerms?.agreedHelperAmount ?? pricing?.performerPaymentAmount ?? request.priceEstimateAmount ?? 0,
            agreedTerms?.helperServiceFeeAmount ?? pricing?.performerServiceFeeAmount ?? pricing?.performerCommissionAmount ?? 0,
            agreedTerms?.helperNetAmount ?? pricing?.performerNetAmount ?? Math.max(0, (pricing?.performerPaymentAmount ?? request.priceEstimateAmount ?? 0) - (pricing?.performerServiceFeeAmount ?? pricing?.performerCommissionAmount ?? 0))
          ];
        }))
      ]
    }]);
  }

  function exportCity() {
    if (!selectedCity) return;
    const cityRequests = requests.filter((request) => request.cityId === selectedCity.id);
    const cityResponses = cityRequests.flatMap((request) => (request.responses ?? []).map((response: any) => ({ request, response })));
    const cityUsers = users.filter((user) => userHasCity(user, selectedCity.id));
    downloadXlsx(`zabota-city-${safeFileName(selectedCity.name)}-${dateStamp()}.xlsx`, [
      {
        name: "Сводка",
        rows: [
          ["Показатель", "Значение"],
          ...citySummaryRows(selectedCity.id)
        ]
      },
      { name: "Заявки", rows: [requestExportHeader(), ...cityRequests.map(requestExportRow)] },
      {
        name: "Отклики",
        rows: [
          ["Номер заявки", "Заказчик", "Помощник", "Категория", "Статус отклика", "Дата отклика"],
          ...cityResponses.map(({ request, response }) => [
            request.publicNumber ?? "",
            (request as any).client?.displayName ?? "",
            response.performer?.displayName ?? "",
            request.category?.name ?? "",
            labelStatus(response.status),
            formatDateTimeRu(response.createdAt)
          ])
        ]
      },
      {
        name: "Заказчики",
        rows: [
          ["Имя", "Телефон", "Email", "Баланс", "Статус"],
          ...cityUsers.filter((user) => user.role === "client").map((user) => [
            user.displayName,
            user.phone,
            user.email ?? "",
            user.balance + user.bonusBalance,
            labelStatus(user.status)
          ])
        ]
      },
      {
        name: "Помощники",
        rows: [
          ["Имя", "Телефон", "Email", "Баланс", "Статус профиля"],
          ...cityUsers.filter((user) => user.role === "performer").map((user) => [
            user.displayName,
            user.phone,
            user.email ?? "",
            user.balance + user.bonusBalance,
            labelTrust(user.performerProfile?.trustLevel)
          ])
        ]
      }
    ]);
  }

  async function exportAllConsents() {
    const exportPayload = await api.adminExportAllConsents();
    downloadXlsx(exportPayload.fileName, exportPayload.sheets ?? []);
    setNotice("Экспорт согласий сформирован и записан в журнал.");
    await load();
  }

  async function exportUserConsents(user: User) {
    const exportPayload = await api.adminExportUserConsents(user.id);
    downloadXlsx(exportPayload.fileName, exportPayload.sheets ?? []);
    setNotice(`Экспорт согласий пользователя ${user.displayName} сформирован.`);
    await load();
  }

  async function exportUserLegalArchive(user: User) {
    const exportPayload = await api.adminExportUserLegalArchive(user.id);
    downloadZip(exportPayload.fileName, exportPayload.files ?? []);
    setNotice(`Legal-архив пользователя ${user.displayName} сформирован.`);
    await load();
  }

  async function exportLegalArchive() {
    const exportPayload = await api.adminExportLegalArchive();
    downloadZip(exportPayload.fileName, exportPayload.files ?? []);
    setNotice("Юридический архив сформирован и записан в журнал.");
    await load();
  }

  async function createLegalDocumentVersion(document: LegalDocument) {
    const version = window.prompt("Укажите номер новой версии", nextLegalVersion(document.version));
    if (!version) return;
    await api.adminCreateLegalDocumentVersion(document.id, {
      version,
      contentMarkdown: `${document.contentMarkdown}\n\nДополните текст новой редакции перед публикацией.`
    });
    setNotice("Черновик новой версии создан. Отредактируйте текст перед публикацией.");
    await load();
  }

  async function publishLegal(document: LegalDocument) {
    if (!window.confirm(`Опубликовать документ “${document.title}” версии ${document.version}? Старые версии этого типа станут архивными.`)) return;
    await api.adminPublishLegalDocument(document.id);
    setNotice("Юридический документ опубликован. Пользователям потребуется принять новую актуальную версию.");
    await load();
  }

  async function archiveLegal(document: LegalDocument) {
    if (!window.confirm(`Архивировать документ “${document.title}” версии ${document.version}?`)) return;
    await api.adminArchiveLegalDocument(document.id);
    setNotice("Юридический документ перенесён в архив.");
    await load();
  }

  function citySummaryRows(cityId: string) {
    const cityRequests = requests.filter((request) => request.cityId === cityId);
    const cityResponses = cityRequests.flatMap((request) => request.responses ?? []);
    const cityChats = chats.filter((chat) => chat.request?.cityId === cityId);
    const cityComplaints = complaints.filter((complaint) => complaint.request?.cityId === cityId);
    const cityUsers = users.filter((user) => userHasCity(user, cityId));
    const totals = cityRequests.reduce((sum, request) => {
      const pricing = request.pricing ?? parseJsonObject(request.pricingBreakdownJson);
      const agreedTerms = requestAgreedTerms(request);
      return {
        helperPayments: sum.helperPayments + Number(agreedTerms?.agreedHelperAmount ?? pricing?.performerPaymentAmount ?? request.priceEstimateAmount ?? 0),
        customerFees: sum.customerFees + Number(agreedTerms?.customerServiceFeeAmount ?? pricing?.clientServiceFeeAmount ?? 0),
        helperFees: sum.helperFees + Number(agreedTerms?.helperServiceFeeAmount ?? pricing?.performerServiceFeeAmount ?? pricing?.performerCommissionAmount ?? 0)
      };
    }, { helperPayments: 0, customerFees: 0, helperFees: 0 });
    const city = adminCities.find((city) => city.id === cityId);
    return [
      ["Город", city?.name ?? ""],
      ["Регион", city?.region ?? ""],
      ["Часовой пояс", city?.timezone ?? ""],
      ["Тарифная зона", city?.pricingZone ?? ""],
      ["Пояснение", "Используется для будущих отдельных тарифов и расчётов по городам."],
      ["Статус справочника", city?.directoryStatus ?? ""],
      ["Статус сервиса", city?.serviceStatus === "active" ? "Активен" : "Неактивен"],
      ["Источник", city?.source ?? ""],
      ["Тип", city?.type ?? ""],
      ["Район", city?.district ?? ""],
      ["Требует проверки", city?.needsReview ? "Да" : "Нет"],
      ["Дата активации", city?.activatedAt ? formatDateRu(city.activatedAt) : ""],
      ["Заказчиков по связям", city?.customerCount ?? cityUsers.filter((user) => user.role === "client").length],
      ["Помощников по связям", city?.helperCount ?? cityUsers.filter((user) => user.role === "performer").length],
      ["Заявок по данным API", city?.requestCount ?? cityRequests.length],
      ["Порядок сортировки", city?.sortOrder ?? ""],
      ["Количество заявок", cityRequests.length],
      ["Количество активных заявок", cityRequests.filter((request) => !["completed", "cancelled", "archived"].includes(request.status)).length],
      ["Количество выполненных заявок", cityRequests.filter((request) => request.status === "completed").length],
      ["Количество откликов", cityResponses.length],
      ["Количество заказчиков", cityUsers.filter((user) => user.role === "client").length],
      ["Количество помощников", cityUsers.filter((user) => user.role === "performer").length],
      ["Количество чатов", cityChats.length],
      ["Количество обращений", cityComplaints.length],
      ["Общая сумма оплат помощникам", totals.helperPayments],
      ["Общая сумма сервисных сборов заказчиков", totals.customerFees],
      ["Общая сумма сервисных сборов помощников", totals.helperFees]
    ];
  }

  return (
    <Shell title={sectionTitleForPath(location.pathname, adminNavigation)} navigation={adminNavigation} variant="admin">
      {notice && <p className="notice">{notice}</p>}

      {activeTab === "Главная" && (
        <div className="list">
          <section className="plain-section">
            <h2>Быстрый вход в кабинеты</h2>
            <p>Этот режим нужен для проверки пользовательских сценариев и ручного сопровождения заявок. Все действия сохраняются в журнале как действия администратора.</p>
            <div className="trust-row">
              <button className="primary-button" type="button" onClick={() => openActingCabinet("customer")}>Открыть кабинет Заказчика</button>
              <button className="secondary-button" type="button" onClick={() => openActingCabinet("helper")}>Открыть кабинет Помощника</button>
            </div>
          </section>
          <section className="panel-grid">
            {Object.entries(summary).filter(([key]) => key !== "managersActive").map(([key, value]) => (
              <div className="metric" key={key}>
                <ShieldAlert size={20} />
                <span>{summaryLabels[key] ?? key}</span>
                <strong>{key === "managersTotal" ? summary.managersActive ?? 0 : value}</strong>
                {key === "managersTotal" && <small>Активных: {summary.managersActive ?? 0} · Всего: {value}</small>}
              </div>
            ))}
            <button className="secondary-button" type="button" onClick={load}>
              <RefreshCcw size={18} />
              Обновить
            </button>
          </section>
        </div>
      )}

      {activeTab === "Города" && (
        <section className="plain-section">
          <h2>Города / Населённые пункты</h2>
          <p className="notice">Города из VK-аналитики используются только как ориентир спроса и не активируют сервис автоматически.</p>
          <div className="form-inline">
            <label>
              Выберите город
              <select value={selectedCityId ?? ""} onChange={(event) => setSelectedCityId(event.target.value || null)}>
                <option value="">Город не выбран</option>
                {adminCities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name} — {city.serviceStatus === "active" ? "активен" : "неактивен"}{city.needsReview ? " · нужна проверка" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="button" onClick={() => setCityInfoCityId(selectedCityId)}>
              Показать информацию
            </button>
          </div>
          {!selectedCity && <EmptyState title="Выберите город и нажмите “Показать информацию”." />}
          {selectedCity && (
            <div className="list">
              <article className="card">
                <div className="card__head">
                  <div>
                    <p className="eyebrow">Сводка по городу</p>
                    <h3>{selectedCity.name}</h3>
                  </div>
                  <button className="secondary-button" type="button" onClick={exportCity}>
                    <Download size={18} />
                    Экспорт по городу в Excel
                  </button>
                </div>
                <div className="city-connection-control">
                  <span>Доступность города при регистрации</span>
                  <div className="boolean-toggle" role="group" aria-label={`Доступность города ${selectedCity.name}`}>
                    <button
                      type="button"
                      className={selectedCity.serviceStatus === "active" ? "choice choice--active" : "choice"}
                      aria-pressed={selectedCity.serviceStatus === "active"}
                      onClick={() => updateCityConnection(selectedCity, true)}
                    >
                      Активен
                    </button>
                    <button
                      type="button"
                      className={selectedCity.serviceStatus !== "active" ? "choice choice--active" : "choice"}
                      aria-pressed={selectedCity.serviceStatus !== "active"}
                      onClick={() => updateCityConnection(selectedCity, false)}
                    >
                      Неактивен
                    </button>
                  </div>
                </div>
                {selectedCity.directoryStatus === "needs_review" && (
                  <div className="section-actions">
                    <button className="primary-button" type="button" onClick={async () => {
                      const updated = await api.adminUpdateCity(selectedCity.id, { directoryStatus: "verified", source: "admin" });
                      setAdminCities((current) => current.map((item) => item.id === updated.id ? updated : item));
                      setNotice("Населённый пункт подтверждён администратором.");
                    }}>Подтвердить населённый пункт</button>
                    <button className="secondary-button" type="button" onClick={async () => {
                      const updated = await api.adminUpdateCity(selectedCity.id, { directoryStatus: "hidden", isActive: false });
                      setAdminCities((current) => current.map((item) => item.id === updated.id ? updated : item));
                      setNotice("Населённый пункт скрыт.");
                    }}>Скрыть ошибочный вариант</button>
                  </div>
                )}
                <div className="detail-grid">
                  {citySummaryRows(selectedCity.id).map(([label, value]) => (
                    <div className="detail-grid__row" key={String(label)}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                {selectedCityRequests.length === 0 && <p className="empty-text">По выбранному городу пока нет данных.</p>}
              </article>
              <CityDataBlock title="Заявки" emptyText="По выбранному городу пока нет заявок." hasRows={selectedCityRequests.length > 0}>
                <div className="data-row data-row--header">
                  <span>Заявка</span><span>Статус</span><span>Категория</span><span>Заказчик</span><span>Помощник</span><span>Оплата</span><span>Дата</span>
                </div>
                {selectedCityRequests.slice(0, 12).map((request) => {
                  const pricing = request.pricing ?? parseJsonObject(request.pricingBreakdownJson);
                  const agreedTerms = requestAgreedTerms(request);
                  return (
                    <button className="data-row data-row--button" type="button" key={request.id} onClick={() => setSelectedRequest(request)}>
                      <strong>{request.publicNumber} — {request.title}</strong>
                      <span>{labelStatus(request.status)}</span>
                      <span>{request.category?.name ?? "категория не указана"}</span>
                      <span>{(request as any).client?.displayName ?? "не указан"}</span>
                      <span>{(request as any).selectedPerformer?.displayName ?? "не выбран"}</span>
                      <span>{agreedTerms?.agreedHelperAmount ?? pricing?.performerPaymentAmount ?? request.priceEstimateAmount ?? 0} ₽</span>
                      <span>{request.date ? formatDateRu(request.date) : "не указана"}</span>
                    </button>
                  );
                })}
              </CityDataBlock>
              <CityDataBlock title="Отклики" emptyText="По выбранному городу пока нет откликов." hasRows={selectedCityResponses.length > 0}>
                <div className="data-row data-row--header">
                  <span>Заявка</span><span>Помощник</span><span>Статус</span><span>Дата отклика</span><span>Чат</span>
                </div>
                {selectedCityResponses.map(({ request, response }: any) => (
                  <div className="data-row" key={response.id}>
                    <strong>{request.publicNumber} — {request.title}</strong>
                    <span>{response.performer?.displayName ?? "не указан"}</span>
                    <span>{labelStatus(response.status)}</span>
                    <span>{response.createdAt ? formatDateRu(response.createdAt) : "не указана"}</span>
                    <span>{request.chats?.some((chat: { performerId: string }) => chat.performerId === response.performerId) ? "есть" : "нет"}</span>
                  </div>
                ))}
              </CityDataBlock>
              <CityDataBlock title="Заказчики" emptyText="По выбранному городу пока нет заказчиков." hasRows={selectedCityClients.length > 0}>
                <div className="data-row data-row--header">
                  <span>Заказчик</span><span>Телефон</span><span>Заявок</span><span>Баланс</span>
                </div>
                {selectedCityClients.map((user) => (
                  <div className="data-row" key={user.id}>
                    <strong>{user.displayName}</strong>
                    <span>{user.phone}</span>
                    <span>{requests.filter((request) => request.clientId === user.id).length}</span>
                    <span>{Number(user.balance ?? 0) + Number(user.bonusBalance ?? 0)} ₽</span>
                  </div>
                ))}
              </CityDataBlock>
              <CityDataBlock title="Помощники" emptyText="По выбранному городу пока нет помощников." hasRows={selectedCityPerformers.length > 0}>
                <div className="data-row data-row--header">
                  <span>Помощник</span><span>Телефон</span><span>Статус</span><span>Откликов</span><span>Выполнено</span>
                </div>
                {selectedCityPerformers.map((user) => (
                  <div className="data-row" key={user.id}>
                    <strong>{user.displayName}</strong>
                    <span>{user.phone}</span>
                    <span>{labelTrust(user.performerProfile?.trustLevel)}</span>
                    <span>{selectedCityResponses.filter(({ response }: any) => response.performerId === user.id).length}</span>
                    <span>{user.performerProfile?.completedJobsCount ?? 0}</span>
                  </div>
                ))}
              </CityDataBlock>
            </div>
          )}
        </section>
      )}

      {activeTab === "Пользователи" && (
        <section className="list">
          <p className="notice">Физическое удаление пользователей отключено для сохранения истории заявок, платежей, балансов, чатов и юридических согласий. Профили можно блокировать, архивировать или отменять, если VK-регистрация не была завершена.
          </p>
          <UsersTable users={activeUsers} onBlock={block} onUnblock={unblock} onRequestArchive={requestArchive} onArchive={archiveUser} onCancelPending={cancelPendingOAuthRegistration} onSelect={openUserProfile} />
        </section>
      )}
      {activeTab === "Заказчики" && <UsersTable users={clients} onBlock={block} onUnblock={unblock} onRequestArchive={requestArchive} onArchive={archiveUser} onCancelPending={cancelPendingOAuthRegistration} onSelect={openUserProfile} />}

      {activeTab === "Помощники" && (
        <div className="data-table">
          {performers.map((user) => (
            <div className="data-row" key={user.id}>
              <strong>{user.displayName}</strong>
              <span>{labelTrust(user.performerProfile?.trustLevel)}</span>
              <span>{labelSelfEmployed(user.performerProfile?.selfEmployedStatus)}</span>
              <span>{labelCriminalRecord(user.performerProfile?.criminalRecordCertificateStatus)}</span>
              <span>{labelChildcare(user.performerProfile?.childcareApprovalStatus)}</span>
              <button className="secondary-button" type="button" onClick={() => verifyPerformer(user)}>
                <CheckCircle2 size={18} />
                Проверен
              </button>
              <button className="secondary-button" type="button" onClick={() => markPerformerNotVerified(user)}>
                Не проверен
              </button>
              <div>
                {(user.performerDocuments ?? []).map((document) => (
                  <div className="trust-row" key={document.id}>
                    <span>{document.type === "self_employed" ? "Самозанятость" : "Справка"}</span>
                    <StatusBadge tone={statusTone(document.status)}>{labelStatus(document.status)}</StatusBadge>
                    <button className="secondary-button" type="button" onClick={() => updateDocumentStatus(document.id, "verified")}>
                      Подтвердить
                    </button>
                    <button className="secondary-button" type="button" onClick={() => updateDocumentStatus(document.id, "rejected")}>
                      Отклонить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "Заявки" && (
        <section className="plain-section">
          <div className="section-actions">
            <button className="secondary-button" type="button" onClick={exportRequests}>
              <Download size={18} />
              Экспорт заявок в Excel
            </button>
          </div>
          <div className="data-table">
            {requests.map((request) => (
              <div className="data-row" key={request.id}>
                <button className="link-button" type="button" onClick={() => setSelectedRequest(request)}>
                  <strong>{requestDisplayTitle(request)}</strong>
                </button>
                <span>{request.city?.name}</span>
                <span>{request.category?.name}</span>
                <StatusBadge tone={statusTone(request.status)}>{labelStatus(request.status)}</StatusBadge>
                <span>{requestAgreedTerms(request) ? "Согласовано" : "Рекомендовано"}: {requestAgreedTerms(request)?.agreedHelperAmount ?? request.priceEstimateAmount ?? request.budgetAmount ?? 0} ₽</span>
                <span className="right-note">Заказчик: {(request as any).client?.displayName ?? "не указан"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === "Отклики" && (
        <section className="plain-section">
          <div className="section-actions">
            <button className="secondary-button" type="button" onClick={exportResponses}>
              <Download size={18} />
              Экспорт откликов в Excel
            </button>
          </div>
          <div className="data-table">
            {requests.flatMap((request) =>
              (request.responses ?? []).map((response: any) => (
                <div className="data-row" key={response.id}>
                  <strong>{request.publicNumber ?? "без номера"}</strong>
                  <span>{(request as any).client?.displayName ?? "Заказчик"}</span>
                  <span>{response.performer?.displayName ?? "Помощник"}</span>
                  <span>{request.category?.name}</span>
                  <StatusBadge tone={statusTone(response.status)}>{labelStatus(response.status)}</StatusBadge>
                  <button className="secondary-button" type="button" onClick={() => setSelectedMatch({ request, response })}>
                    Подбор
                  </button>
                  {request.chat?.id && (
                    <button className="secondary-button" type="button" onClick={() => openChat(request.chat!.id)}>
                      Открыть чат
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {activeTab === "Чаты" && (
        <ServiceCommunicationsPage canBroadcast requestChats={<div className="admin-chat-layout">
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
                onClick={() => navigate(chatPathForRole("admin", chat.id))}
              >
                <strong>{chat.request?.publicNumber ?? "без номера"}</strong>
                <span>{chat.client.displayName} → {chat.performer.displayName}</span>
                <small>{labelStatus(chat.status)} · {chat.messages?.filter((message: any) => message.moderationStatus !== "clean").length ?? 0} флагов</small>
              </button>
            ))}
          </aside>
          {activeChatId ? <ChatPanel chatId={activeChatId} /> : <EmptyState title="Выберите чат из списка." />}
        </div>} />
      )}

      {activeTab === "Обращения" && (
        <div className="data-table">
          {complaints.map((complaint) => (
            <div className="data-row" key={complaint.id}>
              <strong>{complaint.reason}</strong>
              <span>{complaint.request?.publicNumber ?? "без заявки"}</span>
              <span>{complaint.fromUser?.displayName}</span>
              <span>{complaint.againstUser?.displayName ?? "не указан"}</span>
              <StatusBadge tone={statusTone(complaint.status)}>{labelStatus(complaint.status)}</StatusBadge>
              {complaint.chat?.id && (
                <button className="secondary-button" type="button" onClick={() => openChat(complaint.chat.id)}>
                  Перейти в чат
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === "Балансы" && (
        <div className="list admin-balances-page">
          <section className="plain-section">
            <div className="card__head">
              <div>
                <h2>Балансы пользователей</h2>
                <p className="privacy-note">Корректировка баланса доступна только для Заказчиков и Помощников. Для администраторов, супер-администраторов и менеджеров баланс не используется.</p>
              </div>
            </div>
            <div className="form-grid admin-balance-user-picker">
              <label>
                Найти пользователя
                <input value={balanceUserSearch} onChange={(event) => setBalanceUserSearch(event.target.value)} placeholder="Имя, телефон, email или город" />
              </label>
              <label>
                Выбрать пользователя
                <select value={selectedBalanceUserId} onChange={(event) => {
                  setSelectedBalanceUserId(event.target.value);
                  setBalanceAdjustmentForm(createBalanceAdjustmentDraft());
                  setBalanceAdjustmentError("");
                }}>
                  <option value="">Не выбран</option>
                  {filteredBalanceUsers.map((user) => <option key={user.id} value={user.id}>{user.displayName} — {userRoleLabel(user.role)}</option>)}
                </select>
              </label>
            </div>
          </section>
          {selectedBalanceUser && (
            <BalanceAdjustmentPanel
              user={selectedBalanceUser}
              transactions={transactions.filter((transaction) => transaction.userId === selectedBalanceUser.id).slice(0, 20)}
              form={balanceAdjustmentForm}
              error={balanceAdjustmentError}
              isSubmitting={isAdjustingBalance}
              onChange={setBalanceAdjustmentForm}
              onSubmit={() => void submitBalanceAdjustment(selectedBalanceUser)}
            />
          )}
          <div className="data-table">
          {filteredBalanceUsers.map((user) => (
            <div className="balance-group" key={user.id}>
              <button className="data-row data-row--button" type="button" onClick={() => setExpandedBalanceUserId(expandedBalanceUserId === user.id ? null : user.id)}>
                <strong>{user.displayName}</strong>
                  <span>{userRoleLabel(user.role)}</span>
                <span>Основной: {user.balance} ₽</span>
                <span>Бонусный: {user.bonusBalance} ₽</span>
                <strong>Всего: {user.balance + user.bonusBalance} ₽</strong>
              </button>
              {expandedBalanceUserId === user.id && (
                <div className="transaction-list">
                  {transactions.filter((transaction: any) => transaction.user?.id === user.id).map((transaction: any) => (
                    <div className="transaction-row" key={transaction.id}>
                      <span>{formatDateTimeRu(transaction.createdAt)}</span>
                      <span>{labelStatus(transaction.type)}</span>
                      <strong>{transaction.amount} ₽</strong>
                      <span>{transaction.balanceKind === "bonus" ? "Бонусный" : "Основной"}</span>
                      <small>{transaction.reason}</small>
                    </div>
                  ))}
                  {transactions.filter((transaction: any) => transaction.user?.id === user.id).length === 0 && (
                    <p className="empty-text">Операций пока нет.</p>
                  )}
                </div>
              )}
            </div>
          ))}
          {filteredBalanceUsers.length === 0 && <p className="empty-text">Подходящие Заказчики и Помощники не найдены.</p>}
          </div>
        </div>
      )}

      {activeTab === "Платежи" && <AdminPaymentsPage />}

      {activeTab === "Мой налог" && <AdminNpdRegisterPage />}

      {activeTab === "Блокировки" && (
        <UsersTable
          users={users.filter((user) => ["blocked", "pending_archive"].includes(user.status))}
          onBlock={block}
          onUnblock={unblock}
          onRequestArchive={requestArchive}
          onArchive={archiveUser}
          onCancelPending={cancelPendingOAuthRegistration}
          onSelect={openUserProfile}
        />
      )}

      {activeTab === "Структуры категорий" && <AdminCategoryStructuresPage />}

      {activeTab === "Архив" && (
        <section className="plain-section">
          <h2>Архив</h2>
          <p>Архив скрывает старые данные из активной работы, но не удаляет историю.</p>
          <button className="primary-button" type="button" onClick={async () => {
            const result = await api.adminRunArchive(30);
            setNotice(`В архив перенесено пользователей: ${result.archivedUsers}, заявок: ${result.archivedRequests}.`);
            await load();
          }}>
            <Archive size={18} />
            Запустить архивирование
          </button>
          <UsersTable users={archivedUsers} onBlock={block} onUnblock={unblock} onRequestArchive={requestArchive} onArchive={archiveUser} onCancelPending={cancelPendingOAuthRegistration} onSelect={openUserProfile} />
        </section>
      )}

      {activeTab === "Настройки сервиса" && (
        <section className="plain-section">
          <h2>Настройки сервиса</h2>
          <section className="trial-balance-settings">
            <h3>Сервисный сбор</h3>
            <div className="data-table">
              <div className="data-row"><strong>Заказчик</strong><span>50 ₽</span></div>
              <div className="data-row"><strong>Помощник</strong><span>50 ₽</span></div>
            </div>
            <p>Изменение сервисного сбора временно недоступно.</p>
          </section>
          <section className="trial-balance-settings">
            <h3>Пробный период</h3>
            <p>
              Пробный баланс помогает новым пользователям познакомиться с сервисом без первого пополнения. Начисление выполняется один раз на пользователя.
            </p>
            <div className="data-table">
              <div className="data-row">
                <strong>Пробный период включён</strong>
                <div className="boolean-toggle" role="group" aria-label="Пробный период включён">
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      className={trialBalanceSettings.enabled === value ? "choice choice--active" : "choice"}
                      onClick={() => setTrialBalanceSettings((current) => ({ ...current, enabled: value }))}
                    >
                      {value ? "Да" : "Нет"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="data-row">
                <strong>Сумма пробного баланса</strong>
                <span>100 ₽</span>
              </div>
              <div className="data-row">
                <strong>Начислять новым пользователям</strong>
                <div className="boolean-toggle" role="group" aria-label="Начислять новым пользователям">
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      className={trialBalanceSettings.autoGrantNewUsers === value ? "choice choice--active" : "choice"}
                      onClick={() => setTrialBalanceSettings((current) => ({ ...current, autoGrantNewUsers: value }))}
                    >
                      {value ? "Да" : "Нет"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p>
              Пользователей: {trialBalanceSettings.totals.totalUsers}. Уже получили: {trialBalanceSettings.totals.usersWithTrialBonus}. Подходят для начисления: {trialBalanceSettings.totals.eligibleUsers}.
            </p>
            {trialBalanceSettings.lastBulkGrantAt && (
              <p>Последнее массовое начисление: {formatDateTimeRu(trialBalanceSettings.lastBulkGrantAt)}</p>
            )}
            <div className="button-row">
              <button className="primary-button" type="button" onClick={saveTrialBalanceSettings}>
                Сохранить настройки
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!trialBalanceSettings.enabled}
                onClick={grantTrialBalanceToAll}
              >
                <Coins size={18} />
                Начислить 100 ₽ всем подходящим пользователям
              </button>
            </div>
          </section>
          <div className="data-table">
            {settings.filter((setting: any) => !hiddenLegacySettingKeys.has(setting.key)).map((setting: any) => (
              <div className="data-row" key={setting.key}>
                <strong>{setting.label}</strong>
                <span>{setting.group}</span>
                {parseSettingBoolean(settingDrafts[setting.key] ?? setting.valueJson) === null ? (
                  <input
                    value={settingDrafts[setting.key] ?? setting.valueJson}
                    onChange={(event) => updateSettingDraft(setting.key, event.target.value)}
                  />
                ) : (
                  <div className="boolean-toggle" role="group" aria-label={setting.label}>
                    {[true, false].map((value) => (
                      <button
                        key={String(value)}
                        type="button"
                        className={parseSettingBoolean(settingDrafts[setting.key] ?? setting.valueJson) === value ? "choice choice--active" : "choice"}
                        onClick={() => updateSettingDraft(setting.key, JSON.stringify(value))}
                      >
                        {value ? "Да" : "Нет"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={saveSettings}>
            Сохранить настройки
          </button>
          <p>Ключ Яндекс.Карт передаётся через переменную окружения, точные адреса до принятия заявки скрываются API.</p>
        </section>
      )}

      {activeTab === "База знаний" && (
        <div className="list">
          {sortedKnowledge.map((article) => (
            <article className="card" key={article.id}>
              <p className="eyebrow">{article.category} · {article.audience}</p>
              <div className="knowledge-title-row">
                <h3>{article.title}</h3>
                <StatusBadge tone={article.isPublished ? "success" : "neutral"}>
                  {article.isPublished ? "Опубликована" : "Снята с публикации"}
                </StatusBadge>
              </div>
              <p>{article.content}</p>
              <div className="trust-row">
                <button className="secondary-button" type="button" onClick={() => setEditingArticle(article)}>Редактировать</button>
                <button className="secondary-button" type="button" onClick={() => toggleKnowledgeArticle(article)}>
                  {article.isPublished ? "Снять с публикации" : "Опубликовать"}
                </button>
                <button className="secondary-button" type="button" onClick={() => setOrderingArticleId(orderingArticleId === article.id ? null : article.id)}>
                  Изменить порядок
                </button>
              </div>
              {orderingArticleId === article.id && (
                <label>
                  Позиция в списке
                  <select value={Math.max(1, Math.ceil(article.sortOrder / 10))} onChange={(event) => updateKnowledgeOrder(article, Number(event.target.value))}>
                    {sortedKnowledge.map((_, index) => (
                      <option key={index + 1} value={index + 1}>{index + 1}</option>
                    ))}
                  </select>
                </label>
              )}
            </article>
          ))}
          <button className="secondary-button" type="button">
            <BookOpen size={18} />
            Создание и редактирование статей подключено через API
          </button>
        </div>
      )}

      {activeTab === "Юридические документы" && (
        <LegalAdminSection
          documents={legalDocuments}
          consents={legalConsents}
          exportLogs={legalExportLogs}
          onExportAll={exportAllConsents}
          onExportArchive={exportLegalArchive}
          onCreateVersion={createLegalDocumentVersion}
          onPublish={publishLegal}
          onArchive={archiveLegal}
        />
      )}

      {selectedUser && (
        <Modal title={`Профиль пользователя: ${selectedUser.displayName}`} onClose={() => setSelectedUser(null)}>
          <UserProfile user={selectedUser} legalStatuses={selectedUserLegalStatuses} archiveSafety={selectedUserArchiveSafety} />
          <UserServiceCommunicationPanel userId={selectedUser.id} />
          {isArchivedIncompleteVkRegistration(selectedUser) && selectedOAuthRestoreSafety && (
            <section className="plain-section">
              <h3>Незавершённая VK-регистрация</h3>
              {selectedOAuthRestoreSafety.canRestore ? (
                <p>Этот профиль был создан при входе через VK, но регистрация не была завершена. Его можно восстановить, чтобы пользователь снова прошёл заполнение анкеты.</p>
              ) : (
                <>
                  <p>Этот архивный профиль нельзя восстановить как незавершённую регистрацию.</p>
                  <ul>{selectedOAuthRestoreSafety.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </>
              )}
            </section>
          )}
          {balanceUserRoles.has(selectedUser.role) ? (
            <BalanceAdjustmentPanel
              user={selectedUser}
              transactions={transactions.filter((transaction) => transaction.userId === selectedUser.id).slice(0, 20)}
              form={balanceAdjustmentForm}
              error={balanceAdjustmentError}
              isSubmitting={isAdjustingBalance}
              onChange={setBalanceAdjustmentForm}
              onSubmit={() => void submitBalanceAdjustment(selectedUser)}
            />
          ) : (
            <p className="notice service-role-balance-note">Баланс не применяется к служебной роли.</p>
          )}
          <div className="admin-user-actions">
            {selectedUser.status === "active" && ["client", "performer"].includes(selectedUser.role) && (
              <button className="primary-button" type="button" onClick={() => assignManager(selectedUser)}>
                Назначить менеджером
              </button>
            )}
            {selectedUser.role === "manager" && (
              <button className="secondary-button" type="button" onClick={() => revokeManager(selectedUser)}>
                Снять роль менеджера
              </button>
            )}
            <button className="secondary-button" type="button" onClick={() => exportUserConsents(selectedUser)}>
              <Download size={18} />
              Скачать согласия пользователя Excel
            </button>
            <button className="secondary-button" type="button" onClick={() => exportUserLegalArchive(selectedUser)}>
              <Archive size={18} />
              Скачать полный legal-архив пользователя ZIP
            </button>
            {selectedUser.status !== "archived" && selectedUser.status !== "pending_archive" && !selectedUserArchiveSafety?.canArchive && (
              <button className="secondary-button" type="button" onClick={() => requestArchive(selectedUser)}>
                <Archive size={18} />
                Запланировать архивирование
              </button>
            )}
            {selectedUser.status !== "archived" && selectedUserArchiveSafety?.canArchive && (
              <button className="secondary-button" type="button" onClick={() => archiveUser(selectedUser)}>
                <Archive size={18} />
                Архивировать пользователя
              </button>
            )}
            {isIncompleteVkRegistration(selectedUser) && (
              <button className="secondary-button" type="button" onClick={() => cancelPendingOAuthRegistration(selectedUser)}>
                <Archive size={18} />
                Отменить незавершённую регистрацию
              </button>
            )}
            {isArchivedIncompleteVkRegistration(selectedUser) && selectedOAuthRestoreSafety?.canRestore && (
              <button className="secondary-button" type="button" onClick={() => restorePendingOAuthRegistration(selectedUser)}>
                <RefreshCcw size={18} />
                Восстановить незавершённую регистрацию
              </button>
            )}
          </div>
        </Modal>
      )}

      {selectedRequest && (
        <Modal title={`Заявка ${selectedRequest.publicNumber ?? ""}`} onClose={() => setSelectedRequest(null)}>
          <RequestDetails request={selectedRequest} />
        </Modal>
      )}

      {selectedMatch && (
        <Modal title={`Подбор по заявке ${selectedMatch.request.publicNumber ?? ""}`} onClose={() => setSelectedMatch(null)}>
          <MatchDetails request={selectedMatch.request} response={selectedMatch.response} />
        </Modal>
      )}

      {editingArticle && (
        <Modal title="Редактировать статью базы знаний" onClose={() => setEditingArticle(null)}>
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            saveKnowledgeArticle(editingArticle);
          }}>
            <label>
              Заголовок
              <input value={editingArticle.title} onChange={(event) => setEditingArticle({ ...editingArticle, title: event.target.value })} />
            </label>
            <label>
              Раздел
              <input value={editingArticle.category} onChange={(event) => setEditingArticle({ ...editingArticle, category: event.target.value })} />
            </label>
            <label>
              Аудитория
              <select value={editingArticle.audience} onChange={(event) => setEditingArticle({ ...editingArticle, audience: event.target.value })}>
                <option value="all">Все</option>
                <option value="client">Заказчики</option>
                <option value="performer">Помощники</option>
              </select>
            </label>
            <label>
              Публикация
              <select value={editingArticle.isPublished ? "true" : "false"} onChange={(event) => setEditingArticle({ ...editingArticle, isPublished: event.target.value === "true" })}>
                <option value="true">Опубликована</option>
                <option value="false">Снята с публикации</option>
              </select>
            </label>
            <label className="span-2">
              Текст
              <textarea value={editingArticle.content} onChange={(event) => setEditingArticle({ ...editingArticle, content: event.target.value })} />
            </label>
            <button className="primary-button span-2" type="submit">Сохранить статью</button>
          </form>
        </Modal>
      )}
    </Shell>
  );
}

function CityDataBlock({ title, emptyText, hasRows, children }: { title: string; emptyText: string; hasRows: boolean; children: ReactNode }) {
  return (
    <article className="card">
      <div className="card__head">
        <h3>{title}</h3>
      </div>
      {hasRows ? <div className="data-table data-table--wide">{children}</div> : <p className="empty-text">{emptyText}</p>}
    </article>
  );
}

function LegalAdminSection({
  documents,
  consents,
  exportLogs,
  onExportAll,
  onExportArchive,
  onCreateVersion,
  onPublish,
  onArchive
}: {
  documents: LegalDocument[];
  consents: UserConsent[];
  exportLogs: any[];
  onExportAll: () => void;
  onExportArchive: () => void;
  onCreateVersion: (document: LegalDocument) => void;
  onPublish: (document: LegalDocument) => void;
  onArchive: (document: LegalDocument) => void;
}) {
  const [tab, setTab] = useState<"documents" | "consents" | "exports">("documents");
  const [filters, setFilters] = useState({
    user: "",
    role: "",
    documentType: "",
    status: "",
    missingRequired: false
  });
  const filteredConsents = consents.filter((consent: any) => {
    const userText = `${consent.user?.displayName ?? ""} ${consent.user?.email ?? ""} ${consent.user?.phone ?? ""}`.toLowerCase();
    if (filters.user && !userText.includes(filters.user.toLowerCase())) return false;
    if (filters.role && consent.user?.role !== filters.role) return false;
    if (filters.documentType && consent.documentType !== filters.documentType) return false;
    if (filters.status === "accepted" && (!consent.isActive || consent.revokedAt)) return false;
    if (filters.status === "revoked" && !consent.revokedAt) return false;
    if (filters.missingRequired) return false;
    return true;
  });
  const documentTypes = Array.from(new Set(documents.map((document) => document.type)));

  return (
    <div className="list">
      <section className="plain-section">
        <div className="card__head">
          <div>
            <p className="eyebrow">Юридический контур</p>
            <h2>Юридические документы</h2>
          </div>
        </div>
        <div className="tabs">
          <button className={tab === "documents" ? "primary-button" : "secondary-button"} type="button" onClick={() => setTab("documents")}>Документы</button>
          <button className={tab === "consents" ? "primary-button" : "secondary-button"} type="button" onClick={() => setTab("consents")}>Согласия пользователей</button>
          <button className={tab === "exports" ? "primary-button" : "secondary-button"} type="button" onClick={() => setTab("exports")}>Выгрузки</button>
        </div>
        <p className="privacy-note">
          Опубликованный документ нельзя редактировать напрямую. Для изменения создайте новую версию, проверьте текст и опубликуйте её.
        </p>
      </section>

      {tab === "documents" && (
      <section className="plain-section">
        <div className="data-table data-table--wide">
          <div className="data-row data-row--header">
            <span>Название</span><span>Тип</span><span>Для кого</span><span>Версия</span><span>Обязательный</span><span>Опубликован</span><span>Активен</span><span>Дата публикации</span><span>Действия</span>
          </div>
          {documents.map((document) => (
            <div className="data-row" key={document.id}>
              <strong>{document.title}</strong>
              <span>{document.type}</span>
              <span>{legalScopeLabel(document.roleScope)}</span>
              <span>{document.version}</span>
              <span>{document.isRequired ? "Да" : "Нет"}</span>
              <span>{document.isPublished ? "Да" : "Нет"}</span>
              <span>{document.isActive ? "Да" : "Нет"}</span>
              <span>{document.publishedAt ? formatDateRu(document.publishedAt) : "не опубликован"}</span>
              <span className="trust-row">
                <a className="secondary-button" href={`/legal/${document.slug}`} target="_blank" rel="noreferrer">
                  Открыть
                </a>
                <button className="secondary-button" type="button" onClick={() => onCreateVersion(document)}>
                  Создать новую версию
                </button>
                <button className="secondary-button" type="button" onClick={() => {
                  setFilters((current) => ({ ...current, documentType: document.type }));
                  setTab("consents");
                }}>
                  Посмотреть принявших
                </button>
                {!document.isPublished && (
                  <button className="secondary-button" type="button" onClick={() => onPublish(document)}>
                    Опубликовать
                  </button>
                )}
                {document.isActive && (
                  <button className="secondary-button" type="button" onClick={() => onArchive(document)}>
                    Архивировать
                  </button>
                )}
              </span>
            </div>
          ))}
          {documents.length === 0 && <p className="empty-text">Юридические документы пока не созданы.</p>}
        </div>
      </section>
      )}

      {tab === "consents" && (
      <section className="plain-section">
        <h2>Согласия пользователей</h2>
        <p className="privacy-note">Здесь хранится доказательная запись: документ, версия, hash текста, дата принятия, IP, user agent и источник.</p>
        <div className="filter-panel">
          <label>
            Пользователь
            <input value={filters.user} onChange={(event) => setFilters({ ...filters, user: event.target.value })} placeholder="Имя, email или телефон" />
          </label>
          <label>
            Роль
            <select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
              <option value="">Все роли</option>
              <option value="client">Заказчик</option>
              <option value="performer">Помощник</option>
              <option value="admin">Администратор</option>
              <option value="superadmin">Владелец</option>
            </select>
          </label>
          <label>
            Тип документа
            <select value={filters.documentType} onChange={(event) => setFilters({ ...filters, documentType: event.target.value })}>
              <option value="">Все типы</option>
              {documentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            Статус
            <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">Все статусы</option>
              <option value="accepted">Принято</option>
              <option value="revoked">Отозвано</option>
            </select>
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={filters.missingRequired} onChange={(event) => setFilters({ ...filters, missingRequired: event.target.checked })} />
            Отсутствует обязательное согласие
          </label>
        </div>
        <div className="data-table data-table--wide legal-consent-overview">
          <div className="data-row data-row--header">
            <span>Пользователь</span><span>Роль</span><span>Документ</span><span>Версия</span><span>Статус</span><span>Дата принятия</span><span>IP</span><span>Источник</span>
          </div>
          {filteredConsents.slice(0, 100).map((consent: any) => (
            <div className="data-row legal-consent-row" key={consent.id}>
              <strong data-label="Пользователь">{consent.user?.displayName ?? consent.userId}</strong>
              <span data-label="Роль">{userRoleLabel(consent.user?.role ?? "")}</span>
              <span data-label="Документ">{consent.documentTitle}</span>
              <span data-label="Версия">{consent.documentVersion}</span>
              <span data-label="Статус"><StatusBadge tone={consent.revokedAt ? "neutral" : "success"}>{consent.revokedAt ? "Отозвано" : "Принято"}</StatusBadge></span>
              <span data-label="Дата принятия">{formatDateTimeRu(consent.acceptedAt)}</span>
              <span data-label="IP">{consent.ipAddress ?? "не записан"}</span>
              <span data-label="Источник">{consent.source}</span>
            </div>
          ))}
          {filteredConsents.length === 0 && <p className="empty-text">{filters.missingRequired ? "Проверка отсутствующих обязательных согласий доступна в выгрузке всех согласий." : "Согласий пока нет."}</p>}
        </div>
      </section>
      )}

      {tab === "exports" && (
      <section className="plain-section">
        <div className="card__head">
          <h2>Выгрузки</h2>
          <div className="trust-row">
            <button className="secondary-button" type="button" onClick={onExportAll}>
              <Download size={18} />
              Экспорт всех согласий в Excel
            </button>
            <button className="secondary-button" type="button" onClick={onExportArchive}>
              <Archive size={18} />
              Скачать полный legal-архив ZIP
            </button>
          </div>
        </div>
        <h3>Журнал последних выгрузок</h3>
        <div className="data-table data-table--wide">
          <div className="data-row data-row--header">
            <span>Дата</span><span>Тип</span><span>Файл</span><span>Пользователь</span><span>Комментарий</span>
          </div>
          {exportLogs.map((log: any) => (
            <div className="data-row" key={log.id}>
              <span>{formatDateTimeRu(log.exportedAt)}</span>
              <span>{log.exportType}</span>
              <strong>{log.fileName}</strong>
              <span>{log.userId ?? "все пользователи"}</span>
              <span>{log.comment ?? ""}</span>
            </div>
          ))}
          {exportLogs.length === 0 && <p className="empty-text">Выгрузок пока нет.</p>}
        </div>
      </section>
      )}
    </div>
  );
}

function UsersTable({
  users,
  onBlock,
  onUnblock,
  onRequestArchive,
  onArchive,
  onCancelPending,
  onSelect
}: {
  users: User[];
  onBlock: (userId: string) => void;
  onUnblock: (userId: string) => void;
  onRequestArchive: (user: User) => void;
  onArchive: (user: User) => void;
  onCancelPending: (user: User) => void;
  onSelect: (user: User) => void;
}) {
  return (
    <ResponsiveDataList>
      {users.map((user) => (
        <div className="data-row" key={user.id}>
          <button className="link-button" type="button" onClick={() => onSelect(user)}>
            <strong>{user.displayName}</strong>
          </button>
          <span>{userRoleLabel(user.role)}</span>
          <span>{user.city?.name ?? "город не выбран"}</span>
          <span>{balanceUserRoles.has(user.role) ? `${user.balance + user.bonusBalance} ₽` : "Баланс не применяется"}</span>
          <StatusBadge tone={isIncompleteVkRegistration(user) ? "warning" : statusTone(user.status)}>
            {isIncompleteVkRegistration(user) ? "Незавершённая VK-регистрация" : labelStatus(user.status)}
          </StatusBadge>
          {isIncompleteVkRegistration(user) ? (
            <button className="secondary-button" type="button" onClick={() => onCancelPending(user)}>
              Отменить незавершённую регистрацию
            </button>
          ) : ["blocked", "pending_archive"].includes(user.status) ? (
            <button className="secondary-button" type="button" onClick={() => onUnblock(user.id)}>
              Разблокировать
            </button>
          ) : user.status !== "archived" ? (
            <button className="secondary-button" type="button" onClick={() => onBlock(user.id)}>
              <Ban size={18} />
              Заблокировать
            </button>
          ) : null}
          {!isIncompleteVkRegistration(user) && user.status === "pending_archive" ? (
            <button className="secondary-button" type="button" onClick={() => onArchive(user)}>
              <Archive size={18} />
              Архивировать пользователя
            </button>
          ) : !isIncompleteVkRegistration(user) && user.status !== "archived" ? (
            <button className="secondary-button" type="button" onClick={() => onRequestArchive(user)}>
              <Archive size={18} />
              Запланировать архивирование
            </button>
          ) : null}
        </div>
      ))}
    </ResponsiveDataList>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" data-modal-backdrop onClick={onClose}>
      <section className="modal-panel" data-modal-content onClick={(event) => event.stopPropagation()}>
        <div className="card__head">
          <h2>{title}</h2>
          <button className="secondary-button" type="button" onClick={onClose}>Закрыть</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function BalanceAdjustmentPanel({
  user,
  transactions,
  form,
  error,
  isSubmitting,
  onChange,
  onSubmit
}: {
  user: User;
  transactions: AdminBalanceTransaction[];
  form: AdminBalanceAdjustmentInput;
  error: string;
  isSubmitting: boolean;
  onChange: (form: AdminBalanceAdjustmentInput) => void;
  onSubmit: () => void;
}) {
  const canAdjust = user.status !== "archived" && ["client", "performer"].includes(user.role);
  const invalid = !Number.isSafeInteger(form.amount) || form.amount <= 0 || form.amount > 100_000 || form.comment.trim().length < 10;
  return (
    <section className="plain-section admin-balance-adjustment">
      <div className="card__head">
        <div>
          <p className="eyebrow">Финансовая история</p>
          <h3>Корректировка баланса</h3>
        </div>
      </div>
      <div className="panel-grid panel-grid--compact">
        <div className="metric"><span>Основной баланс</span><strong>{user.balance} ₽</strong></div>
        <div className="metric"><span>Бонусный баланс</span><strong>{user.bonusBalance} ₽</strong></div>
        <div className="metric"><span>Доступно для заявок</span><strong>{user.balance + user.bonusBalance} ₽</strong></div>
      </div>
      {canAdjust ? (
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
          <label>
            Кошелёк
            <select value={form.wallet} onChange={(event) => onChange({ ...form, wallet: event.target.value as AdminBalanceAdjustmentInput["wallet"] })}>
              <option value="main">Основной баланс</option>
              <option value="bonus">Бонусный баланс</option>
            </select>
          </label>
          <label>
            Действие
            <select value={form.direction} onChange={(event) => onChange({ ...form, direction: event.target.value as AdminBalanceAdjustmentInput["direction"] })}>
              <option value="credit">Начислить</option>
              <option value="debit">Списать</option>
            </select>
          </label>
          <label>
            Сумма, ₽
            <input type="number" min={1} max={100_000} step={1} value={form.amount} onChange={(event) => onChange({ ...form, amount: Number(event.target.value) })} />
          </label>
          <label>
            Причина
            <select value={form.reason} onChange={(event) => onChange({ ...form, reason: event.target.value as AdminBalanceAdjustmentInput["reason"] })}>
              {Object.entries(balanceAdjustmentReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="span-2">
            Комментарий администратора
            <textarea minLength={10} maxLength={1000} value={form.comment} onChange={(event) => onChange({ ...form, comment: event.target.value })} />
            <small>Минимум 10 символов. Комментарий сохраняется в истории и журнале аудита.</small>
          </label>
          {error && <p className="error-text span-2">{error}</p>}
          <button className="primary-button span-2" type="submit" disabled={isSubmitting || invalid}>
            {isSubmitting ? "Проводим корректировку" : "Провести корректировку"}
          </button>
        </form>
      ) : (
        <p className="notice">
          {user.status === "archived"
            ? "Архивному пользователю нельзя корректировать баланс."
            : "Корректировка доступна только для профилей Заказчика и Помощника."}
        </p>
      )}
      <div className="admin-balance-history">
        <h3>Последние операции баланса</h3>
        {transactions.map((transaction) => {
          const metadata = parseAdjustmentMetadata(transaction.metadataJson);
          return (
            <div className="transaction-row" key={transaction.id}>
              <span>{formatDateTimeRu(transaction.createdAt)}</span>
              <strong>{balanceTransactionTypeLabel(transaction.type)}</strong>
              <span>{transaction.amount > 0 ? "+" : ""}{transaction.amount} ₽</span>
              <span>Основной: {metadata?.balanceBefore ?? (transaction.balanceKind === "real" ? transaction.balanceBefore : "—")} → {metadata?.balanceAfter ?? (transaction.balanceKind === "real" ? transaction.balanceAfter : "—")} ₽</span>
              <span>Бонусный: {metadata?.bonusBalanceBefore ?? (transaction.balanceKind === "bonus" ? transaction.balanceBefore : "—")} → {metadata?.bonusBalanceAfter ?? (transaction.balanceKind === "bonus" ? transaction.balanceAfter : "—")} ₽</span>
              <small>{balanceAdjustmentReasonLabels[transaction.reason] ?? transaction.reason}{transaction.comment ? `: ${transaction.comment}` : ""}</small>
              <small>Выполнил: {transaction.createdByAdmin?.displayName ?? "система"}</small>
            </div>
          );
        })}
        {transactions.length === 0 && <p className="empty-text">Операций пока нет.</p>}
      </div>
    </section>
  );
}

const balanceAdjustmentReasonLabels: Record<string, string> = {
  payment_issue: "Ошибка платежа",
  goodwill_bonus: "Компенсация / бонус",
  manual_correction: "Ручная корректировка",
  refund: "Возврат",
  penalty_reversal: "Отмена ошибочного списания",
  other: "Другое"
};

function createBalanceAdjustmentDraft(): AdminBalanceAdjustmentInput {
  return {
    wallet: "main",
    direction: "credit",
    amount: 150,
    reason: "manual_correction",
    comment: "",
    clientRequestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  };
}

function parseAdjustmentMetadata(value?: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as {
      balanceBefore?: number;
      balanceAfter?: number;
      bonusBalanceBefore?: number;
      bonusBalanceAfter?: number;
    };
  } catch {
    return null;
  }
}

function balanceTransactionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    admin_balance_credit: "Начисление основного баланса администратором",
    admin_balance_debit: "Списание основного баланса администратором",
    admin_bonus_credit: "Начисление бонусного баланса администратором",
    admin_bonus_debit: "Списание бонусного баланса администратором"
  };
  return labels[type] ?? labelStatus(type);
}

function ProfileRow({ label, value, testId }: { label: string; value: ReactNode; testId?: "role" | "phone" | "email" }) {
  return (
    <div className="detail-grid__row" data-profile-field={testId}>
      <span>{label}</span>
      <strong data-contact-field={testId === "phone" || testId === "email" ? testId : undefined}>{value}</strong>
    </div>
  );
}

function UserProfile({ user, legalStatuses, archiveSafety }: { user: User; legalStatuses: UserConsentStatus[]; archiveSafety: UserArchiveSafety | null }) {
  return (
    <div className="list">
      {isIncompleteVkRegistration(user) && (
        <p className="notice">
          <strong>Незавершённая VK-регистрация.</strong> Вход через VK начат, профиль не завершён.
        </p>
      )}
      <div className="detail-grid user-profile-details">
        <div className="detail-grid__full"><h3>Роль и доступ</h3></div>
        <ProfileRow label="Роль" value={userRoleLabel(user.role)} testId="role" />
        <ProfileRow label="Предыдущая роль" value={user.roleBeforeManager ? userRoleLabel(user.roleBeforeManager) : "не указана"} />
        <ProfileRow label="Назначен менеджером" value={user.managerAssignedAt ? `да, ${formatDateTimeRu(user.managerAssignedAt)}` : "нет"} />
        <ProfileRow label="Кем назначен" value={user.managerAssignedByAdminId ?? "не указано"} />
        <ProfileRow label="Телефон" value={user.phone?.trim() || "не указан"} testId="phone" />
        <ProfileRow label="Email" value={user.email?.trim() || "не указан"} testId="email" />
        <ProfileRow label="Город" value={user.city?.name ?? "не выбран"} />
        <ProfileRow label="Статус" value={labelStatus(user.status)} />
        {balanceUserRoles.has(user.role) && <>
          <ProfileRow label="Основной баланс" value={`${user.balance} ₽`} />
          <ProfileRow label="Бонусный баланс" value={`${user.bonusBalance} ₽`} />
        </>}
        {!balanceUserRoles.has(user.role) && <ProfileRow label="Баланс" value="Не применяется к служебной роли" />}
        <ProfileRow label="Заблокирован" value={user.blockedAt ? `да, ${formatDateTimeRu(user.blockedAt)}` : "нет"} />
        <ProfileRow label="Кем заблокирован" value={user.blockedByRole ? userRoleLabel(user.blockedByRole) : "не указано"} />
        <ProfileRow label="Причина блокировки" value={user.blockReason ?? "не указано"} />
        <ProfileRow label="Запланировано архивирование" value={user.archiveRequestedAt ? `да, ${formatDateTimeRu(user.archiveRequestedAt)}` : "нет"} />
        <ProfileRow label="Архивирован" value={user.archivedAt ? `да, ${formatDateTimeRu(user.archivedAt)}` : "нет"} />
        <ProfileRow label="Способ входа" value={user.identities?.some((identity) => identity.provider === "vk") ? "VK" : "Телефон или email"} />
        {user.identities?.filter((identity) => identity.provider === "vk").map((identity) => (
          <ProfileRow key={identity.id} label="VK" value={`${identity.displayName ?? "имя не указано"}; привязан ${formatDateTimeRu(identity.createdAt)}`} />
        ))}
        {user.clientProfile && <>
          <ProfileRow label="Рейтинг заказчика" value={user.clientProfile.rating} />
          <ProfileRow label="Выполненных заявок" value={user.clientProfile.completedRequestsCount} />
        </>}
        {user.performerProfile && <>
          <ProfileRow label="Рейтинг помощника" value={user.performerProfile.rating} />
          <ProfileRow label="Статус профиля" value={labelTrust(user.performerProfile.trustLevel)} />
          <ProfileRow label="Самозанятость" value={labelSelfEmployed(user.performerProfile.selfEmployedStatus)} />
          <ProfileRow label="Справка" value={labelCriminalRecord(user.performerProfile.criminalRecordCertificateStatus)} />
          <ProfileRow label="Услуги" value={formatJsonList(user.performerProfile.services)} />
          <ProfileRow label="Навыки" value={formatJsonList(user.performerProfile.skills)} />
        </>}
      </div>
      {archiveSafety && (
        <section className="plain-section">
          <h3>Проверка архивирования</h3>
          <p>{archiveSafety.canArchive ? "Пользователя можно архивировать." : "Сейчас пользователя нельзя архивировать."}</p>
          {balanceUserRoles.has(user.role) && <p>Основной баланс: {archiveSafety.balance} ₽. Бонусный: {archiveSafety.bonusBalance} ₽.</p>}
          {!archiveSafety.canArchive && <p className="privacy-note">Пользователь будет архивирован после выполнения условий безопасности: отсутствие активных заявок, открытых платежей, споров и истечение контрольного срока.</p>}
          {archiveSafety.reasons.length > 0 && (
            <ul>{archiveSafety.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          )}
        </section>
      )}
      <section className="plain-section">
        <h3>Юридические согласия</h3>
        <p className="privacy-note">Возможные статусы: Принято, Требуется, Требуется новая версия.</p>
        <div className="data-table legal-consent-table">
          <div className="data-row data-row--header">
            <span>Документ</span><span>Статус</span><span>Обязательный</span><span>Версия</span><span>Дата принятия</span><span>IP</span>
          </div>
          {legalStatuses.map((row) => (
            <div className="data-row legal-consent-row" key={row.document.id}>
              <strong data-label="Документ">{row.document.title}</strong>
              <span data-label="Статус"><StatusBadge tone={row.status === "accepted" ? "success" : row.status === "needs_new_version" ? "warning" : "neutral"}>
                {legalStatusLabel(row.status)}
              </StatusBadge></span>
              <span data-label="Обязательный">{row.document.isRequired ? "Да" : "Нет"}</span>
              <span data-label="Версия">{row.document.version}</span>
              <span data-label="Дата принятия">{row.consent?.acceptedAt ? formatDateTimeRu(row.consent.acceptedAt) : "не принято"}</span>
              <span data-label="IP">{row.consent?.ipAddress ?? "не записан"}</span>
            </div>
          ))}
          {legalStatuses.length === 0 && <p className="empty-text">Юридические согласия загружаются или пока не найдены.</p>}
        </div>
      </section>
    </div>
  );
}

function RequestDetails({ request }: { request: ClientRequest }) {
  const pricing = request.pricing ?? parseJsonObject(request.pricingBreakdownJson);
  const agreedTerms = request.chat?.agreedTerms ?? null;
  const categorySnapshot = request.categorySnapshot?.snapshot;
  const builtPublicAddress = buildPublicAddressFromRequest(request);
  const publicMapAddress = request.yandexPublicMapAddress || builtPublicAddress || request.publicAddress || "";
  const exactMapAddress = request.yandexExactMapAddress || buildYandexExactAddressFromRequest(request);
  const publicMapUrl = request.yandexPublicMapUrl || buildYandexMapsSearchUrl(publicMapAddress);
  const exactMapUrl = request.yandexExactMapUrl || buildYandexMapsSearchUrl(exactMapAddress);
  return (
    <div className="list">
      <div className="detail-grid">
        <span>Номер</span><strong>{request.publicNumber ?? "без номера"}</strong>
        <span>Заказчик</span><strong>{(request as any).client?.displayName ?? "не указан"}</strong>
        <span>Город</span><strong>{request.city?.name ?? "не указан"}</strong>
        <span>Категория</span><strong>{request.category?.name ?? "не указана"}</strong>
        <span>Статус</span><strong>{labelStatus(request.status)}</strong>
        <span>Дата и время</span><strong>{request.date ? formatDateRu(request.date) : "не указана"} {formatTimeRu(request.timeFrom)}</strong>
        <span>Длительность</span><strong>{request.expectedDurationHours ?? "не указана"} ч</strong>
        <span>Полный адрес</span><strong>{request.fullAddress ?? request.addressText ?? "не указан"}</strong>
        <span>Публичный адрес</span><strong>{request.publicAddress ?? request.approximateAddressText}</strong>
        <span>Адрес для Яндекс.Карт до согласования</span><strong>{publicMapAddress}</strong>
        <span>Адрес для Яндекс.Карт после перехода в работу</span><strong>{exactMapAddress}</strong>
        <span>Ссылки</span>
        <strong className="button-row">
          {publicMapUrl && <a className="secondary-button" href={publicMapUrl} target="_blank" rel="noreferrer">Открыть на Яндекс.Картах</a>}
          {exactMapUrl && <a className="secondary-button" href={exactMapUrl} target="_blank" rel="noreferrer">Открыть точный адрес на Яндекс.Картах</a>}
        </strong>
        <span>Описание</span><strong>{request.description}</strong>
        <span>Отклики</span><strong>{request.responses?.length ?? 0}</strong>
        {categorySnapshot?.structureTitle && <><span>Применённая структура</span><strong>{categorySnapshot.structureTitle} {categorySnapshot.structureVersion} ({categorySnapshot.fallbackStatus})</strong></>}
        {categorySnapshot?.subcategory?.title && <><span>Задача</span><strong>{categorySnapshot.subcategory.title}</strong></>}
        {categorySnapshot?.frequencyTitle && <><span>Как часто нужна помощь</span><strong>{categorySnapshot.frequencyTitle}</strong></>}
        {categorySnapshot?.additionalTaskSubcategoryTitle && <><span>Дополнительная задача</span><strong>{categorySnapshot.additionalTaskCategoryTitle}: {categorySnapshot.additionalTaskSubcategoryTitle}</strong></>}
        {categorySnapshot?.finalCalculatedRecommendedPrice != null && <><span>Ориентировочная сумма</span><strong>{categorySnapshot.finalCalculatedRecommendedPrice.toLocaleString("ru-RU")} ₽</strong></>}
      </div>
      {agreedTerms
        ? <AgreedTermsSummary terms={agreedTerms} />
        : !categorySnapshot?.calculatedAt && <PriceSummary pricing={pricing} fallbackPayment={request.priceEstimateAmount} role="admin" />}
    </div>
  );
}

function MatchDetails({ request, response }: { request: ClientRequest; response: any }) {
  const performerProfile = response.performer?.performerProfile;
  return (
    <div className="match-grid">
      <table>
        <caption>Данные заявки заказчика</caption>
        <tbody>
          <tr><td>Заказчик</td><td>{(request as any).client?.displayName ?? "не указан"}</td></tr>
          <tr><td>Город</td><td>{request.city?.name}</td></tr>
          <tr><td>Категория</td><td>{request.category?.name}</td></tr>
          <tr><td>Район</td><td>{request.district ?? request.approximateAddressText}</td></tr>
          <tr><td>Дата / время</td><td>{request.date ? formatDateRu(request.date) : "не указана"} {formatTimeRu(request.timeFrom)}</td></tr>
          <tr><td>Гигиеническая помощь</td><td>{request.needsHygieneHelp ? "требуется" : "не указана"}</td></tr>
          <tr><td>Маломобильность</td><td>{request.hasLimitedMobility ? "да" : "нет"}</td></tr>
          <tr><td>Ребёнок</td><td>{request.hasChild ? "да" : "нет"}</td></tr>
          <tr><td>Состав работ</td><td>{formatJsonList(request.additionalActionsJson)}</td></tr>
        </tbody>
      </table>
      <table>
        <caption>Данные помощника</caption>
        <tbody>
          <tr><td>Помощник</td><td>{response.performer?.displayName ?? "не указан"}</td></tr>
          <tr><td>Город</td><td>{response.performer?.city?.name ?? "не указан"}</td></tr>
          <tr><td>Услуги</td><td>{formatJsonList(performerProfile?.services)}</td></tr>
          <tr><td>Навыки</td><td>{formatJsonList(performerProfile?.skills)}</td></tr>
          <tr><td>Готов к гигиене</td><td>{performerProfile?.readyForHygieneHelp ? "да" : "нет"}</td></tr>
          <tr><td>Готов к маломобильным</td><td>{performerProfile?.readyForLimitedMobility ? "да" : "нет"}</td></tr>
          <tr><td>Готов к детям</td><td>{performerProfile?.readyForChildren ? "да" : "нет"}</td></tr>
          <tr><td>Самозанятость</td><td>{labelSelfEmployed(performerProfile?.selfEmployedStatus)}</td></tr>
          <tr><td>Справка</td><td>{labelCriminalRecord(performerProfile?.criminalRecordCertificateStatus)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function userHasCity(user: User, cityId: string) {
  return user.cityId === cityId || Boolean(user.userCities?.some((row) => row.isActive && row.cityId === cityId));
}

function parseJsonObject(value?: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseSettingBoolean(value?: string | null) {
  try {
    const parsed = JSON.parse(value ?? "null");
    return typeof parsed === "boolean" ? parsed : null;
  } catch {
    return null;
  }
}

function requestExportHeader() {
  return [
    "Номер заявки",
    "Статус",
    "Город",
    "Категория",
    "Заказчик",
    "Помощник",
    "Дата/время",
    "Длительность",
    "Оплата помощнику",
    "Сервисный сбор заказчика",
    "Сервисный сбор помощника",
    "Итого расходы заказчика",
    "Доход помощника после сервисного сбора",
    "Дата создания",
    "Дата обновления"
  ];
}

function requestExportRow(request: ClientRequest) {
  const pricing = request.pricing ?? parseJsonObject(request.pricingBreakdownJson);
  const agreedTerms = request.chat?.agreedTerms;
  const payment = agreedTerms?.agreedHelperAmount ?? pricing?.performerPaymentAmount ?? request.priceEstimateAmount ?? request.budgetAmount ?? 0;
  const customerFee = agreedTerms?.customerServiceFeeAmount ?? pricing?.clientServiceFeeAmount ?? 0;
  const helperFee = agreedTerms?.helperServiceFeeAmount ?? pricing?.performerServiceFeeAmount ?? pricing?.performerCommissionAmount ?? 0;
  return [
    request.publicNumber ?? "",
    labelStatus(request.status),
    request.city?.name ?? "",
    request.category?.name ?? "",
    (request as any).client?.displayName ?? "",
    (request as any).selectedPerformer?.displayName ?? "",
    `${request.date ? formatDateRu(request.date) : ""} ${formatTimeRu(request.timeFrom)}`.trim(),
    request.expectedDurationHours ?? "",
    payment,
    customerFee,
    helperFee,
    agreedTerms?.customerTotalAmount ?? pricing?.clientTotalExpense ?? payment + customerFee,
    agreedTerms?.helperNetAmount ?? pricing?.performerNetAmount ?? Math.max(0, payment - helperFee),
    formatDateTimeRu((request as any).createdAt),
    formatDateTimeRu((request as any).updatedAt)
  ];
}

function requestAgreedTerms(request: ClientRequest) {
  return request.chat?.agreedTerms ?? request.chats?.find((chat) => chat.agreedTerms)?.agreedTerms ?? null;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-zа-яё0-9-]/gi, "");
}

function userRoleLabel(role: string) {
  if (role === "client") return "Заказчик";
  if (role === "performer") return "Помощник";
  if (role === "manager") return "Менеджер";
  if (role === "superadmin") return "Владелец";
  if (role === "oauth_pending") return "Незавершённая VK-регистрация";
  return "Администратор";
}

function isIncompleteVkRegistration(user: User) {
  return user.role === "oauth_pending"
    && user.status === "active"
    && !user.cityId
    && Boolean(user.identities?.some((identity) => identity.provider === "vk"));
}

function isArchivedIncompleteVkRegistration(user: User) {
  return user.role === "oauth_pending"
    && user.status === "archived"
    && Boolean(user.identities?.some((identity) => identity.provider === "vk"));
}

function legalScopeLabel(scope: string) {
  if (scope === "customer") return "Заказчики";
  if (scope === "helper") return "Помощники";
  if (scope === "admin") return "Администраторы";
  return "Все";
}

function legalStatusLabel(status: string) {
  if (status === "accepted") return "Принято";
  if (status === "needs_new_version") return "Требуется новая версия";
  if (status === "revoked") return "Отозвано";
  if (status === "optional") return "Необязательно";
  return "Требуется";
}

function nextLegalVersion(version: string) {
  const parsed = Number.parseFloat(version);
  if (Number.isFinite(parsed)) return (parsed + 0.1).toFixed(1);
  return `${version}-new`;
}

function formatJsonList(value?: string | null) {
  if (!value) return "не указано";
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length ? parsed.join(", ") : "не указано";
  } catch {
    return value;
  }
}

function adminTabFromPath(pathname: string) {
  if (pathname.startsWith("/app/admin/cities")) return "Города";
  if (pathname.startsWith("/app/admin/users")) return "Пользователи";
  if (pathname.startsWith("/app/admin/clients")) return "Заказчики";
  if (pathname.startsWith("/app/admin/performers")) return "Помощники";
  if (pathname.startsWith("/app/admin/requests")) return "Заявки";
  if (pathname.startsWith("/app/admin/responses")) return "Отклики";
  if (pathname.startsWith("/app/admin/chats")) return "Чаты";
  if (pathname.startsWith("/app/admin/support")) return "Обращения";
  if (pathname.startsWith("/app/admin/balances")) return "Балансы";
  if (pathname.startsWith("/app/admin/npd-register")) return "Мой налог";
  if (pathname.startsWith("/app/admin/payments")) return "Платежи";
  if (pathname.startsWith("/app/admin/blocked")) return "Блокировки";
  if (pathname.startsWith("/app/admin/categories")) return "Структуры категорий";
  if (pathname.startsWith("/app/admin/legal")) return "Юридические документы";
  if (pathname.startsWith("/app/admin/archive")) return "Архив";
  if (pathname.startsWith("/app/admin/settings")) return "Настройки сервиса";
  if (pathname.startsWith("/app/admin/knowledge")) return "База знаний";
  return "Главная";
}

function chatIdFromPath(pathname: string, prefix: string) {
  const match = pathname.match(new RegExp(`^${prefix}/([^/]+)$`));
  return match?.[1] ?? null;
}
