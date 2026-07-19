import type { ClientRequest, ServiceCategory } from "@prisma/client";
import type { UserRole } from "../types/domain";
import {
  buildYandexExactMapAddress,
  buildYandexMapsSearchUrl,
  buildYandexPublicMapAddress,
  canShowExactAddressToHelper
} from "./addressService";

type RequestWithRelations = ClientRequest & {
  category?: ServiceCategory;
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
  chats?: Array<{
    id: string;
    status: string;
    performerId: string;
    clientConfirmedAt?: Date | null;
    performerConfirmedAt?: Date | null;
    archivedAt?: Date | null;
  }>;
};

export function serializeRequestForUser(
  request: RequestWithRelations,
  viewer: { id: string; role: UserRole }
) {
  const chat = request.chats?.find((item) => !item.archivedAt) ?? request.chats?.[0] ?? null;
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

  return {
    ...request,
    addressText: canSeeExactAddress ? request.addressText : null,
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
    exactAddressVisible: canSeeExactAddress,
    phoneVisible: false,
    pricing: safeJsonObject(request.pricingBreakdownJson),
    chat: chat ? { id: chat.id, status: chat.status, performerId: chat.performerId } : null,
    client: request.client ? { id: request.client.id, displayName: request.client.displayName } : undefined,
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
