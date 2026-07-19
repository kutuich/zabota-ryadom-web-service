type AddressLike = {
  addressCity?: string | null;
  addressStreet?: string | null;
  addressHouse?: string | null;
};

export function buildPublicAddressFromRequest(request: AddressLike) {
  return [request.addressCity, request.addressStreet].map(cleanPart).filter(Boolean).join(", ");
}

export function buildYandexExactAddressFromRequest(request: AddressLike) {
  return [request.addressCity, request.addressStreet, request.addressHouse].map(cleanPart).filter(Boolean).join(", ");
}

export function buildYandexMapsSearchUrl(address?: string | null) {
  const value = String(address ?? "").trim();
  return value ? `https://yandex.ru/maps/?text=${encodeURIComponent(value)}` : "";
}

function cleanPart(value?: string | null) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
