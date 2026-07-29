import { Prisma, type City } from "@prisma/client";
import { prisma } from "../db/prisma";
import { HttpError } from "../utils/http";
import { CITY_DIRECTORY } from "./cityDirectory";

type DbClient = Prisma.TransactionClient | typeof prisma;

export const SETTLEMENT_TYPES = [
  "city",
  "town",
  "settlement",
  "village",
  "rural_locality",
  "urban_type_settlement",
  "other"
] as const;

export type SettlementRoleScope = "customer" | "helper" | "both";

export function normalizeSettlementName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

export function regionSlug(value: string) {
  const transliteration: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
  };
  return normalizeSettlementName(value)
    .split("")
    .map((character) => transliteration[character] ?? character)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "region";
}

export function sanitizeSettlementText(value: string, maxLength: number) {
  const result = value.trim().replace(/\s+/g, " ");
  if (!result || result.length > maxLength || /[<>]/.test(result)) {
    throw new HttpError(400, "Проверьте название населённого пункта", "settlement_invalid");
  }
  return result;
}

export function settlementDisplayName(city: Pick<City, "name" | "region" | "district">) {
  return [city.name, city.region, city.district].filter(Boolean).join(", ");
}

export function settlementDto(city: City) {
  return {
    id: city.id,
    name: city.name,
    type: city.type,
    region: city.region,
    district: city.district,
    displayName: settlementDisplayName(city),
    directoryStatus: city.directoryStatus,
    serviceStatus: city.serviceStatus
  };
}

export async function activateSettlementTx(client: DbClient, cityId: string, userId: string) {
  const city = await client.city.findUnique({ where: { id: cityId } });
  if (!city || !city.isActive || city.directoryStatus === "hidden" || city.directoryStatus === "duplicate") {
    throw new HttpError(400, "Населённый пункт недоступен", "city_invalid");
  }
  if (city.serviceStatus !== "active") {
    return client.city.update({
      where: { id: cityId },
      data: {
        serviceStatus: "active",
        status: "active",
        activatedAt: city.activatedAt ?? new Date(),
        activatedByUserId: city.activatedByUserId ?? userId
      }
    });
  }
  return city;
}

export async function linkUserCityTx(
  client: DbClient,
  input: { userId: string; cityId: string; roleScope: SettlementRoleScope; isPrimary?: boolean }
) {
  const currentCount = await client.userCity.count({ where: { userId: input.userId, isActive: true } });
  const makePrimary = Boolean(input.isPrimary) || currentCount === 0;

  if (makePrimary) {
    await client.userCity.updateMany({
      where: { userId: input.userId, isPrimary: true },
      data: { isPrimary: false }
    });
  }

  const relation = await client.userCity.upsert({
    where: { userId_cityId: { userId: input.userId, cityId: input.cityId } },
    create: {
      userId: input.userId,
      cityId: input.cityId,
      roleScope: input.roleScope,
      isPrimary: makePrimary,
      isActive: true
    },
    update: {
      roleScope: input.roleScope,
      isPrimary: makePrimary || undefined,
      isActive: true
    },
    include: { city: true }
  });

  await activateSettlementTx(client, input.cityId, input.userId);
  if (makePrimary) {
    await client.user.update({ where: { id: input.userId }, data: { cityId: input.cityId } });
  }
  return relation;
}

export async function ensureSettlementDirectory() {
  const regionNames = [...new Set(CITY_DIRECTORY.map((city) => city.region))];
  const regionRows = await Promise.all(regionNames.map((name) => prisma.region.upsert({
    where: { name },
    update: { slug: regionSlug(name), status: "active" },
    create: { name, slug: regionSlug(name), status: "active" }
  })));
  const regionsByName = new Map(regionRows.map((region) => [region.name, region]));

  for (const city of CITY_DIRECTORY) {
    const regionId = regionsByName.get(city.region)?.id;
    await prisma.city.upsert({
      where: { slug: city.slug },
      update: {
        name: city.name,
        normalizedName: city.normalizedName,
        type: city.type,
        region: city.region,
        regionId,
        source: city.source,
        directoryStatus: city.directoryStatus,
        isActive: true,
        timezone: city.timezone,
        pricingZone: city.pricingZone,
        sortOrder: city.sortOrder,
        mapCenterLat: city.mapCenterLat,
        mapCenterLng: city.mapCenterLng
      },
      create: {
        ...city,
        regionId,
        status: "inactive",
        defaultCommissionAmount: 50,
        minTopUpAmount: 150
      }
    });
  }
  const cities = await prisma.city.findMany();
  for (const city of cities) {
    const normalizedName = normalizeSettlementName(city.name);
    const region = await prisma.region.upsert({
      where: { name: city.region },
      update: { status: "active" },
      create: { name: city.region, slug: regionSlug(city.region), status: "active" }
    });
    if (city.normalizedName !== normalizedName || city.regionId !== region.id) {
      await prisma.city.update({ where: { id: city.id }, data: { normalizedName, regionId: region.id } });
    }
  }

  const users = await prisma.user.findMany({ where: { cityId: { not: null } }, select: { id: true, role: true, cityId: true } });
  for (const user of users) {
    if (!user.cityId || user.role === "oauth_pending") continue;
    const roleScope: SettlementRoleScope = user.role === "performer" ? "helper" : user.role === "client" ? "customer" : "both";
    await prisma.$transaction((tx) => linkUserCityTx(tx, { userId: user.id, cityId: user.cityId!, roleScope, isPrimary: true }));
  }

  const requestCities = await prisma.clientRequest.findMany({ distinct: ["cityId"], select: { cityId: true, clientId: true } });
  for (const request of requestCities) {
    await prisma.$transaction((tx) => activateSettlementTx(tx, request.cityId, request.clientId));
  }
}
