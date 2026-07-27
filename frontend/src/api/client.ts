import type {
  BalanceSummary,
  AdminPaymentDetails,
  AdminPaymentFilters,
  AdminPaymentListItem,
  Bootstrap,
  City,
  Chat,
  ClientRequest,
  KnowledgeArticle,
  LegalDocument,
  LegalExportPayload,
  PaymentActionResult,
  PaymentTransaction,
  MyCities,
  SettlementSearchResult,
  UserCity,
  PerformerDocument,
  PricingQuote,
  ServiceCategory,
  TopUpPaymentInit,
  TrialBalanceGrantSummary,
  TrialBalanceSettings,
  User,
  UserArchiveSafety,
  UserConsent,
  UserConsentStatus
} from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
const TOKEN_KEY = "zabota_ryadom_token";

type ApiOptions = RequestInit & {
  token?: string | null;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function queryString(params: Record<string, string | number | boolean | null | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = options.token ?? getStoredToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? "Ошибка запроса", payload?.code, payload?.details);
  }

  return payload as T;
}

export const api = {
  bootstrap: () => apiFetch<Bootstrap>("/public/bootstrap"),
  searchSettlements: (query: string) => apiFetch<SettlementSearchResult[]>(`/settlements/search?q=${encodeURIComponent(query)}`),
  suggestSettlement: (body: { name: string; region?: string; district?: string; type?: string }) =>
    apiFetch<{ settlement: SettlementSearchResult; existing: boolean }>("/settlements/suggest", { method: "POST", body: JSON.stringify(body) }),
  myCities: () => apiFetch<MyCities>("/me/cities"),
  addMyCity: (body: { cityId: string; roleScope: "customer" | "helper" | "both"; isPrimary?: boolean }) =>
    apiFetch<UserCity>("/me/cities", { method: "POST", body: JSON.stringify(body) }),
  updateMyCity: (id: string, body: { roleScope?: "customer" | "helper" | "both"; isPrimary?: boolean; isActive?: boolean }) =>
    apiFetch<UserCity>(`/me/cities/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMyCity: (id: string) => apiFetch<void>(`/me/cities/${id}`, { method: "DELETE" }),
  login: (body: { phoneOrEmail: string; password: string }) =>
    apiFetch<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  register: (body: {
    role: "client" | "performer";
    phone: string;
    email?: string;
    password: string;
    displayName: string;
    cityId?: string;
    citySuggestion?: { name: string; region?: string };
    acceptedConsentTypes: string[];
    acceptedLegalDocumentTypes?: string[];
    marketingNotificationsAccepted?: boolean;
    dependentDataTransferConfirmed?: boolean;
    helperNotEmployerAcknowledged?: boolean;
    helperNoMedicalServicesConfirmed?: boolean;
  }) =>
    apiFetch<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  claimOAuthSession: () =>
    apiFetch<{ token: string; user: User; profileComplete: boolean; nextPath: string }>("/auth/oauth/session", {
      method: "POST"
    }),
  startVkLink: () =>
    apiFetch<{ authorizationUrl: string }>("/auth/oauth/vk/start", { method: "POST" }),
  completeOAuthProfile: (body: {
    role: "client" | "performer";
    cityId: string;
    phone: string;
    acceptedDocuments: string[];
    marketingNotificationsAccepted: boolean;
    dependentDataTransferConfirmed: boolean;
    helperNotEmployerAcknowledged: boolean;
    helperNoMedicalServicesConfirmed: boolean;
  }) =>
    apiFetch<{ user: User; profileComplete: boolean; nextPath: string }>("/auth/oauth/complete-profile", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  me: () => apiFetch<{ user: User }>("/auth/me"),
  startAdminActing: (role: "customer" | "helper") =>
    apiFetch<{ token: string; effectiveRole: "client" | "performer"; nextPath: string }>("/admin/acting/start", {
      method: "POST",
      body: JSON.stringify({ role })
    }),
  stopAdminActing: () =>
    apiFetch<{ token: string; effectiveRole: "admin" | "superadmin"; nextPath: string }>("/admin/acting/stop", {
      method: "POST"
    }),
  legalDocuments: () => apiFetch<LegalDocument[]>("/legal/documents"),
  legalDocument: (slug: string) => apiFetch<LegalDocument>(`/legal/documents/${slug}`),
  legalStatus: () => apiFetch<UserConsentStatus[]>("/legal/my-consents"),
  acceptLegalConsents: (documentTypes: string[], source = "profile") =>
    apiFetch<UserConsentStatus[]>("/legal/consents/accept", {
      method: "POST",
      body: JSON.stringify({ documentTypes, source })
    }),
  requests: (scope?: string) => apiFetch<ClientRequest[]>(`/requests${scope ? `?scope=${scope}` : ""}`),
  createRequest: (body: Record<string, unknown>) =>
    apiFetch<ClientRequest>("/requests", { method: "POST", body: JSON.stringify(body) }),
  updateRequest: (id: string, body: Record<string, unknown>) =>
    apiFetch<ClientRequest>(`/requests/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  priceQuote: (body: Record<string, unknown>) =>
    apiFetch<PricingQuote>("/pricing/quote", { method: "POST", body: JSON.stringify(body) }),
  publishRequest: (id: string) => apiFetch<ClientRequest>(`/requests/${id}/publish`, { method: "POST" }),
  respondToRequest: (id: string, message: string) =>
    apiFetch<{ warning?: string | null }>(`/requests/${id}/respond`, {
      method: "POST",
      body: JSON.stringify({ message })
    }),
  acceptResponse: (responseId: string) =>
    apiFetch<{ request: ClientRequest; chat: Chat }>(`/requests/responses/${responseId}/accept`, {
      method: "POST"
    }),
  completeRequest: (id: string) => apiFetch<ClientRequest>(`/requests/${id}/complete`, { method: "POST" }),
  createReview: (requestId: string, body: { toUserId: string; rating: number; text: string; likedText?: string; improvementText?: string }) =>
    apiFetch(`/requests/${requestId}/reviews`, { method: "POST", body: JSON.stringify(body) }),
  balance: () => apiFetch<BalanceSummary>("/balance/me"),
  createTopUpPayment: (amount: number) =>
    apiFetch<TopUpPaymentInit>("/payments/top-up/init", { method: "POST", body: JSON.stringify({ amount }) }),
  getMyPayments: () => apiFetch<PaymentTransaction[]>("/payments/my"),
  getPayment: (id: string) => apiFetch<PaymentTransaction>(`/payments/${id}`),
  mockPaymentSucceed: (id: string) =>
    apiFetch<PaymentActionResult>(`/payments/mock/${id}/succeed`, { method: "POST" }),
  mockPaymentFail: (id: string) =>
    apiFetch<PaymentActionResult>(`/payments/mock/${id}/fail`, { method: "POST" }),
  chats: () => apiFetch<Chat[]>("/chats"),
  chatMessages: (chatId: string) => apiFetch<Chat>(`/chats/${chatId}/messages`),
  sendMessage: (chatId: string, text: string) =>
    apiFetch<{ message: unknown; moderation: { warning?: string; flags: string[] } }>(`/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    }),
  updateChatTerms: (chatId: string, body: {
    agreedHelperAmount: number;
    agreedPackageId?: string | null;
    agreedAddons?: string[];
    agreedDurationMinutes?: number | null;
    agreedScheduledAt?: string | null;
    agreedTermsComment?: string | null;
  }) => apiFetch<Chat>(`/chats/${chatId}/terms`, { method: "PATCH", body: JSON.stringify(body) }),
  clientConfirmChat: (chatId: string) => apiFetch<Chat>(`/chats/${chatId}/client-confirm`, { method: "POST" }),
  performerConfirmChat: (chatId: string) => apiFetch<Chat>(`/chats/${chatId}/performer-confirm`, { method: "POST" }),
  markChatNotAgreed: (chatId: string) => apiFetch<Chat>(`/chats/${chatId}/not-agreed`, { method: "POST" }),
  proposeNewTerms: (chatId: string) => apiFetch<Chat>(`/chats/${chatId}/propose-new-terms`, { method: "POST" }),
  adminDeleteChatMessage: (chatId: string, messageId: string) =>
    apiFetch<Chat>(`/chats/${chatId}/messages/${messageId}`, { method: "DELETE" }),
  complaints: () => apiFetch<unknown[]>("/complaints"),
  createComplaint: (body: Record<string, unknown>) =>
    apiFetch("/complaints", { method: "POST", body: JSON.stringify(body) }),
  knowledge: (audience: string) => apiFetch<KnowledgeArticle[]>(`/knowledge?audience=${audience}`),
  performerDocuments: () => apiFetch<PerformerDocument[]>("/performer-documents"),
  updatePerformerProfile: (body: Record<string, unknown>) =>
    apiFetch("/performer-profile/me", { method: "PATCH", body: JSON.stringify(body) }),
  uploadPerformerDocument: (body: { type: "self_employed" | "criminal_record"; fileName: string; fileData: string }) =>
    apiFetch<PerformerDocument>("/performer-documents", { method: "POST", body: JSON.stringify(body) }),
  adminSummary: () => apiFetch<Record<string, number>>("/admin/summary"),
  adminUsers: () => apiFetch<User[]>("/admin/users"),
  adminRequests: () => apiFetch<ClientRequest[]>("/admin/requests"),
  adminChats: () => apiFetch<Chat[]>("/admin/chats"),
  adminComplaints: () => apiFetch<unknown[]>("/admin/complaints"),
  adminCities: () => apiFetch<City[]>("/admin/cities"),
  adminUpdateCity: (cityId: string, body: Partial<City>) =>
    apiFetch<City>(`/admin/cities/${cityId}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminCategories: () => apiFetch<ServiceCategory[]>("/admin/categories"),
  adminTransactions: () => apiFetch<unknown[]>("/admin/balance-transactions"),
  getAdminPayments: (filters: AdminPaymentFilters = {}) =>
    apiFetch<AdminPaymentListItem[]>(`/admin/payments${queryString(filters)}`),
  getAdminPayment: (id: string) => apiFetch<AdminPaymentDetails>(`/admin/payments/${id}`),
  adminSettings: () => apiFetch<unknown[]>("/admin/settings"),
  getTrialBalanceSettings: () => apiFetch<TrialBalanceSettings>("/admin/trial-balance/settings"),
  updateTrialBalanceSettings: (body: Pick<TrialBalanceSettings, "enabled" | "amount" | "autoGrantNewUsers">) =>
    apiFetch<TrialBalanceSettings>("/admin/trial-balance/settings", { method: "PUT", body: JSON.stringify(body) }),
  grantTrialBalanceToAll: () =>
    apiFetch<TrialBalanceGrantSummary>("/admin/trial-balance/grant-all", { method: "POST" }),
  adminUpdateSetting: (key: string, valueJson: string) =>
    apiFetch(`/admin/settings/${key}`, { method: "PATCH", body: JSON.stringify({ valueJson }) }),
  adminKnowledge: () => apiFetch<KnowledgeArticle[]>("/admin/knowledge"),
  adminUpdateKnowledge: (articleId: string, body: Partial<KnowledgeArticle>) =>
    apiFetch<KnowledgeArticle>(`/admin/knowledge/${articleId}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminLegalDocuments: () => apiFetch<LegalDocument[]>("/admin/legal/documents"),
  adminCreateLegalDocument: (body: Partial<LegalDocument>) =>
    apiFetch<LegalDocument>("/admin/legal/documents", { method: "POST", body: JSON.stringify(body) }),
  adminUpdateLegalDocument: (id: string, body: Partial<LegalDocument>) =>
    apiFetch<LegalDocument>(`/admin/legal/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminCreateLegalDocumentVersion: (id: string, body: Partial<LegalDocument>) =>
    apiFetch<LegalDocument>(`/admin/legal/documents/${id}/new-version`, { method: "POST", body: JSON.stringify(body) }),
  adminPublishLegalDocument: (id: string) =>
    apiFetch<LegalDocument>(`/admin/legal/documents/${id}/publish`, { method: "POST" }),
  adminArchiveLegalDocument: (id: string) =>
    apiFetch<LegalDocument>(`/admin/legal/documents/${id}/archive`, { method: "POST" }),
  adminLegalConsents: () => apiFetch<UserConsent[]>("/admin/legal/consents"),
  adminLegalExportLogs: () => apiFetch<unknown[]>("/admin/legal/export-logs"),
  adminUserLegalConsents: (userId: string) => apiFetch<UserConsentStatus[]>(`/admin/users/${userId}/legal/consents`),
  adminExportAllConsents: () => apiFetch<LegalExportPayload>("/admin/legal/exports/all.xlsx"),
  adminExportUserConsents: (userId: string) =>
    apiFetch<LegalExportPayload>(`/admin/users/${userId}/legal/consents.xlsx`),
  adminExportLegalArchive: () => apiFetch<LegalExportPayload>("/admin/legal/exports/archive.zip"),
  adminExportUserLegalArchive: (userId: string) => apiFetch<LegalExportPayload>(`/admin/users/${userId}/legal/archive.zip`),
  adminSecurityChecklist: () => apiFetch<unknown>("/admin/legal/security-checklist"),
  adminRunArchive: (completedRequestDays = 30) =>
    apiFetch<{ archivedUsers: number; archivedRequests: number }>("/admin/archive/run", {
      method: "POST",
      body: JSON.stringify({ completedRequestDays })
    }),
  adminGrantBonus: (userId: string, amount: number, reason: string, comment?: string, bonusExpiresAt?: string) =>
    apiFetch<BalanceSummary>(`/admin/users/${userId}/bonus`, {
      method: "POST",
      body: JSON.stringify({ amount, reason, comment, bonusExpiresAt })
    }),
  adminBlockUser: (userId: string, reason: string) =>
    apiFetch<User>(`/admin/users/${userId}/block`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminUnblockUser: (userId: string) =>
    apiFetch<User>(`/admin/users/${userId}/unblock`, { method: "POST" }),
  adminUserArchiveSafety: (userId: string) =>
    apiFetch<UserArchiveSafety>(`/admin/users/${userId}/archive-safety`),
  adminRequestUserArchive: (userId: string, reason: string) =>
    apiFetch<{ user: User; safety: UserArchiveSafety }>(`/admin/users/${userId}/request-archive`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  adminArchiveUser: (userId: string, reason: string) =>
    apiFetch<{ user: User; safety: UserArchiveSafety }>(`/admin/users/${userId}/archive`, {
      method: "POST",
      body: JSON.stringify({ reason })
    }),
  adminUpdatePerformerVerification: (userId: string, body: Record<string, unknown>) =>
    apiFetch(`/admin/performers/${userId}/verification`, { method: "PATCH", body: JSON.stringify(body) }),
  adminUpdatePerformerDocumentStatus: (documentId: string, status: string, adminComment?: string) =>
    apiFetch(`/admin/performer-documents/${documentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, adminComment })
    }),
  adminUpdateCategory: (categoryId: string, body: Partial<ServiceCategory>) =>
    apiFetch<ServiceCategory>(`/admin/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(body) })
};
