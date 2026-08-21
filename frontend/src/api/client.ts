import type {
  AdminBalanceAdjustmentInput,
  AdminBalanceAdjustmentResult,
  AdminBalanceTransaction,
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
  ManagerCreateRequestInput,
  ManagerUserDetails,
  NpdRegisterResponse,
  NpdStatus,
  NpdTaxRegisterEntry,
  PaymentActionResult,
  PaymentRefreshResult,
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
import type {
  CategoriesForCity,
  CategoryCityStatus,
  CategoryExportPayload,
  CategoryImportPreview,
  CategoryStructure,
  HelperCategoryPreference
} from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";
let accessToken: string | null = null;
let refreshRequest: Promise<string | null> | null = null;

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

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
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
  const token = options.token ?? getAccessToken();
  const response = await sendApiRequest(path, options, token);
  if (token && path !== "/auth/refresh" && path !== "/auth/logout" && await isRefreshableAuthFailure(response)) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) return parseApiResponse<T>(await sendApiRequest(path, options, refreshedToken));
  }
  return parseApiResponse<T>(response);
}

async function isRefreshableAuthFailure(response: Response) {
  if (response.status !== 401) return false;
  const payload = await response.clone().json().catch(() => null) as { code?: string } | null;
  return ["auth_invalid", "session_revoked", "acting_session_invalid"].includes(payload?.code ?? "");
}

async function sendApiRequest(path: string, options: ApiOptions, token: string | null) {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include"
  });
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? "Ошибка запроса", payload?.code, payload?.details);
  }

  return payload as T;
}

export async function refreshAccessToken() {
  if (!refreshRequest) {
    refreshRequest = fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include"
    })
      .then(async (response) => {
        if (!response.ok) {
          setAccessToken(null);
          return null;
        }
        const payload = await response.json() as { token: string };
        setAccessToken(payload.token);
        return payload.token;
      })
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

async function downloadProtectedFile(path: string, fileName: string, errorMessage: string) {
  const response = await protectedFileFetch(path);
  if (!response.ok) throw new ApiError(response.status, errorMessage);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function protectedFileFetch(path: string) {
  const request = (token: string | null) => fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${token ?? ""}` }
  });
  const token = getAccessToken();
  let response = await request(token);
  if (response.status === 401 && token) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) response = await request(refreshedToken);
  }
  return response;
}

export const api = {
  bootstrap: () => apiFetch<Bootstrap>("/public/bootstrap"),
  visitReserveSummary: () => apiFetch<any>("/admin/visits/reserve-summary"),
  reconcileVisits: () => apiFetch<{ skipped: boolean; checked: number; closed: number; skippedDisputed: number }>("/admin/visits/reconcile", { method: "POST" }),
  searchSettlements: (query: string) => apiFetch<SettlementSearchResult[]>(`/settlements/search?q=${encodeURIComponent(query)}`),
  suggestSettlement: (body: { name: string; region?: string; district?: string; type?: string }) =>
    apiFetch<{ settlement: SettlementSearchResult; existing: boolean }>("/settlements/suggest", { method: "POST", body: JSON.stringify(body) }),
  myCities: () => apiFetch<MyCities>("/me/cities"),
  myProfile: () => apiFetch<Pick<User, "id" | "displayName" | "phone" | "email" | "role" | "status" | "createdAt" | "city" | "passwordChangedAt" | "passwordResetAt" | "lastLoginAt" | "mustChangePassword">>("/me/profile"),
  updateMyProfile: (displayName: string) => apiFetch<{ id: string; displayName: string; updatedAt: string }>("/me/profile", { method: "PATCH", body: JSON.stringify({ displayName }) }),
  changeMyPassword: (body: { currentPassword: string; newPassword: string; newPasswordConfirmation: string }) =>
    apiFetch<{ token: string; passwordChangedAt: string }>("/me/change-password", { method: "POST", body: JSON.stringify(body) }),
  revokeMyOtherSessions: () => apiFetch<{ token: string; revoked: boolean }>("/me/sessions/revoke-others", { method: "POST" }),
  changeTemporaryPassword: (body: { newPassword: string; newPasswordConfirmation: string }) =>
    apiFetch<{ token: string; mustChangePassword: false }>("/auth/change-temporary-password", { method: "POST", body: JSON.stringify(body) }),
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
  refreshSession: () => refreshAccessToken(),
  logout: () => apiFetch<{ loggedOut: true }>("/auth/logout", { method: "POST" }),
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
  cancelOAuth: () => apiFetch<{ ok: true }>("/auth/oauth/cancel", { method: "POST" }),
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
  calculateRequestPrice: (body: Record<string, unknown>) =>
    apiFetch<import("../types").StructuredRequestPriceQuote>("/requests/calculate-price", { method: "POST", body: JSON.stringify(body) }),
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
  refreshPaymentStatus: (id: string) =>
    apiFetch<PaymentRefreshResult>(`/payments/${id}/refresh-status`, { method: "POST" }),
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
    agreedVisits?: Array<{ visitId: string; amount: number }>;
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
  downloadPerformerDocument: (id: string, fileName: string) => downloadProtectedFile(`/performer-documents/${id}/download`, fileName, "Не удалось скачать документ"),
  downloadAgreementContract: (id: string, fileName: string) => downloadProtectedFile(`/agreement-contracts/${id}/download`, fileName, "Не удалось скачать проект договора"),
  updatePerformerProfile: (body: Record<string, unknown>) =>
    apiFetch("/performer-profile/me", { method: "PATCH", body: JSON.stringify(body) }),
  categoriesForRequest: (cityId: string) => apiFetch<CategoriesForCity>(`/categories/for-request?cityId=${encodeURIComponent(cityId)}`),
  effectiveServiceTree: (cityId: string) => apiFetch<import("../types").EffectiveServiceTree>(`/category-structures/effective-tree?cityId=${encodeURIComponent(cityId)}`),
  requestDrafts: () => apiFetch<import("../types").RequestDraft[]>("/me/request-drafts"),
  requestDraft: (id: string) => apiFetch<import("../types").RequestDraft>(`/me/request-drafts/${id}`),
  createRequestDraft: (body: Record<string, unknown>) => apiFetch<import("../types").RequestDraft>("/me/request-drafts", { method: "POST", body: JSON.stringify(body) }),
  updateRequestDraft: (id: string, body: Record<string, unknown>) => apiFetch<import("../types").RequestDraft>(`/me/request-drafts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteRequestDraft: (id: string) => apiFetch<void>(`/me/request-drafts/${id}`, { method: "DELETE" }),
  duplicateRequestDraft: (id: string) => apiFetch<import("../types").RequestDraft>(`/me/request-drafts/${id}/duplicate`, { method: "POST" }),
  publishRequestDraft: (id: string, revision: number) => apiFetch<{ requestId: string; publicNumber?: string; idempotent: boolean }>(`/me/request-drafts/${id}/publish`, { method: "POST", body: JSON.stringify({ revision }) }),
  createDraftSupportCase: (id: string, body: { subject: string; message: string; revision: number }) => apiFetch<import("../types").RequestDraftSupportCase>(`/me/request-drafts/${id}/support-cases`, { method: "POST", body: JSON.stringify(body) }),
  draftSupportCases: () => apiFetch<import("../types").RequestDraftSupportCase[]>("/admin/request-support-cases"),
  replyDraftSupportCase: (id: string, body: string) => apiFetch(`/admin/request-support-cases/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  updateDraftSupportCase: (id: string, status: import("../types").RequestDraftSupportCase["status"]) => apiFetch(`/admin/request-support-cases/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  assignDraftSupportCase: (id: string) => apiFetch(`/admin/request-support-cases/${id}/assign`, { method: "POST" }),
  categoriesForHelper: (cityId: string) => apiFetch<CategoriesForCity>(`/categories/for-helper?cityId=${encodeURIComponent(cityId)}`),
  helperCategoryPreferences: (cityId?: string) =>
    apiFetch<HelperCategoryPreference[]>(`/helper/category-preferences${cityId ? `?cityId=${encodeURIComponent(cityId)}` : ""}`),
  saveHelperCategoryPreferences: (body: { cityId: string; categoryIds: string[]; comment?: string }) =>
    apiFetch<HelperCategoryPreference[]>("/helper/category-preferences", { method: "PUT", body: JSON.stringify(body) }),
  myServiceMessages: () => apiFetch<{ unreadCount: number; messages: import("../types").ServiceMessage[] }>("/me/service-messages"),
  myServiceMessage: (id: string) => apiFetch<import("../types").ServiceMessage>(`/me/service-messages/${id}`),
  readServiceMessage: (id: string) => apiFetch<import("../types").ServiceMessage>(`/me/service-messages/${id}/read`, { method: "POST" }),
  serviceConversations: (search = "") => apiFetch<import("../types").ServiceConversation[]>(`/admin/service-conversations${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  searchServiceMessageUsers: (query: string) => apiFetch<import("../types").ServiceMessageUserSearchResult[]>(`/admin/service-conversations/users/search?q=${encodeURIComponent(query)}`),
  serviceConversation: (userId: string) => apiFetch<{ user: import("../types").ServiceConversationUser; conversation: import("../types").ServiceConversation | null; attachments: import("../types").ServiceMessageAttachment[] }>(`/admin/service-conversations/${userId}`),
  sendServiceMessage: (userId: string, body: {
    title?: string;
    body: string;
    messageType: "service_message" | "system_notice";
    clientRequestId?: string;
    relatedPaymentTransactionId?: string;
    relatedRefundTransactionId?: string;
    relatedRequestId?: string;
    files?: Array<{ fileName: string; mimeType: string; fileData: string; attachmentType: string }>;
  }) => apiFetch<{ message: import("../types").ServiceMessage; idempotent: boolean }>(`/admin/service-conversations/${userId}/messages`, { method: "POST", body: JSON.stringify(body) }),
  broadcastPreview: (body: Record<string, unknown>) => apiFetch<import("../types").BroadcastPreview>("/admin/broadcasts/preview", { method: "POST", body: JSON.stringify(body) }),
  broadcasts: () => apiFetch<import("../types").BroadcastCampaign[]>("/admin/broadcasts"),
  createBroadcast: (body: Record<string, unknown>) => apiFetch<{ campaign: import("../types").BroadcastCampaign; idempotent: boolean }>("/admin/broadcasts", { method: "POST", body: JSON.stringify(body) }),
  sendBroadcast: (id: string) => apiFetch<{ campaign: import("../types").BroadcastCampaign; idempotent: boolean }>(`/admin/broadcasts/${id}/send`, { method: "POST", body: JSON.stringify({ confirmed: true }) }),
  cancelBroadcast: (id: string) => apiFetch<import("../types").BroadcastCampaign>(`/admin/broadcasts/${id}/cancel`, { method: "POST" }),
  messagePaymentUser: (paymentId: string, body: Record<string, unknown>) => apiFetch(`/admin/payments/${paymentId}/message-user`, { method: "POST", body: JSON.stringify(body) }),
  downloadServiceAttachment: async (id: string, originalFileName: string) => {
    const response = await protectedFileFetch(`/service-message-attachments/${id}/download`);
    if (!response.ok) throw new ApiError(response.status, "Не удалось скачать вложение");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = originalFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
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
  adminCategoryStructures: (status: "working" | "active" | "draft" | "archived" | "all" = "working") => apiFetch<CategoryStructure[]>(`/admin/category-structures?status=${status}`),
  adminCategoryStructure: (id: string) => apiFetch<CategoryStructure>(`/admin/category-structures/${id}`),
  adminCategoryCityStatuses: () => apiFetch<CategoryCityStatus[]>("/admin/category-structures/city-status"),
  adminCreateCategoryStructure: (body: { scopeType: "region" | "city"; regionId?: string; cityId?: string; title?: string; comment?: string }) =>
    apiFetch<CategoryStructure>("/admin/category-structures/create-from-parent", { method: "POST", body: JSON.stringify(body) }),
  adminCreateCategoryStructureVersion: (id: string, comment?: string) =>
    apiFetch<CategoryStructure>(`/admin/category-structures/${id}/new-version`, { method: "POST", body: JSON.stringify({ comment }) }),
  adminCreateCategoryStructureRollback: (id: string) =>
    apiFetch<CategoryStructure>(`/admin/category-structures/${id}/rollback`, { method: "POST", body: JSON.stringify({ confirmed: true }) }),
  adminCategoryStructureDependencies: (id: string) =>
    apiFetch<import("../types").CategoryStructureDependencies>(`/admin/category-structures/${id}/dependencies`),
  adminDeleteCategoryStructure: (id: string, body: { comment: string; confirmationPhrase?: string }) =>
    apiFetch<{ deleted: boolean; structureId: string; versionNumber: string }>(`/admin/category-structures/${id}`, { method: "DELETE", body: JSON.stringify(body) }),
  adminEmergencyDisableCategoryStructure: (id: string, reason: string) =>
    apiFetch<{ disabled: boolean; fallbackStructure?: CategoryStructure | null; affectedRequests: number; hiddenPublishedRequests: number; usesParentFallback: boolean }>(`/admin/category-structures/${id}/emergency-disable`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminCategoryStructureEmergencyPreview: (id: string) =>
    apiFetch<{ fallbackStructure: Pick<CategoryStructure, "id" | "title" | "scopeType" | "versionNumber"> | null; affectedRequests: number; publishedRequestsToHide: number; agreedRequestsBlocked: number; canDisable: boolean }>(`/admin/category-structures/${id}/emergency-disable-preview`),
  adminStartRequestStructureUpdate: (structureId: string, requestId: string) =>
    apiFetch<import("../types").RequestStructureUpdateRevision>(`/admin/category-structures/${structureId}/requests/${requestId}/start-update`, { method: "POST" }),
  confirmRequestStructureUpdate: (revisionId: string) =>
    apiFetch(`/category-structures/request-updates/${revisionId}/confirm`, { method: "POST" }),
  adminCompareCategoryStructures: (leftId: string, rightId: string) =>
    apiFetch<import("../types").CategoryStructureComparison>(`/admin/category-structures/compare?leftId=${encodeURIComponent(leftId)}&rightId=${encodeURIComponent(rightId)}`),
  adminUpdateCategoryStructure: (id: string, body: Partial<Pick<CategoryStructure, "title" | "description" | "qualityStatus" | "comment">>) =>
    apiFetch<CategoryStructure>(`/admin/category-structures/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminPublishCategoryStructure: (id: string) => apiFetch<CategoryStructure>(`/admin/category-structures/${id}/publish`, { method: "POST" }),
  adminArchiveCategoryStructure: (id: string) => apiFetch<CategoryStructure>(`/admin/category-structures/${id}/archive`, { method: "POST" }),
  adminExportCategoryStructure: (id: string, format: "xlsx" | "json") =>
    apiFetch<CategoryExportPayload>(`/admin/category-structures/${id}/export.${format}`),
  adminExportCategoryCityTemplate: (cityId: string) =>
    apiFetch<CategoryExportPayload>(`/admin/category-structures/city-template/export.xlsx?cityId=${encodeURIComponent(cityId)}`),
  adminExportCategoryRegionTemplate: (regionId: string) =>
    apiFetch<CategoryExportPayload>(`/admin/category-structures/region-template/export.xlsx?regionId=${encodeURIComponent(regionId)}`),
  adminPreviewCategoryImport: (body: { payload: unknown; fileName: string; fileSize: number }) =>
    apiFetch<CategoryImportPreview>("/admin/category-structures/import/preview", { method: "POST", body: JSON.stringify(body) }),
  adminCreateCategoryImportDraft: (body: { payload: unknown; fileName: string; fileSize: number }) =>
    apiFetch<CategoryStructure>("/admin/category-structures/import/create-draft", { method: "POST", body: JSON.stringify(body) }),
  adminTransactions: () => apiFetch<AdminBalanceTransaction[]>("/admin/balance-transactions"),
  adminAdjustBalance: (userId: string, body: AdminBalanceAdjustmentInput) =>
    apiFetch<AdminBalanceAdjustmentResult>(`/admin/users/${userId}/balance-adjustment`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getAdminPayments: (filters: AdminPaymentFilters = {}) =>
    apiFetch<AdminPaymentListItem[]>(`/admin/payments${queryString(filters)}`),
  getAdminPayment: (id: string) => apiFetch<AdminPaymentDetails>(`/admin/payments/${id}`),
  refundAdminPayment: (id: string, body: { amount: number; reason: string }) =>
    apiFetch<{ refund: import("../types").RefundTransaction; idempotent: boolean }>(`/admin/payments/${id}/refund`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  recordManualBankRefund: (id: string, body: {
    amount: number;
    bankRefundDate: string;
    reason: "customer_request" | "test_refund" | "service_cancelled" | "duplicate_payment" | "other";
    comment: string;
    bankReference?: string;
  }) => apiFetch<{ refund: import("../types").RefundTransaction }>(`/admin/payments/${id}/manual-bank-refund`, {
    method: "POST",
    body: JSON.stringify(body)
  }),
  syncAdminTbankPayment: (id: string) =>
    apiFetch<import("../types").TbankPaymentSyncResult>(`/admin/payments/${id}/sync-tbank-status`, { method: "POST" }),
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
  adminBlockUser: (userId: string, reason: string) =>
    apiFetch<User>(`/admin/users/${userId}/block`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminUnblockUser: (userId: string) =>
    apiFetch<User>(`/admin/users/${userId}/unblock`, { method: "POST" }),
  adminAssignManager: (userId: string, reason?: string) =>
    apiFetch<User>(`/admin/users/${userId}/manager/assign`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminRevokeManager: (userId: string, restoreRole?: "client" | "performer", reason?: string) =>
    apiFetch<User>(`/admin/users/${userId}/manager/revoke`, {
      method: "POST",
      body: JSON.stringify({ restoreRole, reason })
    }),
  adminResetUserPassword: (userId: string, body: { reasonCode: string; reasonComment?: string }) =>
    apiFetch<{ temporaryPassword: string; temporaryPasswordExpiresAt: string }>(`/admin/users/${userId}/reset-password`, { method: "POST", body: JSON.stringify(body) }),
  adminRevokeUserSessions: (userId: string) =>
    apiFetch<{ revoked: boolean; userId: string }>(`/admin/users/${userId}/revoke-sessions`, { method: "POST" }),
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
  adminCancelPendingOAuthRegistration: (userId: string) =>
    apiFetch<{ user: User }>(`/admin/users/${userId}/oauth-pending/cancel`, { method: "POST" }),
  adminOAuthPendingRestoreSafety: (userId: string) =>
    apiFetch<import("../types").OAuthPendingRestoreSafety>(`/admin/users/${userId}/oauth-pending-restore-safety`),
  adminRestorePendingOAuthRegistration: (userId: string) =>
    apiFetch<{ user: User; safety: import("../types").OAuthPendingRestoreSafety }>(`/admin/users/${userId}/restore-oauth-pending`, {
      method: "POST"
    }),
  adminUpdatePerformerVerification: (userId: string, body: Record<string, unknown>) =>
    apiFetch(`/admin/performers/${userId}/verification`, { method: "PATCH", body: JSON.stringify(body) }),
  adminUpdatePerformerDocumentStatus: (documentId: string, status: string, adminComment?: string) =>
    apiFetch(`/admin/performer-documents/${documentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, adminComment })
    }),
  adminUpdateCategory: (categoryId: string, body: Partial<ServiceCategory>) =>
    apiFetch<ServiceCategory>(`/admin/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(body) }),
  getAdminNpdRegister: (from: string, to: string) =>
    apiFetch<NpdRegisterResponse>(`/admin/npd-register${queryString({ from, to })}`),
  updateAdminNpdRegisterEntry: (entryId: string, body: { npdStatus?: NpdStatus; npdComment?: string | null }) =>
    apiFetch<NpdTaxRegisterEntry>(`/admin/npd-register/${entryId}`, { method: "PATCH", body: JSON.stringify(body) }),
  managerSummary: () => apiFetch<Record<string, number>>("/manager/summary"),
  managerUsers: () => apiFetch<User[]>("/manager/users"),
  managerUser: (userId: string) => apiFetch<ManagerUserDetails>(`/manager/users/${userId}`),
  managerBlockUser: (userId: string, reason: string) =>
    apiFetch<User>(`/manager/users/${userId}/block`, { method: "POST", body: JSON.stringify({ reason }) }),
  managerUnblockUser: (userId: string) =>
    apiFetch<User>(`/manager/users/${userId}/unblock`, { method: "POST" }),
  managerRequests: () => apiFetch<ClientRequest[]>("/manager/requests"),
  managerCreateRequest: (input: ManagerCreateRequestInput) =>
    apiFetch<ClientRequest>("/manager/requests", { method: "POST", body: JSON.stringify(input) }),
  managerRequest: (requestId: string) => apiFetch<ClientRequest>(`/manager/requests/${requestId}`),
  managerChats: () => apiFetch<Chat[]>("/manager/chats"),
  managerChat: (chatId: string) => apiFetch<Chat>(`/manager/chats/${chatId}`),
  managerComplaints: () => apiFetch<unknown[]>("/manager/complaints"),
  managerComplaint: (complaintId: string) => apiFetch<unknown>(`/manager/complaints/${complaintId}`),
  managerPayments: () => apiFetch<AdminPaymentListItem[]>("/manager/payments"),
  managerTransactions: () => apiFetch<unknown[]>("/manager/balance-transactions")
};
