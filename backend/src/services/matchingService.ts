import type { ClientRequest, PerformerProfile, ServiceCategory, User } from "@prisma/client";
import { safeJsonArray } from "./requestPolicy";

type MatchRequest = ClientRequest & {
  category?: ServiceCategory;
  city?: { id: string; name: string } | null;
};

type PerformerUser = Pick<User, "id" | "cityId"> & {
  performerProfile?: PerformerProfile | null;
  userCities?: Array<{ cityId: string; roleScope: string; isActive: boolean }>;
};

export type RequestMatchResult = {
  status: "fit" | "partial" | "not_fit";
  label: "Подходит" | "Частично подходит" | "Не подходит";
  reasons: string[];
};

export function evaluateRequestMatch(request: MatchRequest, performer: PerformerUser): RequestMatchResult {
  const profile = performer.performerProfile;
  const reasons: string[] = [];
  const blockers: string[] = [];
  const partial: string[] = [];

  const selectedCityIds = new Set([
    ...(performer.cityId ? [performer.cityId] : []),
    ...(performer.userCities ?? []).filter((row) => row.isActive && ["helper", "both"].includes(row.roleScope)).map((row) => row.cityId)
  ]);
  if (!selectedCityIds.has(request.cityId) && !profile?.canTravelOutsideCity) {
    blockers.push(`Заявка в другом городе, а вы указали работу только в своём городе.`);
  }

  const serviceNames = safeJsonArray(profile?.services).map((item) => item.toLowerCase());
  const categoryName = request.category?.name.toLowerCase() ?? "";
  if (serviceNames.length > 0 && categoryName && !serviceNames.some((service) => categoryName.includes(service) || service.includes(categoryName))) {
    partial.push("Категория заявки не указана среди ваших основных услуг.");
  }

  if (request.needsHygieneHelp && !profile?.readyForHygieneHelp) {
    blockers.push("Заявка скрыта, потому что требуется гигиеническая помощь, а в профиле указано «не готов».");
  }

  if ((request.hasLimitedMobility || safeJsonArray(request.dependentStateJson).includes("limited_mobility")) && !profile?.readyForLimitedMobility) {
    blockers.push("Заявка скрыта, потому что требуется работа с маломобильным человеком, а в профиле это не указано.");
  }

  if ((request.hasLimitedMobility || request.physicalHelpLevel) && !profile?.readyForPhysicalHelp) {
    partial.push("В заявке есть физическая помощь. Проверьте, готовы ли вы к такой нагрузке.");
  }

  if ((request.hasChild || request.category?.isChildcare) && !profile?.readyForChildren) {
    blockers.push("Заявка связана с ребёнком, а в профиле не указана готовность работать с детьми.");
  }

  if (request.category?.isChildcare && profile?.childcareApprovalStatus !== "approved") {
    blockers.push("Для этой категории требуется подтверждённый допуск к категории «Няня для малышей».");
  }

  if (request.urgency === "urgent" && !profile?.readyForUrgentRequests) {
    partial.push("Заявка срочная, а в профиле не указана готовность к срочным заявкам.");
  }

  if (blockers.length > 0) {
    return { status: "not_fit", label: "Не подходит", reasons: blockers };
  }

  if (partial.length > 0) {
    return { status: "partial", label: "Частично подходит", reasons: partial };
  }

  reasons.push("Заявка подходит вам по городу, категории и условиям профиля.");
  return { status: "fit", label: "Подходит", reasons };
}
