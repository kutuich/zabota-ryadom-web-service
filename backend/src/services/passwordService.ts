import argon2 from "argon2";

export const ARGON2ID_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32
});

export function isArgon2idHash(value: string | null | undefined) {
  return Boolean(value?.startsWith("$argon2id$"));
}

export async function hashPassword(password: string) {
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

export async function verifyPassword(hash: string | null | undefined, password: string) {
  if (!isArgon2idHash(hash)) return false;
  try {
    return await argon2.verify(hash!, password);
  } catch {
    return false;
  }
}
