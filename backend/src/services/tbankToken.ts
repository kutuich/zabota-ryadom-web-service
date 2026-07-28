import { createHash, timingSafeEqual } from "node:crypto";

type TbankTokenParams = Record<string, unknown>;

const excludedTokenKeys = new Set(["Token", "DATA", "Data", "Receipt"]);

export function buildTbankToken(params: TbankTokenParams, password: string) {
  const tokenParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (excludedTokenKeys.has(key) || value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    tokenParams[key] = String(value);
  }
  tokenParams.Password = password;

  const tokenSource = Object.keys(tokenParams)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => tokenParams[key])
    .join("");

  return createHash("sha256").update(tokenSource).digest("hex").toLowerCase();
}

export function verifyTbankToken(payload: TbankTokenParams, password: string) {
  const token = payload.Token;
  if (!token || typeof token !== "string") return false;
  const expected = Buffer.from(buildTbankToken(payload, password), "utf8");
  const actual = Buffer.from(token.toLowerCase(), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
