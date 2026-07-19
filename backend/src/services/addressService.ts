export type AddressParts = {
  city?: string | null;
  street?: string | null;
  house?: string | null;
  apartment?: string | null;
  entrance?: string | null;
  floor?: string | null;
  intercom?: string | null;
  addressComment?: string | null;
};

const WORK_STATUSES = new Set(["in_progress", "completed", "archived"]);
const WORK_CHAT_STATUSES = new Set(["in_work", "completed", "archived"]);

export function buildFullAddress(addressParts: AddressParts) {
  const base = buildYandexExactMapAddress(addressParts);
  const details = [
    addressParts.entrance ? `подъезд ${addressParts.entrance}` : "",
    addressParts.floor ? `этаж ${addressParts.floor}` : "",
    addressParts.apartment ? `квартира ${addressParts.apartment}` : ""
  ].filter(Boolean);
  return [base, ...details].filter(Boolean).join(", ");
}

export function buildPublicAddress(addressParts: AddressParts) {
  return [addressParts.city, addressParts.street].map(cleanPart).filter(Boolean).join(", ");
}

export function buildYandexPublicMapAddress(addressParts: AddressParts) {
  return buildPublicAddress(addressParts);
}

export function buildYandexExactMapAddress(addressParts: AddressParts) {
  return [addressParts.city, addressParts.street, addressParts.house].map(cleanPart).filter(Boolean).join(", ");
}

export function buildYandexMapsSearchUrl(address: string) {
  return `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
}

export function canShowExactAddressToHelper(requestStatus?: string | null, chatStatus?: string | null) {
  return WORK_STATUSES.has(requestStatus ?? "") || WORK_CHAT_STATUSES.has(chatStatus ?? "");
}

export function normalizeAddressParts(input: AddressParts, fallbackCity?: string | null): Required<AddressParts> {
  return {
    city: cleanPart(input.city) || cleanPart(fallbackCity) || "",
    street: cleanPart(input.street) || "",
    house: cleanPart(input.house) || "",
    apartment: cleanPart(input.apartment) || "",
    entrance: cleanPart(input.entrance) || "",
    floor: cleanPart(input.floor) || "",
    intercom: cleanPart(input.intercom) || "",
    addressComment: cleanPart(input.addressComment) || ""
  };
}

export function parseAddressText(addressText?: string | null, fallbackCity?: string | null): Required<AddressParts> {
  const city = cleanPart(fallbackCity) || "";
  const withoutCity = city && addressText?.startsWith(city) ? addressText.slice(city.length).replace(/^,\s*/, "") : addressText ?? "";
  const parts = withoutCity.split(",").map(cleanPart).filter(Boolean);
  return normalizeAddressParts({
    city,
    street: parts[0] ?? "",
    house: parts[1] ?? ""
  }, fallbackCity);
}

function cleanPart(value?: string | null) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
