export function normalizeRussianPhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");

  let nationalDigits = "";
  if (trimmed.startsWith("+")) {
    if (!digits.startsWith("7")) throwPhoneError();
    nationalDigits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith("7")) {
    nationalDigits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith("8")) {
    nationalDigits = digits.slice(1);
  } else if (digits.length === 10) {
    nationalDigits = digits;
  } else {
    throwPhoneError();
  }

  if (nationalDigits.length !== 10 || !/^\d{10}$/.test(nationalDigits)) {
    throwPhoneError();
  }
  return `+7${nationalDigits}`;
}

export function isPhoneLikeLogin(input: string): boolean {
  const value = input.trim();
  if (!value || value.includes("@")) return false;
  return /^\+?[\d\s().-]+$/.test(value) && /\d/.test(value);
}

function throwPhoneError(): never {
  throw new Error("Укажите корректный номер телефона");
}
