import { PrismaClient } from "@prisma/client";
import { requiredDocumentTypesForRegistration } from "../services/legalService";

const baseUrl = process.argv.find((value) => value.startsWith("--base-url="))?.slice("--base-url=".length) ?? "http://127.0.0.1:4400";
const prisma = new PrismaClient();

async function request(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" })
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${text}`);
  return payload;
}

async function main() {
  const [city, category] = await Promise.all([
    prisma.city.findFirstOrThrow({ where: { slug: "yugorsk" } }),
    prisma.serviceCategory.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })
  ]);
  const health = await request("/api/health");
  const legalDocuments = await request("/api/legal/documents");
  if (!Array.isArray(legalDocuments) || legalDocuments.length === 0) throw new Error("Published legal documents are missing");

  const suffix = `${Date.now()}`.slice(-9);
  const registration = await request("/api/auth/register", {
    method: "POST",
    body: {
      role: "client",
      phone: `+79${suffix}`,
      email: `postgres-smoke-${suffix}@zabota.local`,
      password: "SafePass!2026",
      displayName: "PostgreSQL smoke Заказчик",
      cityId: city.id,
      acceptedLegalDocumentTypes: requiredDocumentTypesForRegistration("client"),
      dependentDataTransferConfirmed: true
    }
  });
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { phoneOrEmail: registration.user.email, password: "SafePass!2026" }
  });
  await request("/api/legal/me/status", { token: login.token });
  await request("/api/balance/me", { token: login.token });

  const [clientLogin, helperLogin] = await Promise.all([
    request("/api/auth/login", { method: "POST", body: { phoneOrEmail: "client@zabota.local", password: "password123" } }),
    request("/api/auth/login", { method: "POST", body: { phoneOrEmail: "performer@zabota.local", password: "password123" } })
  ]);
  const startDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const created = await request("/api/requests", {
    method: "POST",
    token: clientLogin.token,
    body: {
      cityId: city.id,
      categoryId: category.id,
      title: "PostgreSQL smoke заявка",
      description: "Проверка полного локального сценария на PostgreSQL.",
      addressStreet: "ул. Мира",
      addressHouse: "10",
      date: startDate,
      timeFrom: "12:00",
      timeTo: "14:00",
      expectedDurationHours: 2,
      additionalActions: [],
      dependentState: []
    }
  });
  await request(`/api/requests/${created.id}/publish`, { method: "POST", token: clientLogin.token });
  const response = await request(`/api/requests/${created.id}/respond`, {
    method: "POST",
    token: helperLogin.token,
    body: { message: "Готов помочь" }
  });
  const accepted = await request(`/api/requests/responses/${response.response.id}/accept`, { method: "POST", token: clientLogin.token });
  await request(`/api/chats/${accepted.chat.id}/terms`, {
    method: "PATCH",
    token: clientLogin.token,
    body: {
      agreedHelperAmount: 700,
      schedule: { frequency: "once", startDate, slots: [{ id: "smoke", startTime: "12:00", durationMinutes: 120 }] },
      agreedTermsComment: "PostgreSQL smoke"
    }
  });
  await request(`/api/chats/${accepted.chat.id}/client-confirm`, { method: "POST", token: clientLogin.token });
  const finalized = await request(`/api/chats/${accepted.chat.id}/performer-confirm`, { method: "POST", token: helperLogin.token });
  if (finalized.status !== "in_work") throw new Error(`Expected in_work, received ${finalized.status}`);

  console.log(JSON.stringify({
    passed: true,
    databaseProvider: "postgresql",
    paymentProvider: process.env.PAYMENT_PROVIDER,
    health,
    registeredUserId: registration.user.id,
    requestId: created.id,
    chatId: accepted.chat.id,
    finalStatus: finalized.status
  }, null, 2));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
