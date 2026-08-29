import { expect, test } from "@playwright/test";
import { apiJson, expectJson, expectReady, loginByApi, switchUser } from "./helpers";

type Balance = { realBalance: number; bonusBalance: number; totalAvailableBalance: number };
type RequestRow = { id: string; title: string; status: string; responses?: Array<{ id: string }> };

test.beforeEach(async ({ page }) => expectReady(page));

test("customer and helper complete the critical request flow with double confirmation", async ({ page }) => {
  const client = await loginByApi(page, "client@zabota.local");
  const bootstrap = await apiJson<{ cities: Array<{ id: string; slug: string }>; categories: Array<{ id: string }> }>(page, "/api/public/bootstrap");
  const city = bootstrap.cities.find((item) => item.slug === "yugorsk")!;
  const category = bootstrap.categories[0];
  const startDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const title = `E2E критическая заявка ${Date.now()}`;
  const beforeClient = await apiJson<Balance>(page, "/api/balance/me", client.token);

  const createResponse = await page.request.post("/api/requests", {
    headers: { authorization: `Bearer ${client.token}` },
    data: {
      cityId: city.id,
      categoryId: category.id,
      title,
      description: "Playwright проверяет критическую пользовательскую цепочку.",
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
  const created = await expectJson<{ id: string }>(createResponse, 201);
  await apiJson(page, `/api/requests/${created.id}/publish`, client.token, { method: "POST" });

  await page.goto("/app/client/requests");
  await expect(page.getByText(title)).toBeVisible();

  const helper = await switchUser(page, "performer@zabota.local");
  const beforeHelper = await apiJson<Balance>(page, "/api/balance/me", helper.token);
  await page.goto("/app/performer/requests");
  await page.getByLabel("Соответствие профилю").selectOption("all");
  const helperCard = page.locator("article, section").filter({ hasText: title }).first();
  await helperCard.getByRole("button", { name: /Перейти в чат с заказчиком/ }).click();
  await expect(page.getByText(/Отклик отправлен/)).toBeVisible();

  const clientAgain = await switchUser(page, "client@zabota.local");
  const rows = await apiJson<RequestRow[]>(page, "/api/requests?scope=mine", clientAgain.token);
  const row = rows.find((item) => item.id === created.id)!;
  expect(row.responses?.length).toBe(1);
  await page.goto("/app/client/requests");
  const clientCard = page.locator("article, section").filter({ hasText: title }).first();
  await clientCard.getByRole("button", { name: /Открыть чат по заявке/ }).click();
  await expect(page).toHaveURL(/\/app\/client\/chats\//);
  const chatId = page.url().split("/").at(-1)!;

  await page.getByRole("button", { name: "Изменить условия" }).click();
  const amount = page.getByLabel("Сумма помощи Помощника, ₽");
  if (await amount.count()) await amount.fill("700");
  await page.getByLabel("Длительность, минут").fill("120");
  await page.getByLabel("Комментарий условий").fill("Условия согласованы в E2E");
  await page.getByRole("button", { name: "Сохранить условия" }).click();
  await expect(page.getByText(/Условия сохранены/)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Подтвердить помощника и условия" }).click();
  await expect(page.getByText(/Ожидается подтверждение помощника/)).toBeVisible();
  const clientBalanceSession = await loginByApi(page, "client@zabota.local");
  expect(await apiJson<Balance>(page, "/api/balance/me", clientBalanceSession.token)).toEqual(beforeClient);
  const helperBalanceSession = await loginByApi(page, "performer@zabota.local");
  const helperUncharged = await apiJson<Balance>(page, "/api/balance/me", helperBalanceSession.token);
  expect(helperUncharged).toEqual(beforeHelper);

  await switchUser(page, "performer@zabota.local");
  await page.goto(`/app/performer/chats/${chatId}`);
  await expect(page.getByText(title)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Принять заявку в работу" }).click();
  await expect(page.getByText(/Заявка перешла в работу/)).toBeVisible();
  await expect(page.getByText(/Статус: В работе/)).toBeVisible();

  const finalClient = await switchUser(page, "client@zabota.local");
  const afterClient = await apiJson<Balance>(page, "/api/balance/me", finalClient.token);
  const finalHelper = await switchUser(page, "performer@zabota.local");
  const afterHelper = await apiJson<Balance>(page, "/api/balance/me", finalHelper.token);
  expect(afterClient.totalAvailableBalance).toBe(beforeClient.totalAvailableBalance - 50);
  expect(afterHelper.totalAvailableBalance).toBe(beforeHelper.totalAvailableBalance - 50);
});
