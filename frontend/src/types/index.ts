export type UserRole = "client" | "performer" | "manager" | "admin" | "superadmin" | "oauth_pending";

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

export type CategoryTaskTemplate = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  customerHint?: string | null;
  helperHint?: string | null;
  safetyNote?: string | null;
};

export type StructuredCategory = {
  id: string;
  structureId: string;
  parentId?: string | null;
  slug: string;
  title: string;
  descriptionForCustomer?: string | null;
  descriptionForHelper?: string | null;
  level: number;
  sortOrder: number;
  status: string;
  children?: StructuredCategory[];
  taskTemplates?: CategoryTaskTemplate[];
  safetyRules?: Array<{ id: string; title: string; description: string; severity: string; isBlocking: boolean }>;
  pricingRules?: Array<{ id: string; recommendedMinPrice?: number | null; recommendedMaxPrice?: number | null; defaultDurationMinutes?: number | null; priceComment?: string | null }>;
};

export type CategoryStructure = {
  id: string;
  scopeType: "federal" | "region" | "city";
  scopeRegionId?: string | null;
  scopeCityId?: string | null;
  scopeKey: string;
  parentStructureId?: string | null;
  versionNumber: string;
  title: string;
  description?: string | null;
  status: "draft" | "active" | "archived";
  qualityStatus: "draft" | "estimated" | "reviewed" | "tested" | "approved";
  source: string;
  comment?: string | null;
  publishedAt?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  scopeRegion?: { id: string; name: string; slug: string } | null;
  scopeCity?: City | null;
  parentStructure?: Pick<CategoryStructure, "id" | "title" | "versionNumber" | "scopeType"> | null;
  categories?: StructuredCategory[];
  _count?: { categories: number; requestSnapshots: number };
};

export type CategoryCityStatus = {
  city: Pick<City, "id" | "name" | "slug" | "region"> & { regionId?: string | null };
  region?: { id: string; name: string; slug: string } | null;
  status: "local_ready" | "uses_region_fallback" | "uses_federal_fallback" | "missing_structure";
  statusLabel: string;
  effectiveStructure?: CategoryStructure | null;
  message: string;
};

export type CategoriesForCity = {
  status: CategoryCityStatus["status"];
  statusLabel: string;
  structure: Pick<CategoryStructure, "id" | "scopeType" | "versionNumber" | "title" | "qualityStatus"> | null;
  categories: StructuredCategory[];
  directions?: Array<{
    id: string;
    slug: string;
    title: string;
    subtitle?: string | null;
    safetyRules?: Array<{ id: string; title: string; description: string; severity: string; isBlocking: boolean }>;
    tasks: Array<{
      id: string;
      categoryId: string;
      categorySlug: string;
      categoryTitle: string;
      subcategoryId?: string | null;
      subcategorySlug?: string | null;
      taskTemplateId?: string | null;
      taskTemplateSlug?: string | null;
      slug: string;
      title: string;
      aliases: string[];
    }>;
  }>;
};

export type StructuredRequestPriceQuote = {
  visitCount?: number;
  totalDurationMinutes?: number;
  perVisitHelpAmount?: number | null;
  totalHelpAmount?: number | null;
  customerServiceFeeAmount?: number;
  helperServiceFeeAmount?: number;
  customerServiceFeeTotal?: number;
  helperServiceFeeTotal?: number;
  totalCustomerEstimate?: number | null;
  helperNetEstimate?: number | null;
  unpricedTasks?: Array<{ taskTemplateTitle: string }>;
  expandedVisits?: Array<{
    id: string;
    sequence: number;
    date: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    calculatedEndTime?: string;
    calculatedHelpPrice?: number | null;
    calculatedSubtotal?: number;
    helpAmount?: number | null;
    customerServiceFee?: number;
    helperServiceFee?: number;
    pricingBreakdown?: unknown[];
    unpricedTasks?: Array<{ taskTemplateTitle?: string; subcategoryTitle?: string }>;
  }>;
  baseRange: { min: number | null; max: number | null } | null;
  calculatedRecommendedPrice: number | null;
  additionalTask: {
    category: { id: string; slug: string; title: string };
    subcategory?: { id: string; slug: string; title: string } | null;
    taskTemplate?: { id: string; slug: string; title: string } | null;
    baseRange: { min: number | null; max: number | null } | null;
    calculatedRecommendedPrice: number | null;
  } | null;
  finalCalculatedRecommendedPrice: number | null;
  breakdown: Array<{
    kind: "main" | "additional";
    categoryTitle: string;
    subcategoryTitle?: string | null;
    taskTemplateTitle?: string | null;
    baseRecommendedMinPrice?: number | null;
    baseRecommendedMaxPrice?: number | null;
    calculatedRecommendedPrice: number | null;
    pricingComment?: string | null;
  }>;
  sourceStructure: Pick<CategoryStructure, "id" | "scopeType" | "versionNumber" | "title" | "qualityStatus"> | null;
  sourceMessage?: string;
  fallbackStatus: CategoryCityStatus["status"];
  frequencyCode?: string;
  frequencyTitle?: string;
  userMessage: string;
  warnings: string[];
};

export type HelperCategoryPreference = {
  id: string;
  helperUserId: string;
  cityId?: string | null;
  categoryId: string;
  categorySlug: string;
  isEnabled: boolean;
  comment?: string | null;
  category: StructuredCategory;
  city?: City | null;
};

export type ServiceMessageAttachment = {
  id: string;
  messageId: string;
  userId: string;
  uploadedByUserId: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: string;
  relatedPaymentTransactionId?: string | null;
  relatedRefundTransactionId?: string | null;
  relatedRequestId?: string | null;
  createdAt: string;
  message?: { id: string; title?: string | null; createdAt: string };
  uploadedBy?: { id: string; displayName: string; role: UserRole };
};

export type ServiceMessage = {
  id: string;
  conversationId?: string | null;
  userId: string;
  senderUserId?: string | null;
  senderRole: string;
  messageType: "service_message" | "system_notice" | "announcement" | "marketing_announcement";
  channel: "in_app";
  title?: string | null;
  body: string;
  relatedPaymentTransactionId?: string | null;
  relatedRefundTransactionId?: string | null;
  relatedRequestId?: string | null;
  broadcastId?: string | null;
  isReadByUser: boolean;
  readByUserAt?: string | null;
  createdAt: string;
  attachments: ServiceMessageAttachment[];
  relatedPayment?: Pick<PaymentTransaction, "id" | "orderId" | "amount" | "status" | "provider" | "terminalMode"> | null;
  relatedRefund?: Pick<RefundTransaction, "id" | "amount" | "status" | "paymentTransactionId"> | null;
  relatedRequest?: Pick<ClientRequest, "id" | "publicNumber" | "title"> | null;
};

export type ServiceConversation = {
  id: string;
  userId: string;
  lastMessageAt?: string | null;
  unreadForUserCount: number;
  unreadForAdminCount: number;
  status: string;
  user?: Pick<User, "id" | "displayName" | "role" | "phone" | "email" | "status">;
  messages?: ServiceMessage[];
};

export type ServiceConversationUser = Pick<User, "id" | "displayName" | "role" | "phone" | "normalizedPhone" | "email" | "status"> & {
  city?: { id: string; name: string; region: string } | null;
};

export type ServiceMessageUserSearchResult = ServiceConversationUser & {
  canMessage: boolean;
};

export type BroadcastPreview = {
  totalFound: number;
  willReceive: number;
  skippedNoConsent: number;
  skippedInactive: number;
  roles: Record<string, number>;
  cities: Record<string, number>;
};

export type BroadcastCampaign = {
  id: string;
  title: string;
  body: string;
  campaignType: "service_announcement" | "marketing_announcement" | "system_notice";
  targetRole: "all" | "customer" | "performer" | "manager";
  status: string;
  requireMarketingConsent: boolean;
  recipientsCount: number;
  deliveredCount: number;
  skippedCount: number;
  failedCount: number;
  createdAt: string;
  sentAt?: string | null;
};

export type CategoryExportPayload = {
  fileName: string;
  jsonFileName?: string;
  payload: Record<string, unknown>;
  sheets?: Array<{ name: string; rows: Array<Array<string | number | boolean | null | undefined>> }>;
};

export type CategoryImportPreview = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: Record<string, string | number | undefined>;
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
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string | null;
  registrationSource?: "standard" | "vk" | "vk_pending";
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  phoneVerifiedAt?: string | null;
  emailVerifiedAt?: string | null;
  blockedAt?: string | null;
  blockedByAdminId?: string | null;
  blockedByRole?: UserRole | null;
  blockReason?: string | null;
  roleBeforeManager?: "client" | "performer" | null;
  managerAssignedAt?: string | null;
  managerAssignedByAdminId?: string | null;
  managerRevokedAt?: string | null;
  managerRevokedByAdminId?: string | null;
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

export type OAuthPendingRestoreSafety = {
  canRestore: boolean;
  reasons: string[];
  counts: Record<string, number>;
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
  createdByRole?: string | null;
  createdByManagerId?: string | null;
  cityId: string;
  categoryId: string;
  categorySnapshot?: {
    id: string;
    structureId: string;
    snapshot: {
      category?: { id: string; slug: string; title: string } | null;
      subcategory?: { id: string; slug: string; title: string } | null;
      recommendedPrice?: { min?: number | null; max?: number | null; comment?: string | null } | null;
      safetyRules?: Array<{ title: string; description: string; severity: string; isBlocking: boolean }>;
      cityTitle?: string;
      regionTitle?: string;
      structureTitle?: string;
      structureVersion?: string;
      structureScopeType?: string;
      fallbackStatus?: string;
      frequencyTitle?: string;
      taskTemplateTitle?: string | null;
      calculatedRecommendedPrice?: number | null;
      additionalTaskCategoryTitle?: string | null;
      additionalTaskSubcategoryTitle?: string | null;
      additionalTaskCalculatedPrice?: number | null;
      finalCalculatedRecommendedPrice?: number | null;
      calculationBreakdownJson?: Array<{ kind: string; categoryTitle: string; subcategoryTitle?: string | null; calculatedRecommendedPrice?: number | null }>;
      calculatedAt?: string;
    } | null;
  } | null;
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
  createdByManager?: Pick<User, "id" | "displayName"> | null;
  responseId?: string;
  responseStatus?: string;
  match?: {
    status: "fit" | "partial" | "not_fit";
    label: string;
    reasons: string[];
  } | null;
};

export type PricingQuote = {
  expandedVisits?: Array<{
    id: string;
    sequence: number;
    date: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    agreedHelpAmount?: number | null;
    calculatedHelpPrice?: number | null;
    helpAmount?: number | null;
  }>;
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
  agreementVersion?: {
    id: string;
    version: number;
    status: string;
    selectedTasks: Array<{ taskTemplateTitle?: string; subcategoryTitle?: string; categoryTitle?: string }>;
    expandedVisits: Array<{
      id: string;
      sequence: number;
      date: string;
      startTime: string;
      endTime: string;
      durationMinutes: number;
      timezone: string;
      agreedHelpAmount?: number | null;
      calculatedHelpPrice?: number | null;
      pricingBreakdown?: unknown[];
      unpricedTasks?: unknown[];
    }>;
    visitCount: number;
    totalDurationMinutes: number;
    totalHelpAmount?: number | null;
    customerServiceFeeTotal: number;
    helperServiceFeeTotal: number;
    termsHash: string;
    customerConfirmedAt?: string | null;
    helperConfirmedAt?: string | null;
    finalizedAt?: string | null;
  } | null;
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
    comment?: string | null;
    createdByAdminId?: string | null;
    createdByAdmin?: Pick<User, "id" | "displayName"> | null;
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
  terminalMode?: "test" | "live" | null;
  providerStatus?: string | null;
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
  rawStateResponseJson?: string | null;
  metadataJson?: string | null;
  lastSyncedAt?: string | null;
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

export type PaymentRefreshResult = {
  paymentId: string;
  orderId: string;
  provider: string;
  amount: number;
  status: string;
  creditedAt?: string | null;
  balanceTransactionId?: string | null;
  message: string;
};

export type TbankPaymentSyncResult = {
  synced: true;
  refundDetected: boolean;
  alreadyAccounted?: boolean;
  partialRefund?: boolean;
  manualReview?: boolean;
  message: string;
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
  source?: string | null;
  amount: number;
  balanceKind: string;
  reason: string;
  comment?: string | null;
  metadataJson?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  bonusExpiresAt?: string | null;
  relatedRequestId?: string | null;
  createdByAdminId?: string | null;
  createdByAdmin?: Pick<User, "id" | "displayName"> | null;
  createdAt: string;
};

export type ManagerUserDetails = {
  user: User;
  finance: {
    mainBalance: number;
    bonusBalance: number;
    availableBalance: number;
    balanceTransactions: BalanceTransaction[];
  };
  activity: {
    requestsCount: number;
    responsesCount: number;
    chatsCount: number;
    complaintsCount: number;
    lastActivityAt: string;
  };
};

export type ManagerCreateRequestInput = {
  customerUserId: string;
  cityId: string;
  categoryId: string;
  contactName?: string;
  contactPhone?: string;
  helpFor?: "elderly" | "child" | "limited_mobility" | "home_family" | "other";
  dependentAge?: number;
  title: string;
  description: string;
  addressStreet: string;
  addressHouse: string;
  addressApartment?: string;
  addressEntrance?: string;
  addressFloor?: string;
  addressIntercom?: string;
  addressComment?: string;
  date?: string;
  timeFrom?: string;
  timeTo?: string;
  expectedDurationHours?: number;
  urgency?: "normal" | "urgent" | "regular";
  priceEstimateAmount?: number;
  comment?: string;
};

export type AdminBalanceTransaction = BalanceTransaction & {
  user?: Pick<User, "id" | "displayName" | "role"> | null;
  createdByAdmin?: Pick<User, "id" | "displayName"> | null;
};

export type AdminBalanceAdjustmentInput = {
  wallet: "main" | "bonus";
  direction: "credit" | "debit";
  amount: number;
  reason: "payment_issue" | "goodwill_bonus" | "manual_correction" | "refund" | "penalty_reversal" | "other";
  comment: string;
  clientRequestId: string;
};

export type AdminBalanceAdjustmentResult = {
  user: Pick<User, "id" | "displayName" | "role" | "status" | "balance" | "bonusBalance" | "cityId">;
  transaction: AdminBalanceTransaction;
  idempotent: boolean;
};

export type AdminPaymentDetails = {
  payment: PaymentTransaction & { user?: AdminPaymentUser | null };
  user?: AdminPaymentUser | null;
  balanceTransaction?: BalanceTransaction | null;
  refunds?: RefundTransaction[];
  rawInitResponseJson?: string | null;
  rawStateResponseJson?: string | null;
  rawWebhookJson?: string | null;
};

export type RefundTransaction = {
  id: string;
  paymentTransactionId: string;
  provider: string;
  refundType?: string | null;
  userId?: string | null;
  providerRefundId?: string | null;
  externalRequestId: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  bankRefundDate?: string | null;
  bankReference?: string | null;
  adminComment?: string | null;
  metadataJson?: string | null;
  balanceTransactionId?: string | null;
  createdByAdminId: string;
  createdByAdmin?: Pick<User, "id" | "displayName"> | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  failedAt?: string | null;
};

export type NpdStatus = "pending" | "recorded" | "not_required" | "needs_review";

export type NpdTaxRegisterEntry = {
  id: string;
  operationType: "payment" | "refund" | "service_fee" | "admin_adjustment";
  paymentTransactionId?: string | null;
  refundTransactionId?: string | null;
  balanceTransactionId?: string | null;
  userId: string;
  amount: number;
  operationDate: string;
  title: string;
  description: string;
  copyText: string;
  refundCopyText?: string | null;
  source: "tbank" | "manual_bank";
  isTestOperation: boolean;
  npdStatus: NpdStatus;
  npdRecordedAt?: string | null;
  npdComment?: string | null;
  createdAt: string;
  updatedAt: string;
  user: Pick<User, "id" | "displayName" | "role" | "phone" | "email">;
  npdRecordedByAdmin?: Pick<User, "id" | "displayName"> | null;
  paymentTransaction?: {
    id: string;
    orderId: string;
    providerPaymentId?: string | null;
    provider: string;
    status: string;
    amount: number;
    refunds: Array<{ id: string; providerRefundId?: string | null; status: string; amount: number }>;
  } | null;
  refundTransaction?: {
    id: string;
    providerRefundId?: string | null;
    status: string;
    amount: number;
    reason: string;
    refundType?: string | null;
    bankRefundDate?: string | null;
    bankReference?: string | null;
    adminComment?: string | null;
    payment: { id: string; orderId: string; providerPaymentId?: string | null; amount: number };
  } | null;
};

export type NpdRegisterTotals = {
  paymentsCount: number;
  paymentsAmount: number;
  refundsCount: number;
  refundsAmount: number;
  netAmount: number;
  pendingCount: number;
  recordedCount: number;
  needsReviewCount: number;
  notRequiredCount: number;
};

export type NpdRegisterResponse = {
  from: string;
  to: string;
  totals: NpdRegisterTotals;
  days: Array<{ date: string; totals: NpdRegisterTotals; entries: NpdTaxRegisterEntry[] }>;
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
