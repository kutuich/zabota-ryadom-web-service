export type ModerationResult = {
  status: "clean" | "flagged" | "hidden";
  isHidden: boolean;
  flags: string[];
  warning?: string;
};

const profanity = ["мат", "бляд", "хуй", "пизд", "сука"];
const adultMarkers = ["18+", "интим", "эротик", "секс"];
const threatMarkers = ["угрож", "убью", "расправ", "шантаж"];
const outsideContactMarkers = ["напиши в ватсап", "напиши в whatsapp", "перейдём в ватсап", "перейдем в ватсап", "созвонимся", "пиши в телеграм", "пиши в telegram"];

export function moderateChatMessage(text: string): ModerationResult {
  const normalized = text.toLowerCase();
  const digitsOnly = text.replace(/\D/g, "");
  const flags: string[] = [];

  if (/(https?:\/\/|www\.|t\.me\/|vk\.com\/|wa\.me\/)/i.test(text)) {
    flags.push("link_attempt");
  }

  if (outsideContactMarkers.some((item) => normalized.includes(item))) {
    flags.push("outside_contact_attempt");
  }

  if (digitsOnly.length >= 10 && digitsOnly.length <= 13) {
    flags.push("phone_attempt");
  }

  if (/\b\d{4,8}\b/.test(text) && /(код|sms|смс|подтвержд)/i.test(text)) {
    flags.push("sms_code_attempt");
  }

  if (/\b(?:\d[ -]*?){16,19}\b/.test(text)) {
    flags.push("bank_card_attempt");
  }

  if (profanity.some((item) => normalized.includes(item))) {
    flags.push("profanity");
  }

  if (adultMarkers.some((item) => normalized.includes(item))) {
    flags.push("adult_content");
  }

  if (threatMarkers.some((item) => normalized.includes(item))) {
    flags.push("threat");
  }

  if (/(.)\1{8,}/.test(normalized) || normalized.split(/\s+/).length > 6 && new Set(normalized.split(/\s+/)).size <= 3) {
    flags.push("spam");
  }

  const shouldHide = flags.some((flag) =>
    ["phone_attempt", "bank_card_attempt", "link_attempt", "adult_content", "outside_contact_attempt", "sms_code_attempt", "threat"].includes(flag)
  );

  if (flags.length === 0) {
    return { status: "clean", isHidden: false, flags: [] };
  }

  return {
    status: shouldHide ? "hidden" : "flagged",
    isHidden: shouldHide,
    flags,
    warning:
      "Не передавайте телефон, ссылки, данные банковских карт и коды из SMS. Общение по заявке ведётся внутри сервиса."
  };
}
