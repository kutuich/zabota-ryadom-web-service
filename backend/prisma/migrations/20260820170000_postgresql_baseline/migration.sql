-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'city',
    "region" TEXT NOT NULL,
    "regionId" TEXT,
    "district" TEXT,
    "municipalDistrict" TEXT,
    "fiasId" TEXT,
    "garId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "directoryStatus" TEXT NOT NULL DEFAULT 'directory',
    "serviceStatus" TEXT NOT NULL DEFAULT 'inactive',
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultCommissionAmount" INTEGER NOT NULL DEFAULT 50,
    "minTopUpAmount" INTEGER NOT NULL DEFAULT 150,
    "mapCenterLat" DOUBLE PRECISION NOT NULL,
    "mapCenterLng" DOUBLE PRECISION NOT NULL,
    "mapDefaultRadiusMeters" INTEGER NOT NULL DEFAULT 600,
    "districtsJson" TEXT NOT NULL DEFAULT '[]',
    "localSettingsJson" TEXT NOT NULL DEFAULT '{}',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Yekaterinburg',
    "pricingZone" TEXT NOT NULL DEFAULT 'base_yugorsk',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "rolesJson" TEXT NOT NULL DEFAULT '[]',
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "authTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "temporaryPasswordExpiresAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "passwordResetAt" TIMESTAMP(3),
    "passwordResetByUserId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "displayNameChangedAt" TIMESTAMP(3),
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "cityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "bonusBalance" INTEGER NOT NULL DEFAULT 0,
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerifiedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "blockedAt" TIMESTAMP(3),
    "blockedByAdminId" TEXT,
    "blockedByRole" TEXT,
    "blockReason" TEXT,
    "roleBeforeManager" TEXT,
    "managerAssignedAt" TIMESTAMP(3),
    "managerAssignedByAdminId" TEXT,
    "managerRevokedAt" TIMESTAMP(3),
    "managerRevokedByAdminId" TEXT,
    "archiveRequestedAt" TIMESTAMP(3),
    "archiveRequestedByAdminId" TEXT,
    "archiveReason" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedByAdminId" TEXT,
    "archiveBlockedReason" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "roleScope" TEXT NOT NULL DEFAULT 'both',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "rawProfileJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProfile" (
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "preferredContactMethod" TEXT NOT NULL DEFAULT 'chat',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedRequestsCount" INTEGER NOT NULL DEFAULT 0,
    "complaintsCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PerformerProfile" (
    "userId" TEXT NOT NULL,
    "age" INTEGER,
    "about" TEXT,
    "experience" TEXT,
    "services" TEXT NOT NULL DEFAULT '[]',
    "skills" TEXT NOT NULL DEFAULT '[]',
    "limitations" TEXT,
    "schedule" TEXT,
    "districts" TEXT NOT NULL DEFAULT '[]',
    "canTravelIndependently" BOOLEAN NOT NULL DEFAULT false,
    "canTravelOutsideCity" BOOLEAN NOT NULL DEFAULT false,
    "readyForHygieneHelp" BOOLEAN NOT NULL DEFAULT false,
    "readyForPhysicalHelp" BOOLEAN NOT NULL DEFAULT false,
    "readyForLimitedMobility" BOOLEAN NOT NULL DEFAULT false,
    "readyForChildren" BOOLEAN NOT NULL DEFAULT false,
    "readyForUrgentRequests" BOOLEAN NOT NULL DEFAULT false,
    "readyToProvideDocuments" BOOLEAN NOT NULL DEFAULT false,
    "selfEmployedStatus" TEXT NOT NULL DEFAULT 'self_employed_not_provided',
    "criminalRecordCertificateStatus" TEXT NOT NULL DEFAULT 'criminal_record_not_provided',
    "verificationStatuses" TEXT NOT NULL DEFAULT '["documents_optional"]',
    "childcareApprovalStatus" TEXT NOT NULL DEFAULT 'not_requested',
    "trustLevel" TEXT NOT NULL DEFAULT 'new_profile',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedJobsCount" INTEGER NOT NULL DEFAULT 0,
    "complaintsCount" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "profileComment" TEXT,
    "notes" TEXT,

    CONSTRAINT "PerformerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "includedJson" TEXT NOT NULL DEFAULT '[]',
    "excludedJson" TEXT NOT NULL DEFAULT '[]',
    "complexityJson" TEXT NOT NULL DEFAULT '{}',
    "transferRules" TEXT,
    "medicalProhibitions" TEXT,
    "clientInstructions" TEXT,
    "performerInstructions" TEXT,
    "pricingRulesJson" TEXT NOT NULL DEFAULT '{}',
    "basePrice" INTEGER NOT NULL DEFAULT 0,
    "calculationUnit" TEXT NOT NULL DEFAULT 'hour',
    "minDurationHours" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isChildcare" BOOLEAN NOT NULL DEFAULT false,
    "requiresCriminalRecord" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryStructure" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeRegionId" TEXT,
    "scopeCityId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "parentStructureId" TEXT,
    "versionNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "qualityStatus" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdByAdminId" TEXT,
    "publishedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "emergencyDisabledAt" TIMESTAMP(3),
    "emergencyDisabledByAdminId" TEXT,
    "emergencyDisableReason" TEXT,
    "comment" TEXT,
    "importFileName" TEXT,
    "importHash" TEXT,
    "metadataJson" TEXT,
    "schemaVersion" TEXT NOT NULL DEFAULT '2',

    CONSTRAINT "CategoryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceNode" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "parentId" TEXT,
    "slug" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL DEFAULT 'task',
    "title" TEXT NOT NULL,
    "descriptionForCustomer" TEXT,
    "descriptionForHelper" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSelectable" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "selectionMode" TEXT NOT NULL DEFAULT 'multiple',
    "aliasesJson" TEXT NOT NULL DEFAULT '[]',
    "formFieldsJson" TEXT NOT NULL DEFAULT '[]',
    "constraintsJson" TEXT NOT NULL DEFAULT '{}',
    "durationEffectJson" TEXT NOT NULL DEFAULT '{}',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceNodeRelation" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "sourceNodeId" TEXT,
    "targetNodeId" TEXT,
    "sourceSlug" TEXT NOT NULL,
    "targetSlug" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "conditionsJson" TEXT NOT NULL DEFAULT '{}',
    "pricingBehavior" TEXT,
    "uiBehavior" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceNodeRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceNodePricingRule" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "nodeId" TEXT,
    "nodeSlug" TEXT NOT NULL,
    "packageCode" TEXT,
    "coveredNodeSlugsJson" TEXT NOT NULL DEFAULT '[]',
    "recommendedMinPrice" INTEGER,
    "recommendedMaxPrice" INTEGER,
    "defaultDurationMinutes" INTEGER,
    "priceComment" TEXT,
    "conditionsJson" TEXT NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceNodePricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceNodeSafetyRule" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "nodeId" TEXT,
    "nodeSlug" TEXT,
    "ruleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "applicabilityJson" TEXT NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceNodeSafetyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "parentId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortTitle" TEXT,
    "descriptionForCustomer" TEXT,
    "descriptionForHelper" TEXT,
    "descriptionForManager" TEXT,
    "descriptionForAdmin" TEXT,
    "icon" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isVisibleForCustomer" BOOLEAN NOT NULL DEFAULT true,
    "isVisibleForHelper" BOOLEAN NOT NULL DEFAULT true,
    "isVisibleForManager" BOOLEAN NOT NULL DEFAULT true,
    "isVisibleForAdmin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryTaskTemplate" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "customerHint" TEXT,
    "helperHint" TEXT,
    "managerHint" TEXT,
    "safetyNote" TEXT,
    "taskKind" TEXT NOT NULL DEFAULT 'standard',
    "aliasesJson" TEXT NOT NULL DEFAULT '[]',
    "durationEffectJson" TEXT NOT NULL DEFAULT '{}',
    "priceEffectJson" TEXT NOT NULL DEFAULT '{}',
    "requiresComment" BOOLEAN NOT NULL DEFAULT false,
    "allowedRegionsJson" TEXT NOT NULL DEFAULT '[]',
    "formFieldsJson" TEXT NOT NULL DEFAULT '[]',
    "recommendationsJson" TEXT NOT NULL DEFAULT '[]',
    "constraintsJson" TEXT NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryTaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategorySafetyRule" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "applicabilityJson" TEXT NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showToCustomer" BOOLEAN NOT NULL DEFAULT true,
    "showToHelper" BOOLEAN NOT NULL DEFAULT true,
    "showToManager" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategorySafetyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryPricingRule" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "taskTemplateId" TEXT,
    "recommendedPackageCode" TEXT,
    "recommendedMinPrice" INTEGER,
    "recommendedMaxPrice" INTEGER,
    "defaultDurationMinutes" INTEGER,
    "priceComment" TEXT,
    "coveredTaskSlugsJson" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryPricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelperCategoryPreference" (
    "id" TEXT NOT NULL,
    "helperUserId" TEXT NOT NULL,
    "cityId" TEXT,
    "categoryId" TEXT NOT NULL,
    "categorySlug" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelperCategoryPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestCategorySnapshot" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "categoryId" TEXT,
    "subcategoryId" TEXT,
    "taskTemplateId" TEXT,
    "snapshotJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestCategorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRequest" (
    "id" TEXT NOT NULL,
    "publicNumber" TEXT,
    "seedKey" TEXT,
    "clientId" TEXT NOT NULL,
    "createdByRole" TEXT,
    "createdByManagerId" TEXT,
    "cityId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "helpFor" TEXT,
    "additionalActionsJson" TEXT NOT NULL DEFAULT '[]',
    "dependentStateJson" TEXT NOT NULL DEFAULT '[]',
    "dependentAge" INTEGER,
    "scheduleType" TEXT NOT NULL DEFAULT 'once',
    "regularPeriod" TEXT,
    "repeatedVisitsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "addressText" TEXT NOT NULL,
    "approximateAddressText" TEXT NOT NULL,
    "addressCity" TEXT,
    "addressStreet" TEXT,
    "addressHouse" TEXT,
    "addressApartment" TEXT,
    "addressEntrance" TEXT,
    "addressFloor" TEXT,
    "addressIntercom" TEXT,
    "addressComment" TEXT,
    "fullAddress" TEXT,
    "publicAddress" TEXT,
    "yandexPublicMapAddress" TEXT,
    "yandexExactMapAddress" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "approximateLat" DOUBLE PRECISION,
    "approximateLng" DOUBLE PRECISION,
    "mapPrivacyRadiusMeters" INTEGER NOT NULL DEFAULT 600,
    "district" TEXT,
    "date" TIMESTAMP(3),
    "timeFrom" TEXT,
    "timeTo" TEXT,
    "expectedDurationHours" DOUBLE PRECISION,
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "hasElderlyPerson" BOOLEAN NOT NULL DEFAULT false,
    "hasChild" BOOLEAN NOT NULL DEFAULT false,
    "hasLimitedMobility" BOOLEAN NOT NULL DEFAULT false,
    "physicalHelpLevel" TEXT,
    "needsCooking" BOOLEAN NOT NULL DEFAULT false,
    "needsCleaning" BOOLEAN NOT NULL DEFAULT false,
    "needsWalk" BOOLEAN NOT NULL DEFAULT false,
    "needsHygieneHelp" BOOLEAN NOT NULL DEFAULT false,
    "hasPets" BOOLEAN NOT NULL DEFAULT false,
    "budgetAmount" INTEGER,
    "priceEstimateAmount" INTEGER,
    "pricingBreakdownJson" TEXT,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibilityStatus" TEXT NOT NULL DEFAULT 'private',
    "selectedPerformerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "isHiddenFromPerformers" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" TEXT,
    "structureUpdatePendingAt" TIMESTAMP(3),

    CONSTRAINT "ClientRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT,
    "structureId" TEXT,
    "convertedRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "title" TEXT,
    "formDataJson" TEXT NOT NULL DEFAULT '{}',
    "selectedNodeSlugsJson" TEXT NOT NULL DEFAULT '[]',
    "expandedNodeSlugsJson" TEXT NOT NULL DEFAULT '[]',
    "dynamicFieldValuesJson" TEXT NOT NULL DEFAULT '{}',
    "scheduleDraftJson" TEXT NOT NULL DEFAULT '{}',
    "addressDraftJson" TEXT NOT NULL DEFAULT '{}',
    "beneficiaryDraftJson" TEXT NOT NULL DEFAULT '{}',
    "structureVersionsJson" TEXT NOT NULL DEFAULT '[]',
    "latestQuoteJson" TEXT,
    "validationStateJson" TEXT NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastAutosavedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestDraftRevision" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "changeSource" TEXT NOT NULL DEFAULT 'autosave',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestDraftRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestDraftSupportCase" (
    "id" TEXT NOT NULL,
    "publicNumber" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assignedManagerId" TEXT,
    "relatedServiceConversationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "subject" TEXT NOT NULL,
    "initialMessage" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "source" TEXT NOT NULL DEFAULT 'request_draft',
    "snapshotAtCreationJson" TEXT NOT NULL,
    "draftRevisionAtCreation" INTEGER NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestDraftSupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestStructureUpdateRevision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "targetStructureId" TEXT NOT NULL,
    "previousSnapshotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_customer_confirmation',
    "previousSnapshotJson" TEXT NOT NULL,
    "proposedSnapshotJson" TEXT NOT NULL,
    "comparisonJson" TEXT NOT NULL DEFAULT '{}',
    "initiatedByAdminId" TEXT NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerConfirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByAdminId" TEXT,
    "cancellationReason" TEXT,
    "appliedSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestStructureUpdateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestResponse" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "performerId" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "notAgreedAt" TIMESTAMP(3),
    "finalRejectedAt" TIMESTAMP(3),
    "newTermsOfferedAt" TIMESTAMP(3),

    CONSTRAINT "RequestResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "responseId" TEXT,
    "clientId" TEXT NOT NULL,
    "performerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "clientConfirmedAt" TIMESTAMP(3),
    "performerConfirmedAt" TIMESTAMP(3),
    "agreedHelperAmount" INTEGER,
    "customerServiceFeeAmount" INTEGER,
    "helperServiceFeeAmount" INTEGER,
    "customerTotalAmount" INTEGER,
    "helperNetAmount" INTEGER,
    "agreedPackageId" TEXT,
    "agreedPackageTitle" TEXT,
    "agreedAddonsJson" TEXT,
    "agreedDurationMinutes" INTEGER,
    "agreedScheduledAt" TIMESTAMP(3),
    "agreedTermsComment" TEXT,
    "agreedByCustomerAt" TIMESTAMP(3),
    "agreedByHelperAt" TIMESTAMP(3),
    "termsUpdatedAt" TIMESTAMP(3),
    "termsUpdatedByUserId" TEXT,
    "agreementFinalizedAt" TIMESTAMP(3),
    "structureTermsStaleAt" TIMESTAMP(3),
    "conditionsJson" TEXT,
    "notAgreedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementVersion" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "recipientType" TEXT,
    "dependentSnapshotJson" TEXT,
    "selectedTasksJson" TEXT NOT NULL,
    "scheduleRulesJson" TEXT NOT NULL,
    "expandedVisitsJson" TEXT NOT NULL,
    "pricingSnapshotJson" TEXT NOT NULL,
    "termsComment" TEXT,
    "visitCount" INTEGER NOT NULL,
    "totalDurationMinutes" INTEGER NOT NULL,
    "totalHelpAmount" INTEGER,
    "customerServiceFeeTotal" INTEGER NOT NULL,
    "helperServiceFeeTotal" INTEGER NOT NULL,
    "termsHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "customerConfirmedAt" TIMESTAMP(3),
    "helperConfirmedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgreementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementContract" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "agreementVersionId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'project',
    "title" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'text/plain; charset=utf-8',
    "fileSize" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestVisit" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "agreementVersionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "tasksSnapshotJson" TEXT NOT NULL,
    "pricingBreakdownJson" TEXT NOT NULL DEFAULT '{}',
    "helpAmount" INTEGER,
    "customerServiceFeeAmount" INTEGER NOT NULL,
    "helperServiceFeeAmount" INTEGER NOT NULL,
    "autoCloseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceFeeAgreementBatch" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "agreementVersionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "helperId" TEXT NOT NULL,
    "visitCount" INTEGER NOT NULL,
    "customerServiceFeeTotal" INTEGER NOT NULL,
    "helperServiceFeeTotal" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "idempotencyKey" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceFeeAgreementBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceFeeVisitAllocation" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feeAmount" INTEGER NOT NULL,
    "mainBalanceAmount" INTEGER NOT NULL DEFAULT 0,
    "bonusBalanceAmount" INTEGER NOT NULL DEFAULT 0,
    "sourceLedgerEntriesJson" TEXT NOT NULL DEFAULT '[]',
    "refundLedgerEntriesJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "resolution" TEXT,
    "resolutionComment" TEXT,
    "releasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceFeeVisitAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestVisitDispute" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolutionComment" TEXT,
    "resolvedByAdminId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestVisitDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "senderId" TEXT,
    "text" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'all',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "moderationStatus" TEXT NOT NULL DEFAULT 'clean',
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT,
    "idempotencyKey" TEXT,
    "amount" INTEGER NOT NULL,
    "balanceKind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "metadataJson" TEXT,
    "balanceBefore" INTEGER,
    "balanceAfter" INTEGER,
    "bonusExpiresAt" TIMESTAMP(3),
    "relatedRequestId" TEXT,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "terminalMode" TEXT,
    "providerPaymentId" TEXT,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "status" TEXT NOT NULL,
    "providerStatus" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'balance_top_up',
    "description" TEXT,
    "paymentUrl" TEXT,
    "successUrl" TEXT,
    "failUrl" TEXT,
    "notificationUrl" TEXT,
    "balanceTransactionId" TEXT,
    "rawInitRequestJson" TEXT,
    "rawInitResponseJson" TEXT,
    "rawStateResponseJson" TEXT,
    "rawWebhookJson" TEXT,
    "metadataJson" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundTransaction" (
    "id" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "refundType" TEXT,
    "userId" TEXT,
    "providerRefundId" TEXT,
    "externalRequestId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "status" TEXT NOT NULL DEFAULT 'processing',
    "reason" TEXT NOT NULL,
    "bankRefundDate" TIMESTAMP(3),
    "bankReference" TEXT,
    "adminComment" TEXT,
    "rawRequestJson" TEXT,
    "rawResponseJson" TEXT,
    "metadataJson" TEXT,
    "balanceTransactionId" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "RefundTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpdTaxRegisterEntry" (
    "id" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "paymentTransactionId" TEXT,
    "refundTransactionId" TEXT,
    "balanceTransactionId" TEXT,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "operationDate" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "copyText" TEXT NOT NULL,
    "refundCopyText" TEXT,
    "source" TEXT NOT NULL,
    "isTestOperation" BOOLEAN NOT NULL DEFAULT false,
    "npdStatus" TEXT NOT NULL DEFAULT 'pending',
    "npdRecordedAt" TIMESTAMP(3),
    "npdRecordedByAdminId" TEXT,
    "npdComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpdTaxRegisterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "publicNumber" TEXT,
    "type" TEXT NOT NULL DEFAULT 'complaint',
    "requestId" TEXT,
    "chatId" TEXT,
    "fromUserId" TEXT NOT NULL,
    "againstUserId" TEXT,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "adminComment" TEXT,
    "adminResponse" TEXT,
    "isVisibleToUser" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRiskFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "UserRiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "likedText" TEXT,
    "improvementText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "payloadJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "unreadForUserCount" INTEGER NOT NULL DEFAULT 0,
    "unreadForAdminCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadataJson" TEXT,

    CONSTRAINT "ServiceConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceMessage" (
    "id" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "conversationId" TEXT,
    "userId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderRole" TEXT NOT NULL,
    "messageType" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "title" TEXT,
    "body" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "relatedPaymentTransactionId" TEXT,
    "relatedRefundTransactionId" TEXT,
    "relatedRequestId" TEXT,
    "relatedLegalDocumentId" TEXT,
    "relatedRequestDraftSupportCaseId" TEXT,
    "broadcastId" TEXT,
    "isReadByUser" BOOLEAN NOT NULL DEFAULT false,
    "readByUserAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" TEXT,

    CONSTRAINT "ServiceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastCampaign" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "campaignType" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL DEFAULT 'all',
    "targetCityId" TEXT,
    "targetRegionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByAdminId" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "requireMarketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "recipientsCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "metadataJson" TEXT,

    CONSTRAINT "BroadcastCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "serviceMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceMessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "publicUrl" TEXT,
    "attachmentType" TEXT NOT NULL DEFAULT 'other',
    "relatedPaymentTransactionId" TEXT,
    "relatedRefundTransactionId" TEXT,
    "relatedRequestId" TEXT,
    "relatedLegalDocumentId" TEXT,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" TEXT,

    CONSTRAINT "ServiceMessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "roleScope" TEXT NOT NULL DEFAULT 'all',
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" TEXT,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "documentTitle" TEXT NOT NULL,
    "documentContentHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "source" TEXT NOT NULL DEFAULT 'profile',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsentAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "documentType" TEXT,
    "documentVersion" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,

    CONSTRAINT "UserConsentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentExportLog" (
    "id" TEXT NOT NULL,
    "exportedByAdminId" TEXT,
    "exportType" TEXT NOT NULL,
    "userId" TEXT,
    "fileName" TEXT NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "comment" TEXT,

    CONSTRAINT "ConsentExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformerDocument" (
    "id" TEXT NOT NULL,
    "performerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "originalFileName" TEXT,
    "storagePath" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "checksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "adminComment" TEXT,

    CONSTRAINT "PerformerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceSetting" (
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'general',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'all',
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_slug_key" ON "Region"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "City_fiasId_key" ON "City"("fiasId");

-- CreateIndex
CREATE UNIQUE INDEX "City_garId_key" ON "City"("garId");

-- CreateIndex
CREATE INDEX "City_isActive_idx" ON "City"("isActive");

-- CreateIndex
CREATE INDEX "City_normalizedName_idx" ON "City"("normalizedName");

-- CreateIndex
CREATE INDEX "City_region_idx" ON "City"("region");

-- CreateIndex
CREATE INDEX "City_regionId_idx" ON "City"("regionId");

-- CreateIndex
CREATE INDEX "City_directoryStatus_serviceStatus_idx" ON "City"("directoryStatus", "serviceStatus");

-- CreateIndex
CREATE INDEX "City_activatedByUserId_idx" ON "City"("activatedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedPhone_key" ON "User"("normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_cityId_idx" ON "User"("cityId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_blockedByAdminId_idx" ON "User"("blockedByAdminId");

-- CreateIndex
CREATE INDEX "User_managerAssignedByAdminId_idx" ON "User"("managerAssignedByAdminId");

-- CreateIndex
CREATE INDEX "User_archiveRequestedAt_idx" ON "User"("archiveRequestedAt");

-- CreateIndex
CREATE INDEX "User_archivedAt_idx" ON "User"("archivedAt");

-- CreateIndex
CREATE INDEX "UserCity_userId_isPrimary_isActive_idx" ON "UserCity"("userId", "isPrimary", "isActive");

-- CreateIndex
CREATE INDEX "UserCity_cityId_roleScope_isActive_idx" ON "UserCity"("cityId", "roleScope", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserCity_userId_cityId_key" ON "UserCity"("userId", "cityId");

-- CreateIndex
CREATE INDEX "UserIdentity_userId_idx" ON "UserIdentity"("userId");

-- CreateIndex
CREATE INDEX "UserIdentity_provider_idx" ON "UserIdentity"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_provider_providerUserId_key" ON "UserIdentity"("provider", "providerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_slug_key" ON "ServiceCategory"("slug");

-- CreateIndex
CREATE INDEX "ServiceCategory_isActive_idx" ON "ServiceCategory"("isActive");

-- CreateIndex
CREATE INDEX "CategoryStructure_scopeType_status_idx" ON "CategoryStructure"("scopeType", "status");

-- CreateIndex
CREATE INDEX "CategoryStructure_scopeRegionId_status_idx" ON "CategoryStructure"("scopeRegionId", "status");

-- CreateIndex
CREATE INDEX "CategoryStructure_scopeCityId_status_idx" ON "CategoryStructure"("scopeCityId", "status");

-- CreateIndex
CREATE INDEX "CategoryStructure_parentStructureId_idx" ON "CategoryStructure"("parentStructureId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryStructure_scopeKey_versionNumber_key" ON "CategoryStructure"("scopeKey", "versionNumber");

-- CreateIndex
CREATE INDEX "ServiceNode_structureId_parentId_sortOrder_idx" ON "ServiceNode"("structureId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "ServiceNode_structureId_nodeType_isActive_idx" ON "ServiceNode"("structureId", "nodeType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceNode_structureId_slug_key" ON "ServiceNode"("structureId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceNode_structureId_stableKey_key" ON "ServiceNode"("structureId", "stableKey");

-- CreateIndex
CREATE INDEX "ServiceNodeRelation_structureId_relationType_isActive_idx" ON "ServiceNodeRelation"("structureId", "relationType", "isActive");

-- CreateIndex
CREATE INDEX "ServiceNodeRelation_sourceNodeId_isActive_idx" ON "ServiceNodeRelation"("sourceNodeId", "isActive");

-- CreateIndex
CREATE INDEX "ServiceNodeRelation_targetNodeId_isActive_idx" ON "ServiceNodeRelation"("targetNodeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceNodeRelation_structureId_sourceSlug_targetSlug_relat_key" ON "ServiceNodeRelation"("structureId", "sourceSlug", "targetSlug", "relationType");

-- CreateIndex
CREATE INDEX "ServiceNodePricingRule_structureId_isActive_idx" ON "ServiceNodePricingRule"("structureId", "isActive");

-- CreateIndex
CREATE INDEX "ServiceNodePricingRule_nodeId_isActive_idx" ON "ServiceNodePricingRule"("nodeId", "isActive");

-- CreateIndex
CREATE INDEX "ServiceNodeSafetyRule_structureId_isActive_sortOrder_idx" ON "ServiceNodeSafetyRule"("structureId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "ServiceNodeSafetyRule_nodeId_isActive_idx" ON "ServiceNodeSafetyRule"("nodeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceNodeSafetyRule_structureId_ruleKey_key" ON "ServiceNodeSafetyRule"("structureId", "ruleKey");

-- CreateIndex
CREATE INDEX "Category_structureId_parentId_sortOrder_idx" ON "Category"("structureId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_status_idx" ON "Category"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Category_structureId_slug_key" ON "Category"("structureId", "slug");

-- CreateIndex
CREATE INDEX "CategoryTaskTemplate_categoryId_isActive_sortOrder_idx" ON "CategoryTaskTemplate"("categoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryTaskTemplate_categoryId_slug_key" ON "CategoryTaskTemplate"("categoryId", "slug");

-- CreateIndex
CREATE INDEX "CategorySafetyRule_categoryId_sortOrder_idx" ON "CategorySafetyRule"("categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "CategorySafetyRule_categoryId_ruleKey_isActive_idx" ON "CategorySafetyRule"("categoryId", "ruleKey", "isActive");

-- CreateIndex
CREATE INDEX "CategoryPricingRule_categoryId_isActive_idx" ON "CategoryPricingRule"("categoryId", "isActive");

-- CreateIndex
CREATE INDEX "CategoryPricingRule_taskTemplateId_isActive_idx" ON "CategoryPricingRule"("taskTemplateId", "isActive");

-- CreateIndex
CREATE INDEX "HelperCategoryPreference_helperUserId_cityId_isEnabled_idx" ON "HelperCategoryPreference"("helperUserId", "cityId", "isEnabled");

-- CreateIndex
CREATE INDEX "HelperCategoryPreference_categorySlug_idx" ON "HelperCategoryPreference"("categorySlug");

-- CreateIndex
CREATE UNIQUE INDEX "HelperCategoryPreference_helperUserId_cityId_categoryId_key" ON "HelperCategoryPreference"("helperUserId", "cityId", "categoryId");

-- CreateIndex
CREATE INDEX "RequestCategorySnapshot_requestId_createdAt_idx" ON "RequestCategorySnapshot"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestCategorySnapshot_structureId_idx" ON "RequestCategorySnapshot"("structureId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRequest_seedKey_key" ON "ClientRequest"("seedKey");

-- CreateIndex
CREATE INDEX "ClientRequest_cityId_status_idx" ON "ClientRequest"("cityId", "status");

-- CreateIndex
CREATE INDEX "ClientRequest_publicNumber_idx" ON "ClientRequest"("publicNumber");

-- CreateIndex
CREATE INDEX "ClientRequest_clientId_idx" ON "ClientRequest"("clientId");

-- CreateIndex
CREATE INDEX "ClientRequest_createdByManagerId_idx" ON "ClientRequest"("createdByManagerId");

-- CreateIndex
CREATE INDEX "ClientRequest_selectedPerformerId_idx" ON "ClientRequest"("selectedPerformerId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestDraft_convertedRequestId_key" ON "RequestDraft"("convertedRequestId");

-- CreateIndex
CREATE INDEX "RequestDraft_userId_status_updatedAt_idx" ON "RequestDraft"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "RequestDraft_cityId_status_idx" ON "RequestDraft"("cityId", "status");

-- CreateIndex
CREATE INDEX "RequestDraft_structureId_idx" ON "RequestDraft"("structureId");

-- CreateIndex
CREATE INDEX "RequestDraftRevision_draftId_createdAt_idx" ON "RequestDraftRevision"("draftId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestDraftRevision_draftId_revision_key" ON "RequestDraftRevision"("draftId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "RequestDraftSupportCase_publicNumber_key" ON "RequestDraftSupportCase"("publicNumber");

-- CreateIndex
CREATE INDEX "RequestDraftSupportCase_clientId_status_updatedAt_idx" ON "RequestDraftSupportCase"("clientId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "RequestDraftSupportCase_assignedManagerId_status_idx" ON "RequestDraftSupportCase"("assignedManagerId", "status");

-- CreateIndex
CREATE INDEX "RequestDraftSupportCase_draftId_createdAt_idx" ON "RequestDraftSupportCase"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestStructureUpdateRevision_requestId_status_idx" ON "RequestStructureUpdateRevision"("requestId", "status");

-- CreateIndex
CREATE INDEX "RequestStructureUpdateRevision_targetStructureId_status_idx" ON "RequestStructureUpdateRevision"("targetStructureId", "status");

-- CreateIndex
CREATE INDEX "RequestResponse_performerId_status_idx" ON "RequestResponse"("performerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RequestResponse_requestId_performerId_key" ON "RequestResponse"("requestId", "performerId");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_responseId_key" ON "Chat"("responseId");

-- CreateIndex
CREATE INDEX "Chat_clientId_idx" ON "Chat"("clientId");

-- CreateIndex
CREATE INDEX "Chat_performerId_idx" ON "Chat"("performerId");

-- CreateIndex
CREATE INDEX "AgreementVersion_requestId_status_idx" ON "AgreementVersion"("requestId", "status");

-- CreateIndex
CREATE INDEX "AgreementVersion_chatId_status_idx" ON "AgreementVersion"("chatId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementVersion_chatId_version_key" ON "AgreementVersion"("chatId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementContract_agreementVersionId_key" ON "AgreementContract"("agreementVersionId");

-- CreateIndex
CREATE INDEX "AgreementContract_requestId_createdAt_idx" ON "AgreementContract"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "AgreementContract_checksum_idx" ON "AgreementContract"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementContract_chatId_documentVersion_key" ON "AgreementContract"("chatId", "documentVersion");

-- CreateIndex
CREATE INDEX "RequestVisit_requestId_scheduledStart_idx" ON "RequestVisit"("requestId", "scheduledStart");

-- CreateIndex
CREATE INDEX "RequestVisit_status_autoCloseAt_idx" ON "RequestVisit"("status", "autoCloseAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestVisit_agreementVersionId_sequence_key" ON "RequestVisit"("agreementVersionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceFeeAgreementBatch_agreementVersionId_key" ON "ServiceFeeAgreementBatch"("agreementVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceFeeAgreementBatch_idempotencyKey_key" ON "ServiceFeeAgreementBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ServiceFeeAgreementBatch_requestId_status_idx" ON "ServiceFeeAgreementBatch"("requestId", "status");

-- CreateIndex
CREATE INDEX "ServiceFeeAgreementBatch_chatId_idx" ON "ServiceFeeAgreementBatch"("chatId");

-- CreateIndex
CREATE INDEX "ServiceFeeVisitAllocation_userId_status_idx" ON "ServiceFeeVisitAllocation"("userId", "status");

-- CreateIndex
CREATE INDEX "ServiceFeeVisitAllocation_batchId_status_idx" ON "ServiceFeeVisitAllocation"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceFeeVisitAllocation_visitId_side_key" ON "ServiceFeeVisitAllocation"("visitId", "side");

-- CreateIndex
CREATE INDEX "RequestVisitDispute_requestId_status_idx" ON "RequestVisitDispute"("requestId", "status");

-- CreateIndex
CREATE INDEX "RequestVisitDispute_visitId_status_idx" ON "RequestVisitDispute"("visitId", "status");

-- CreateIndex
CREATE INDEX "ChatMessage_chatId_createdAt_idx" ON "ChatMessage"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_senderId_idx" ON "ChatMessage"("senderId");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceTransaction_idempotencyKey_key" ON "BalanceTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BalanceTransaction_userId_createdAt_idx" ON "BalanceTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BalanceTransaction_type_idx" ON "BalanceTransaction"("type");

-- CreateIndex
CREATE INDEX "BalanceTransaction_createdByAdminId_idx" ON "BalanceTransaction"("createdByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_providerPaymentId_key" ON "PaymentTransaction"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_orderId_key" ON "PaymentTransaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_balanceTransactionId_key" ON "PaymentTransaction"("balanceTransactionId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_userId_idx" ON "PaymentTransaction"("userId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_provider_idx" ON "PaymentTransaction"("provider");

-- CreateIndex
CREATE INDEX "PaymentTransaction_terminalMode_idx" ON "PaymentTransaction"("terminalMode");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_idx" ON "PaymentTransaction"("status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_createdAt_idx" ON "PaymentTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_orderId_idx" ON "PaymentTransaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundTransaction_paymentTransactionId_key" ON "RefundTransaction"("paymentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundTransaction_externalRequestId_key" ON "RefundTransaction"("externalRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundTransaction_balanceTransactionId_key" ON "RefundTransaction"("balanceTransactionId");

-- CreateIndex
CREATE INDEX "RefundTransaction_provider_idx" ON "RefundTransaction"("provider");

-- CreateIndex
CREATE INDEX "RefundTransaction_refundType_idx" ON "RefundTransaction"("refundType");

-- CreateIndex
CREATE INDEX "RefundTransaction_userId_idx" ON "RefundTransaction"("userId");

-- CreateIndex
CREATE INDEX "RefundTransaction_status_idx" ON "RefundTransaction"("status");

-- CreateIndex
CREATE INDEX "RefundTransaction_createdAt_idx" ON "RefundTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "RefundTransaction_createdByAdminId_idx" ON "RefundTransaction"("createdByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "NpdTaxRegisterEntry_paymentTransactionId_key" ON "NpdTaxRegisterEntry"("paymentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "NpdTaxRegisterEntry_refundTransactionId_key" ON "NpdTaxRegisterEntry"("refundTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "NpdTaxRegisterEntry_balanceTransactionId_key" ON "NpdTaxRegisterEntry"("balanceTransactionId");

-- CreateIndex
CREATE INDEX "NpdTaxRegisterEntry_operationDate_idx" ON "NpdTaxRegisterEntry"("operationDate");

-- CreateIndex
CREATE INDEX "NpdTaxRegisterEntry_npdStatus_operationDate_idx" ON "NpdTaxRegisterEntry"("npdStatus", "operationDate");

-- CreateIndex
CREATE INDEX "NpdTaxRegisterEntry_userId_operationDate_idx" ON "NpdTaxRegisterEntry"("userId", "operationDate");

-- CreateIndex
CREATE INDEX "NpdTaxRegisterEntry_operationType_idx" ON "NpdTaxRegisterEntry"("operationType");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_publicNumber_key" ON "Complaint"("publicNumber");

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE INDEX "Complaint_fromUserId_idx" ON "Complaint"("fromUserId");

-- CreateIndex
CREATE INDEX "Complaint_againstUserId_idx" ON "Complaint"("againstUserId");

-- CreateIndex
CREATE INDEX "UserRiskFlag_userId_resolvedAt_idx" ON "UserRiskFlag"("userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "UserRiskFlag_type_idx" ON "UserRiskFlag"("type");

-- CreateIndex
CREATE INDEX "Review_toUserId_idx" ON "Review"("toUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_requestId_fromUserId_toUserId_key" ON "Review"("requestId", "fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceConversation_userId_key" ON "ServiceConversation"("userId");

-- CreateIndex
CREATE INDEX "ServiceConversation_lastMessageAt_idx" ON "ServiceConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "ServiceConversation_status_idx" ON "ServiceConversation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceMessage_clientRequestId_key" ON "ServiceMessage"("clientRequestId");

-- CreateIndex
CREATE INDEX "ServiceMessage_userId_createdAt_idx" ON "ServiceMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceMessage_conversationId_createdAt_idx" ON "ServiceMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceMessage_messageType_idx" ON "ServiceMessage"("messageType");

-- CreateIndex
CREATE INDEX "ServiceMessage_broadcastId_idx" ON "ServiceMessage"("broadcastId");

-- CreateIndex
CREATE INDEX "ServiceMessage_relatedPaymentTransactionId_idx" ON "ServiceMessage"("relatedPaymentTransactionId");

-- CreateIndex
CREATE INDEX "ServiceMessage_relatedRefundTransactionId_idx" ON "ServiceMessage"("relatedRefundTransactionId");

-- CreateIndex
CREATE INDEX "ServiceMessage_relatedRequestId_idx" ON "ServiceMessage"("relatedRequestId");

-- CreateIndex
CREATE INDEX "ServiceMessage_relatedRequestDraftSupportCaseId_idx" ON "ServiceMessage"("relatedRequestDraftSupportCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastCampaign_clientRequestId_key" ON "BroadcastCampaign"("clientRequestId");

-- CreateIndex
CREATE INDEX "BroadcastCampaign_status_createdAt_idx" ON "BroadcastCampaign"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BroadcastCampaign_campaignType_idx" ON "BroadcastCampaign"("campaignType");

-- CreateIndex
CREATE INDEX "BroadcastCampaign_targetCityId_idx" ON "BroadcastCampaign"("targetCityId");

-- CreateIndex
CREATE INDEX "BroadcastCampaign_targetRegionId_idx" ON "BroadcastCampaign"("targetRegionId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_serviceMessageId_key" ON "BroadcastRecipient"("serviceMessageId");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_campaignId_status_idx" ON "BroadcastRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_userId_idx" ON "BroadcastRecipient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_campaignId_userId_key" ON "BroadcastRecipient"("campaignId", "userId");

-- CreateIndex
CREATE INDEX "ServiceMessageAttachment_messageId_idx" ON "ServiceMessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "ServiceMessageAttachment_userId_createdAt_idx" ON "ServiceMessageAttachment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceMessageAttachment_attachmentType_idx" ON "ServiceMessageAttachment"("attachmentType");

-- CreateIndex
CREATE INDEX "ServiceMessageAttachment_relatedPaymentTransactionId_idx" ON "ServiceMessageAttachment"("relatedPaymentTransactionId");

-- CreateIndex
CREATE INDEX "ServiceMessageAttachment_relatedRefundTransactionId_idx" ON "ServiceMessageAttachment"("relatedRefundTransactionId");

-- CreateIndex
CREATE INDEX "ServiceMessageAttachment_relatedRequestId_idx" ON "ServiceMessageAttachment"("relatedRequestId");

-- CreateIndex
CREATE INDEX "Consent_userId_idx" ON "Consent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_userId_type_version_key" ON "Consent"("userId", "type", "version");

-- CreateIndex
CREATE INDEX "LegalDocument_type_isActive_isPublished_idx" ON "LegalDocument"("type", "isActive", "isPublished");

-- CreateIndex
CREATE INDEX "LegalDocument_roleScope_isRequired_idx" ON "LegalDocument"("roleScope", "isRequired");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_type_version_key" ON "LegalDocument"("type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_slug_version_key" ON "LegalDocument"("slug", "version");

-- CreateIndex
CREATE INDEX "UserConsent_userId_isActive_idx" ON "UserConsent"("userId", "isActive");

-- CreateIndex
CREATE INDEX "UserConsent_documentType_documentVersion_idx" ON "UserConsent"("documentType", "documentVersion");

-- CreateIndex
CREATE UNIQUE INDEX "UserConsent_userId_documentId_key" ON "UserConsent"("userId", "documentId");

-- CreateIndex
CREATE INDEX "UserConsentAuditLog_userId_createdAt_idx" ON "UserConsentAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserConsentAuditLog_adminId_createdAt_idx" ON "UserConsentAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "UserConsentAuditLog_documentType_documentVersion_idx" ON "UserConsentAuditLog"("documentType", "documentVersion");

-- CreateIndex
CREATE INDEX "ConsentExportLog_exportedByAdminId_exportedAt_idx" ON "ConsentExportLog"("exportedByAdminId", "exportedAt");

-- CreateIndex
CREATE INDEX "ConsentExportLog_userId_exportedAt_idx" ON "ConsentExportLog"("userId", "exportedAt");

-- CreateIndex
CREATE INDEX "ConsentExportLog_exportType_idx" ON "ConsentExportLog"("exportType");

-- CreateIndex
CREATE INDEX "PerformerDocument_performerId_type_idx" ON "PerformerDocument"("performerId", "type");

-- CreateIndex
CREATE INDEX "PerformerDocument_status_idx" ON "PerformerDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_slug_key" ON "KnowledgeArticle"("slug");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_audience_isPublished_idx" ON "KnowledgeArticle"("audience", "isPublished");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_category_sortOrder_idx" ON "KnowledgeArticle"("category", "sortOrder");

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCity" ADD CONSTRAINT "UserCity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCity" ADD CONSTRAINT "UserCity_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformerProfile" ADD CONSTRAINT "PerformerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryStructure" ADD CONSTRAINT "CategoryStructure_scopeRegionId_fkey" FOREIGN KEY ("scopeRegionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryStructure" ADD CONSTRAINT "CategoryStructure_scopeCityId_fkey" FOREIGN KEY ("scopeCityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryStructure" ADD CONSTRAINT "CategoryStructure_parentStructureId_fkey" FOREIGN KEY ("parentStructureId") REFERENCES "CategoryStructure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryStructure" ADD CONSTRAINT "CategoryStructure_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryStructure" ADD CONSTRAINT "CategoryStructure_publishedByAdminId_fkey" FOREIGN KEY ("publishedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNode" ADD CONSTRAINT "ServiceNode_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "CategoryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNode" ADD CONSTRAINT "ServiceNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ServiceNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNodeRelation" ADD CONSTRAINT "ServiceNodeRelation_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "CategoryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNodeRelation" ADD CONSTRAINT "ServiceNodeRelation_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "ServiceNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNodeRelation" ADD CONSTRAINT "ServiceNodeRelation_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "ServiceNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNodePricingRule" ADD CONSTRAINT "ServiceNodePricingRule_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "CategoryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNodePricingRule" ADD CONSTRAINT "ServiceNodePricingRule_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "ServiceNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNodeSafetyRule" ADD CONSTRAINT "ServiceNodeSafetyRule_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "CategoryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceNodeSafetyRule" ADD CONSTRAINT "ServiceNodeSafetyRule_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "ServiceNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "CategoryStructure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryTaskTemplate" ADD CONSTRAINT "CategoryTaskTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorySafetyRule" ADD CONSTRAINT "CategorySafetyRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryPricingRule" ADD CONSTRAINT "CategoryPricingRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryPricingRule" ADD CONSTRAINT "CategoryPricingRule_taskTemplateId_fkey" FOREIGN KEY ("taskTemplateId") REFERENCES "CategoryTaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelperCategoryPreference" ADD CONSTRAINT "HelperCategoryPreference_helperUserId_fkey" FOREIGN KEY ("helperUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelperCategoryPreference" ADD CONSTRAINT "HelperCategoryPreference_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelperCategoryPreference" ADD CONSTRAINT "HelperCategoryPreference_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCategorySnapshot" ADD CONSTRAINT "RequestCategorySnapshot_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCategorySnapshot" ADD CONSTRAINT "RequestCategorySnapshot_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "CategoryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCategorySnapshot" ADD CONSTRAINT "RequestCategorySnapshot_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCategorySnapshot" ADD CONSTRAINT "RequestCategorySnapshot_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestCategorySnapshot" ADD CONSTRAINT "RequestCategorySnapshot_taskTemplateId_fkey" FOREIGN KEY ("taskTemplateId") REFERENCES "CategoryTaskTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_createdByManagerId_fkey" FOREIGN KEY ("createdByManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_selectedPerformerId_fkey" FOREIGN KEY ("selectedPerformerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDraft" ADD CONSTRAINT "RequestDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDraft" ADD CONSTRAINT "RequestDraft_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDraft" ADD CONSTRAINT "RequestDraft_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "CategoryStructure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDraft" ADD CONSTRAINT "RequestDraft_convertedRequestId_fkey" FOREIGN KEY ("convertedRequestId") REFERENCES "ClientRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDraftRevision" ADD CONSTRAINT "RequestDraftRevision_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "RequestDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDraftSupportCase" ADD CONSTRAINT "RequestDraftSupportCase_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "RequestDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDraftSupportCase" ADD CONSTRAINT "RequestDraftSupportCase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDraftSupportCase" ADD CONSTRAINT "RequestDraftSupportCase_assignedManagerId_fkey" FOREIGN KEY ("assignedManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestStructureUpdateRevision" ADD CONSTRAINT "RequestStructureUpdateRevision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestStructureUpdateRevision" ADD CONSTRAINT "RequestStructureUpdateRevision_targetStructureId_fkey" FOREIGN KEY ("targetStructureId") REFERENCES "CategoryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestResponse" ADD CONSTRAINT "RequestResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestResponse" ADD CONSTRAINT "RequestResponse_performerId_fkey" FOREIGN KEY ("performerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "RequestResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_performerId_fkey" FOREIGN KEY ("performerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementVersion" ADD CONSTRAINT "AgreementVersion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementVersion" ADD CONSTRAINT "AgreementVersion_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementContract" ADD CONSTRAINT "AgreementContract_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementContract" ADD CONSTRAINT "AgreementContract_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgreementContract" ADD CONSTRAINT "AgreementContract_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "AgreementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVisit" ADD CONSTRAINT "RequestVisit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVisit" ADD CONSTRAINT "RequestVisit_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "AgreementVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFeeAgreementBatch" ADD CONSTRAINT "ServiceFeeAgreementBatch_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFeeAgreementBatch" ADD CONSTRAINT "ServiceFeeAgreementBatch_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFeeAgreementBatch" ADD CONSTRAINT "ServiceFeeAgreementBatch_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "AgreementVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFeeVisitAllocation" ADD CONSTRAINT "ServiceFeeVisitAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ServiceFeeAgreementBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceFeeVisitAllocation" ADD CONSTRAINT "ServiceFeeVisitAllocation_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "RequestVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVisitDispute" ADD CONSTRAINT "RequestVisitDispute_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVisitDispute" ADD CONSTRAINT "RequestVisitDispute_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "RequestVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceTransaction" ADD CONSTRAINT "BalanceTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceTransaction" ADD CONSTRAINT "BalanceTransaction_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceTransaction" ADD CONSTRAINT "BalanceTransaction_relatedRequestId_fkey" FOREIGN KEY ("relatedRequestId") REFERENCES "ClientRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTransaction" ADD CONSTRAINT "RefundTransaction_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpdTaxRegisterEntry" ADD CONSTRAINT "NpdTaxRegisterEntry_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpdTaxRegisterEntry" ADD CONSTRAINT "NpdTaxRegisterEntry_refundTransactionId_fkey" FOREIGN KEY ("refundTransactionId") REFERENCES "RefundTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpdTaxRegisterEntry" ADD CONSTRAINT "NpdTaxRegisterEntry_balanceTransactionId_fkey" FOREIGN KEY ("balanceTransactionId") REFERENCES "BalanceTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpdTaxRegisterEntry" ADD CONSTRAINT "NpdTaxRegisterEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpdTaxRegisterEntry" ADD CONSTRAINT "NpdTaxRegisterEntry_npdRecordedByAdminId_fkey" FOREIGN KEY ("npdRecordedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_againstUserId_fkey" FOREIGN KEY ("againstUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRiskFlag" ADD CONSTRAINT "UserRiskFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceConversation" ADD CONSTRAINT "ServiceConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ServiceConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_relatedPaymentTransactionId_fkey" FOREIGN KEY ("relatedPaymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_relatedRefundTransactionId_fkey" FOREIGN KEY ("relatedRefundTransactionId") REFERENCES "RefundTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_relatedRequestId_fkey" FOREIGN KEY ("relatedRequestId") REFERENCES "ClientRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_relatedLegalDocumentId_fkey" FOREIGN KEY ("relatedLegalDocumentId") REFERENCES "LegalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_relatedRequestDraftSupportCaseId_fkey" FOREIGN KEY ("relatedRequestDraftSupportCaseId") REFERENCES "RequestDraftSupportCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "BroadcastCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastCampaign" ADD CONSTRAINT "BroadcastCampaign_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastCampaign" ADD CONSTRAINT "BroadcastCampaign_targetCityId_fkey" FOREIGN KEY ("targetCityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastCampaign" ADD CONSTRAINT "BroadcastCampaign_targetRegionId_fkey" FOREIGN KEY ("targetRegionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BroadcastCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_serviceMessageId_fkey" FOREIGN KEY ("serviceMessageId") REFERENCES "ServiceMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessageAttachment" ADD CONSTRAINT "ServiceMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ServiceMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessageAttachment" ADD CONSTRAINT "ServiceMessageAttachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessageAttachment" ADD CONSTRAINT "ServiceMessageAttachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessageAttachment" ADD CONSTRAINT "ServiceMessageAttachment_relatedPaymentTransactionId_fkey" FOREIGN KEY ("relatedPaymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessageAttachment" ADD CONSTRAINT "ServiceMessageAttachment_relatedRefundTransactionId_fkey" FOREIGN KEY ("relatedRefundTransactionId") REFERENCES "RefundTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessageAttachment" ADD CONSTRAINT "ServiceMessageAttachment_relatedRequestId_fkey" FOREIGN KEY ("relatedRequestId") REFERENCES "ClientRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMessageAttachment" ADD CONSTRAINT "ServiceMessageAttachment_relatedLegalDocumentId_fkey" FOREIGN KEY ("relatedLegalDocumentId") REFERENCES "LegalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsentAuditLog" ADD CONSTRAINT "UserConsentAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConsentAuditLog" ADD CONSTRAINT "UserConsentAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentExportLog" ADD CONSTRAINT "ConsentExportLog_exportedByAdminId_fkey" FOREIGN KEY ("exportedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentExportLog" ADD CONSTRAINT "ConsentExportLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformerDocument" ADD CONSTRAINT "PerformerDocument_performerId_fkey" FOREIGN KEY ("performerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
