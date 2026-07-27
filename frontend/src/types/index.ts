export type UserRole = "client" | "performer" | "admin" | "superadmin" | "oauth_pending";

export type UserIdentity = {
  id: string;
  provider: "vk" | string;
  providerUserId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
};

export type City = {
  id: string;
  name: string;
  slug: string;
  region: string;
  normalizedName?: string;
  type?: string;
  district?: string | null;
  municipalDistrict?: string | null;
  source?: string;
  directoryStatus?: string;
  serviceStatus?: string;
  activatedAt?: string | null;
  activatedByUserId?: string | null;
  customerCount?: number;
  helperCount?: number;
  requestCount?: number;
  needsReview?: boolean;
  status: string;
  isActive: boolean;
  defaultCommissionAmount: number;
  minTopUpAmount: number;
  mapCenterLat: number;
  mapCenterLng: number;
  mapDefaultRadiusMeters: number;
  districtsJson: string;
  localSettingsJson: string;
  timezone?: string;
  pricingZone?: string;
  sortOrder?: number;
};

export type SettlementSearchResult = Pick<City, "id" | "name" | "type" | "region" | "district" | "directoryStatus" | "serviceStatus"> & {
  displayName: string;
};

export type UserCity = {
  id: string;
  userId: string;
  cityId: string;
  roleScope: "customer" | "helper" | "both";
  isPrimary: boolean;
  isActive: boolean;
  city: City;
  createdAt: string;
  updatedAt: string;
};

export type MyCities = {
  primaryCity: UserCity | null;
  additionalCities: UserCity[];
  cities: UserCity[];
};

export type ServiceCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  includedJson?: string;
  excludedJson?: string;
  complexityJson?: string;
  transferRules?: string | null;
  medicalProhibitions?: string | null;
  clientInstructions?: string | null;
  performerInstructions?: string | null;
  pricingRulesJson?: string;
  basePrice: number;
  calculationUnit: string;
  minDurationHours: number;
  sortOrder: number;
  isActive: boolean;
  isChildcare: boolean;
  requiresCriminalRecord: boolean;
};

export type User = {
  id: string;
  role: UserRole;
  realRole?: UserRole;
  effectiveRole?: UserRole;
  isActingAsRole?: boolean;
  actingRole?: "client" | "performer" | null;
  realAdminUserId?: string | null;
  displayActingBanner?: boolean;
  rolesJson: string;
  phone: string | null;
  normalizedPhone?: string | null;
  email?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  cityId?: string | null;
  status: string;
  balance: number;
  bonusBalance: number;
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  phoneVerifiedAt?: string | null;
  emailVerifiedAt?: string | null;
  blockedAt?: string | null;
  blockedByAdminId?: string | null;
  blockReason?: string | null;
  archiveRequestedAt?: string | null;
  archiveRequestedByAdminId?: string | null;
  archiveReason?: string | null;
  archivedAt?: string | null;
  archivedByAdminId?: string | null;
  archiveBlockedReason?: string | null;
  city?: City | null;
  clientProfile?: ClientProfile | null;
  performerProfile?: PerformerProfile | null;
  performerDocuments?: PerformerDocument[];
  legalConsents?: UserConsent[];
  identities?: UserIdentity[];
  userCities?: UserCity[];
};

export type UserArchiveSafety = {
  canArchive: boolean;
  reasons: string[];
  balance: number;
  bonusBalance: number;
  activeRequestsCount: number;
  activeChatsCount: number;
  pendingPaymentsCount: number;
  openComplaintsCount: number;
  daysSinceBlockedOrRequested: number | null;
  requiredWaitDays: number;
};

export type ClientProfile = {
  userId: string;
  fullName?: string | null;
  preferredContactMethod: string;
  rating: number;
  completedRequestsCount: number;
  complaintsCount: number;
  notes?: string | null;
};

export type PerformerProfile = {
  userId: string;
  age?: number | null;
  about?: string | null;
  experience?: string | null;
  services: string;
  skills: string;
  schedule?: string | null;
  districts: string;
  canTravelIndependently?: boolean;
  canTravelOutsideCity?: boolean;
  readyForHygieneHelp?: boolean;
  readyForPhysicalHelp?: boolean;
  readyForLimitedMobility?: boolean;
  readyForChildren?: boolean;
  readyForUrgentRequests?: boolean;
  readyToProvideDocuments?: boolean;
  selfEmployedStatus: string;
  criminalRecordCertificateStatus: string;
  verificationStatuses: string;
  childcareApprovalStatus: string;
  trustLevel: string;
  rating: number;
  completedJobsCount: number;
  complaintsCount: number;
  isAvailable: boolean;
  profileComment?: string | null;
};

export type RequestResponse = {
  id: string;
  status: string;
  message?: string | null;
  createdAt?: string;
  performerId: string;
  performer?: {
    id: string;
    displayName: string;
    rating: number;
    completedJobsCount: number;
    trustLevel: string;
    verificationStatuses: string[];
    criminalRecordCertificateStatus: string;
    childcareApprovalStatus: string;
    childcareWarning?: boolean;
  };
};

export type ClientRequest = {
  id: string;
  publicNumber?: string | null;
  clientId: string;
  cityId: string;
  categoryId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  helpFor?: string | null;
  additionalActionsJson?: string;
  dependentStateJson?: string;
  dependentAge?: number | null;
  scheduleType?: string;
  regularPeriod?: string | null;
  repeatedVisitsAllowed?: boolean;
  title: string;
  description: string;
  addressText?: string | null;
  approximateAddressText: string;
  addressCity?: string | null;
  addressStreet?: string | null;
  addressHouse?: string | null;
  addressApartment?: string | null;
  addressEntrance?: string | null;
  addressFloor?: string | null;
  addressIntercom?: string | null;
  addressComment?: string | null;
  fullAddress?: string | null;
  publicAddress?: string | null;
  yandexPublicMapAddress?: string | null;
  yandexExactMapAddress?: string | null;
  yandexPublicMapUrl?: string | null;
  yandexExactMapUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  district?: string | null;
  date?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  expectedDurationHours?: number | null;
  urgency: string;
  hasElderlyPerson: boolean;
  hasChild: boolean;
  hasLimitedMobility: boolean;
  physicalHelpLevel?: string | null;
  needsCooking: boolean;
  needsCleaning: boolean;
  needsWalk: boolean;
  needsHygieneHelp: boolean;
  hasPets: boolean;
  budgetAmount?: number | null;
  priceEstimateAmount?: number | null;
  pricingBreakdownJson?: string | null;
  pricing?: PricingQuote | null;
  comment?: string | null;
  status: string;
  visibilityStatus: string;
  exactAddressVisible: boolean;
  phoneVisible: boolean;
  selectedPerformerId?: string | null;
  city?: City;
  category?: ServiceCategory;
  responses?: RequestResponse[];
  chat?: { id: string; status: string; performerId?: string; agreedTerms?: AgreedTerms | null } | null;
  chats?: Array<{ id: string; status: string; performerId: string; agreedTerms?: AgreedTerms | null; archivedAt?: string | null }>;
  client?: Pick<User, "id" | "displayName">;
  responseId?: string;
  responseStatus?: string;
  match?: {
    status: "fit" | "partial" | "not_fit";
    label: string;
    reasons: string[];
  } | null;
};

export type PricingQuote = {
  basePrice: number;
  durationHours: number;
  billableHours: number;
  calculationUnit: string;
  packageId?: string;
  packageTitle?: string;
  packagePriceMin?: number;
  packagePriceMax?: number | null;
  packageLabel?: string;
  packageShortLabel?: string;
  additions: Array<{ label: string; amount: number; appliesTo?: string }>;
  packageName: string;
  packageDescription: string;
  careLevel?: string | null;
  careLevelLabel?: string | null;
  visitFormat?: string;
  workerPayment?: number;
  clientServiceFee?: number;
  performerServiceFee?: number;
  clientTotal?: number;
  performerNet?: number;
  serviceMargin?: number;
  recommendationReasons?: string[];
  warnings?: string[];
  includedActions?: string[];
  notIncluded?: string[];
  requiredConfirmations?: string[];
  isManualReviewRequired?: boolean;
  period?: {
    visitsCount: number;
    totalHours: number;
    clientTotal: number;
    workerPayment: number;
    clientServiceFeeTotal: number;
    performerServiceFeeTotal: number;
    performerNetTotal: number;
    serviceMarginTotal: number;
  };
  included: string[];
  excluded: string[];
  performerPaymentAmount: number;
  helperAmount?: number;
  customerServiceFeeAmount?: number;
  helperServiceFeeAmount?: number;
  customerTotalAmount?: number;
  helperNetAmount?: number;
  customerTotalMin?: number;
  customerTotalMax?: number | null;
  helperNetMin?: number;
  helperNetMax?: number | null;
  minTopUpAmount?: number;
  possibleAddons?: Array<{
    id: string;
    title: string;
    priceMin: number | null;
    priceMax: number | null;
    unit: string;
    priceLabel: string;
  }>;
  addons?: Array<{
    id: string;
    title: string;
    priceMin: number | null;
    priceMax: number | null;
    unit: string;
    priceLabel: string;
    quantity: number;
    amountMin: number | null;
    amountMax: number | null;
    selectedAmount: number | null;
  }>;
  clientServiceFeeAmount: number;
  performerServiceFeeAmount: number;
  performerCommissionAmount: number;
  clientTotalExpense: number;
  performerNetAmount: number;
  clientExplanation: string;
  performerExplanation: string;
  increaseFactors: string[];
  forbidden: string[];
  total: number;
  explanation: string;
};

export type PerformerDocument = {
  id: string;
  performerId: string;
  type: string;
  fileName: string;
  fileUrl: string;
  status: string;
  uploadedAt: string;
  verifiedAt?: string | null;
  adminComment?: string | null;
};

export type LegalRoleScope = "all" | "customer" | "helper" | "admin";

export type LegalDocument = {
  id: string;
  type: string;
  roleScope: LegalRoleScope;
  title: string;
  slug: string;
  version: string;
  contentMarkdown: string;
  contentHash: string;
  isRequired: boolean;
  isPublished: boolean;
  isActive: boolean;
  publishedAt?: string | null;
  effectiveFrom?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdByAdminId?: string | null;
};

export type UserConsent = {
  id: string;
  userId: string;
  documentId: string;
  documentType: string;
  documentVersion: string;
  documentTitle: string;
  documentContentHash: string;
  acceptedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  source: string;
  isRequired: boolean;
  isActive: boolean;
  revokedAt?: string | null;
  revocationReason?: string | null;
  createdAt: string;
};

export type UserConsentStatus = {
  document: LegalDocument;
  consent?: UserConsent | null;
  status: "accepted" | "required" | "needs_new_version" | "revoked" | "optional";
};

export type LegalExportPayload = {
  fileName: string;
  sheets?: Array<{ name: string; rows: Array<Array<string | number | boolean | null | undefined>> }>;
  files?: Array<{ path: string; data: string }>;
};

export type KnowledgeArticle = {
  id: string;
  audience: string;
  title: string;
  slug: string;
  content: string;
  category: string;
  isPublished: boolean;
  sortOrder: number;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  moderationStatus: string;
  isHidden: boolean;
  isSystem?: boolean;
  visibility?: string;
  createdAt: string;
  sender?: Pick<User, "id" | "displayName" | "role">;
};

export type AgreedTerms = {
  agreedHelperAmount: number;
  customerServiceFeeAmount: number;
  helperServiceFeeAmount: number;
  customerTotalAmount: number;
  helperNetAmount: number;
  agreedPackageId?: string | null;
  agreedPackageTitle?: string | null;
  agreedAddons: string[];
  agreedDurationMinutes?: number | null;
  agreedScheduledAt?: string | null;
  agreedTermsComment?: string | null;
  agreedByCustomerAt?: string | null;
  agreedByHelperAt?: string | null;
  termsUpdatedAt?: string | null;
  termsUpdatedByUserId?: string | null;
};

export type Chat = {
  id: string;
  requestId: string;
  clientId: string;
  performerId: string;
  status: string;
  clientConfirmedAt?: string | null;
  performerConfirmedAt?: string | null;
  agreementFinalizedAt?: string | null;
  agreedTerms?: AgreedTerms | null;
  conditionsJson?: string | null;
  archivedAt?: string | null;
  exactAddressVisible: boolean;
  phoneVisible: boolean;
  request: ClientRequest;
  client: Pick<User, "id" | "displayName">;
  performer: Pick<User, "id" | "displayName"> & { performerProfile?: PerformerProfile };
  messages: ChatMessage[];
};

export type BalanceSummary = {
  realBalance: number;
  bonusBalance: number;
  totalAvailableBalance: number;
  serviceCommissionAmount: number;
  clientServiceFeeAmount: number;
  performerServiceFeeAmount: number;
  performerCommissionAmount: number;
  useBonusForCommission: boolean;
  chargeBonusFirst: boolean;
  minTopUpAmount: number;
  transactions: Array<{
    id: string;
    type: string;
    source?: string | null;
    amount: number;
    balanceKind: string;
    reason: string;
    createdAt: string;
  }>;
};

export type TrialBalanceSettings = {
  enabled: boolean;
  amount: number;
  autoGrantNewUsers: boolean;
  lastBulkGrantAt: string | null;
  totals: {
    totalUsers: number;
    usersWithTrialBonus: number;
    eligibleUsers: number;
  };
};

export type TrialBalanceGrantSummary = {
  checked: number;
  granted: number;
  skippedAlreadyGranted: number;
  skippedBlocked: number;
  skippedAdmin: number;
  errors: Array<{ userId: string; message: string }>;
};

export type PaymentTransaction = {
  id: string;
  userId: string;
  provider: string;
  providerPaymentId?: string | null;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  purpose: string;
  description?: string | null;
  paymentUrl?: string | null;
  successUrl?: string | null;
  failUrl?: string | null;
  notificationUrl?: string | null;
  balanceTransactionId?: string | null;
  rawInitRequestJson?: string | null;
  rawInitResponseJson?: string | null;
  metadataJson?: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
  creditedAt?: string | null;
  failedAt?: string | null;
  cancelledAt?: string | null;
};

export type TopUpPaymentInit = Pick<PaymentTransaction, "id" | "orderId" | "amount" | "currency" | "status" | "provider" | "paymentUrl">;

export type PaymentActionResult = {
  payment: PaymentTransaction;
  balance: {
    realBalance: number;
    bonusBalance: number;
    totalAvailableBalance: number;
  };
};

export type AdminPaymentFilters = {
  status?: string;
  provider?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type AdminPaymentUser = Pick<User, "id" | "displayName" | "role" | "phone" | "email">;

export type AdminPaymentListItem = PaymentTransaction & {
  user?: AdminPaymentUser | null;
  userRole?: UserRole;
};

export type BalanceTransaction = {
  id: string;
  userId: string;
  type: string;
  amount: number;
  balanceKind: string;
  reason: string;
  comment?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  bonusExpiresAt?: string | null;
  relatedRequestId?: string | null;
  createdByAdminId?: string | null;
  createdAt: string;
};

export type AdminPaymentDetails = {
  payment: PaymentTransaction & { user?: AdminPaymentUser | null };
  user?: AdminPaymentUser | null;
  balanceTransaction?: BalanceTransaction | null;
  rawInitResponseJson?: string | null;
  rawWebhookJson?: string | null;
};

export type Bootstrap = {
  cities: City[];
  categories: ServiceCategory[];
  settings: {
    defaultCommissionAmount: number;
    defaultMinTopUpAmount: number;
    yandexMapsEnabled: boolean;
    vkIdEnabled: boolean;
    servicePositioning: string;
    medicalServicesForbidden: boolean;
  };
};
