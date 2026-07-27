export const CITY_DIRECTORY = [
  settlement("Югорск", "yugorsk", "ХМАО — Югра", 10, 61.3133, 63.3319, "Asia/Yekaterinburg", "base_yugorsk"),
  settlement("Советский", "sovetsky", "ХМАО — Югра", 20, 61.3614, 63.5842, "Asia/Yekaterinburg", "base_sovetsky"),
  settlement("Урай", "uray", "ХМАО — Югра", 30, 60.1296, 64.8039),
  settlement("Ханты-Мансийск", "khanty_mansiysk", "ХМАО — Югра", 40, 61.0042, 69.0019),
  settlement("Сургут", "surgut", "ХМАО — Югра", 50, 61.254, 73.3962),
  settlement("Тюмень", "tyumen", "Тюменская область", 60, 57.1522, 65.5272),
  settlement("Екатеринбург", "ekaterinburg", "Свердловская область", 70, 56.8389, 60.6057),
  settlement("Челябинск", "chelyabinsk", "Челябинская область", 80, 55.1644, 61.4368),
  settlement("Москва", "moscow", "Москва", 90, 55.7558, 37.6173, "Europe/Moscow"),
  settlement("Санкт-Петербург", "saint_petersburg", "Санкт-Петербург", 100, 59.9386, 30.3141, "Europe/Moscow"),
  settlement("Волгоград", "volgograd", "Волгоградская область", 110, 48.708, 44.5133, "Europe/Volgograd"),
  settlement("Нижний Новгород", "nizhny_novgorod", "Нижегородская область", 120, 56.3269, 44.0059, "Europe/Moscow")
] as const;

function settlement(
  name: string,
  slug: string,
  region: string,
  sortOrder: number,
  mapCenterLat: number,
  mapCenterLng: number,
  timezone = "Asia/Yekaterinburg",
  pricingZone = "future_large_city"
) {
  return {
    name,
    normalizedName: name.toLocaleLowerCase("ru-RU").replace(/ё/g, "е"),
    slug,
    type: "city",
    region,
    source: "seed",
    directoryStatus: "verified",
    serviceStatus: "inactive",
    timezone,
    pricingZone,
    sortOrder,
    isActive: true,
    mapCenterLat,
    mapCenterLng
  } as const;
}
