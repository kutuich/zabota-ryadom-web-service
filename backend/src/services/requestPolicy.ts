import type { ClientRequest, ServiceCategory } from "@prisma/client";
import type { UserRole } from "../types/domain";
import {
  buildYandexExactMapAddress,
  buildYandexMapsSearchUrl,
  buildYandexPublicMapAddress,
  canShowExactAddressToHelper
} from "./addressService";
import { serializeAgreedTerms, type AgreementTermsSource } from "./agreementTermsService";
import { serializeRequestCategorySnapshot } from "./categoryStructureService";

type RequestChatSummary = AgreementTermsSource & {
  id: string;
  status: string;
  performerId: string;
  clientConfirmedAt?: Date | null;
  performerConfirmedAt?: Date | null;
  agreementFinalizedAt?: Date | null;
  archivedAt?: Date | null;
};

type RequestWithRelations = ClientRequest & {
  category?: ServiceCategory;
  city?: unknown;
  responses?: Array<{
    id: string;
    status: string;
    performerId: string;
    performer?: {
      id: string;
      displayName: string;
      avatarUrl: string | null;
      performerProfile?: {
        rating: number;
        completedJobsCount: number;
        trustLevel: string;
        verificationStatuses: string;
        criminalRecordCertificateStatus: string;
        childcareApprovalStatus: string;
      } | null;
    };
  }>;
  client?: {
    id: string;
    displayName: string;
  };
  selectedPerformer?: {
    id: string;
    displayName: string;
  } | null;
  chats?: RequestChatSummary[];
  categorySnapshots?: Array<{
    id: string;
    structureId: string;
    categoryId: string | null;
    subcategoryId: string | null;
    taskTemplateId: string | null;
    snapshotJson: string;
    createdAt: Date;
  }>;
};

export function serializeRequestForUser(
  request: RequestWithRelations,
  viewer: { id: string; role: UserRole },
  chatOverride?: RequestChatSummary
) {
  const chats = chatOverride ? [chatOverride] : request.chats;
  const chat = chats?.find((item) => !item.archivedAt) ?? chats?.[0] ?? null;
  const canSeeExactAddress =
    ["admin", "superadmin"].includes(viewer.role) ||
    request.clientId === viewer.id ||
    (request.selectedPerformerId === viewer.id && canShowExactAddressToHelper(request.status, chat?.status));
  const addressParts = {
    city: request.addressCity,
    street: request.addressStreet,
    house: request.addressHouse
  };
  const builtPublicMapAddress = buildYandexPublicMapAddress(addressParts);
  const builtExactMapAddress = buildYandexExactMapAddress(addressParts);
  const publicMapAddress = request.yandexPublicMapAddress || builtPublicMapAddress || request.publicAddress || request.approximateAddressText || "";
  const exactMapAddress = request.yandexExactMapAddress || builtExactMapAddress;
  const canSeeContact = ["admin", "superadmin"].includes(viewer.role) || request.clientId === viewer.id;

  return {
    id: request.id,
    publicNumber: request.publicNumber,
    clientId: request.clientId,
    createdByRole: request.createdByRole,
    createdByManagerId: request.createdByManagerId,
    cityId: request.cityId,
    categoryId: request.categoryId,
    contactName: canSeeContact ? request.contactName : null,
    contactPhone: canSeeContact ? request.contactPhone : null,
    helpFor: request.helpFor,
    additionalActionsJson: request.additionalActionsJson,
    dependentStateJson: request.dependentStateJson,
    dependentAge: request.dependentAge,
    scheduleType: request.scheduleType,
    regularPeriod: request.regularPeriod,
    repeatedVisitsAllowed: request.repeatedVisitsAllowed,
    title: request.title,
    description: request.description,
    addressText: canSeeExactAddress ? request.addressText : null,
    approximateAddressText: request.approximateAddressText,
    fullAddress: canSeeExactAddress ? request.fullAddress ?? request.addressText : null,
    publicAddress: request.publicAddress || builtPublicMapAddress || request.approximateAddressText,
    addressCity: request.addressCity,
    addressStreet: request.addressStreet,
    addressHouse: canSeeExactAddress ? request.addressHouse : null,
    addressApartment: canSeeExactAddress ? request.addressApartment : null,
    addressEntrance: canSeeExactAddress ? request.addressEntrance : null,
    addressFloor: canSeeExactAddress ? request.addressFloor : null,
    addressIntercom: canSeeExactAddress ? request.addressIntercom : null,
    addressComment: canSeeExactAddress ? request.addressComment : null,
    yandexPublicMapAddress: publicMapAddress,
    yandexExactMapAddress: canSeeExactAddress ? exactMapAddress : null,
    yandexPublicMapUrl: buildYandexMapsSearchUrl(publicMapAddress),
    yandexExactMapUrl: canSeeExactAddress ? buildYandexMapsSearchUrl(exactMapAddress) : null,
    lat: canSeeExactAddress ? request.lat : request.approximateLat,
    lng: canSeeExactAddress ? request.lng : request.approximateLng,
    approximateLat: request.approximateLat,
    approximateLng: request.approximateLng,
    mapPrivacyRadiusMeters: request.mapPrivacyRadiusMeters,
    district: request.district,
    date: request.date,
    timeFrom: request.timeFrom,
    timeTo: request.timeTo,
    expectedDurationHours: request.expectedDurationHours,
    urgency: request.urgency,
    hasElderlyPerson: request.hasElderlyPerson,
    hasChild: request.hasChild,
    hasLimitedMobility: request.hasLimitedMobility,
    physicalHelpLevel: request.physicalHelpLevel,
    needsCooking: request.needsCooking,
    needsCleaning: request.needsCleaning,
    needsWalk: request.needsWalk,
    needsHygieneHelp: request.needsHygieneHelp,
    hasPets: request.hasPets,
    budgetAmount: request.budgetAmount,
    priceEstimateAmount: request.priceEstimateAmount,
    pricingBreakdownJson: request.pricingBreakdownJson,
    comment: request.comment,
    status: request.status,
    visibilityStatus: request.visibilityStatus,
    selectedPerformerId: request.selectedPerformerId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    completedAt: request.completedAt,
    cancelledAt: request.cancelledAt,
    archivedAt: request.archivedAt,
    exactAddressVisible: canSeeExactAddress,
    phoneVisible: false,
    pricing: safeJsonObject(request.pricingBreakdownJson),
    chat: chat ? {
      id: chat.id,
      status: chat.status,
      performerId: chat.performerId,
      agreedTerms: serializeAgreedTerms(chat)
    } : null,
    city: request.city,
    category: request.category,
    categorySnapshot: serializeRequestCategorySnapshot(request.categorySnapshots?.[0]),
    client: request.client ? { id: request.client.id, displayName: request.client.displayName } : undefined,
    selectedPerformer: request.selectedPerformer
      ? { id: request.selectedPerformer.id, displayName: request.selectedPerformer.displayName }
      : request.selectedPerformer,
    chats: chats?.map((item) => ({
      id: item.id,
      status: item.status,
      performerId: item.performerId,
      clientConfirmedAt: item.clientConfirmedAt,
      performerConfirmedAt: item.performerConfirmedAt,
      agreementFinalizedAt: item.agreementFinalizedAt,
      agreedTerms: serializeAgreedTerms(item),
      archivedAt: item.archivedAt
    })),
    responses: request.responses?.map((response) => {
      const profile = response.performer?.performerProfile;
      const verificationStatuses = safeJsonArray(profile?.verificationStatuses);
      return {
        id: response.id,
        status: response.status,
        performerId: response.performerId,
        performer: response.performer
          ? {
              id: response.performer.id,
              displayName: response.performer.displayName,
              avatarUrl: response.performer.avatarUrl,
              rating: profile?.rating ?? 0,
              completedJobsCount: profile?.completedJobsCount ?? 0,
              trustLevel: profile?.trustLevel ?? "new_profile",
              verificationStatuses,
              criminalRecordCertificateStatus:
                profile?.criminalRecordCertificateStatus ?? "criminal_record_not_provided",
              childcareApprovalStatus: profile?.childcareApprovalStatus ?? "not_requested",
              childcareWarning:
                request.category?.isChildcare &&
                profile?.criminalRecordCertificateStatus !== "criminal_record_verified"
            }
          : undefined
      };
    })
  };
}

export function safeJsonArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value?: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const prohibitedMedicalTerms = [
  "инъекц",
  "укол",
  "капельниц",
  "перевяз",
  "лечение",
  "диагност",
  "назначение лекарств",
  "назначить лекарство",
  "катетер",
  "стома",
  "пролеж"
];

export function detectMedicalTerms(text: string) {
  const normalized = text.toLowerCase();
  return prohibitedMedicalTerms.filter((term) => normalized.includes(term));
}
