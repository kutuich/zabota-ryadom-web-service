export function generateTopUpOrderId(userId: string, date = new Date(), random = randomOrderSuffix()) {
  const userIdShort = normalizeOrderPart(userId).slice(0, 6) || "USER";
  const timestamp = formatOrderTimestamp(date);
  const suffix = normalizeOrderPart(random).slice(0, 4).padEnd(4, "0");
  return `TOPUP-${userIdShort}-${timestamp}-${suffix}`;
}

export function formatOrderTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function randomOrderSuffix() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function normalizeOrderPart(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
