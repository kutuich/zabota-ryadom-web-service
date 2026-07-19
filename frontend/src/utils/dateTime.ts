export function formatDateRu(value?: string | Date | null) {
  const date = normalizeDate(value);
  if (!date) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

export function formatTimeRu(value?: string | Date | null) {
  if (!value) return "";
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

export function formatDateTimeRu(value?: string | Date | null) {
  const date = normalizeDateTime(value);
  if (!date) return "";
  return `${formatDateRu(date)} ${formatTimeRu(date)}`.trim();
}

export function parseDateRu(value: string) {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    return "";
  }
  return `${year}-${month}-${day}`;
}

function normalizeDate(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const ru = parseDateRu(text);
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
  const date = new Date(`${ru || isoDate || text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDateTime(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? normalizeDate(value) : date;
}
