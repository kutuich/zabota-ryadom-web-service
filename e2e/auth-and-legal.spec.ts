import { expect, test } from "@playwright/test";
import { expectReady } from "./helpers";

test.beforeEach(async ({ page }) => expectReady(page));

test("public pages, registration, session restore, role denial and logout", async ({ page }) => {
  for (const publicPath of ["/", "/prices.html", "/help", "/legal", "/legal/privacy", "/app", "/app/client/requests"]) {
    const response = await page.goto(publicPath);
    expect(response?.status(), publicPath).toBe(200);
  }
  await expect(page.getByRole("heading", { name: "Добро пожаловать!" })).toBeVisible();

  const suffix = String(Date.now()).slice(-9);
  const email = `e2e-client-${suffix}@zabota.local`;
  await page.getByRole("button", { name: "Зарегистрироваться как заказчик" }).click();
  await expect(page.getByRole("heading", { name: "Регистрация заказчика" })).toBeVisible();
  await page.getByLabel("Имя / Логин").fill("E2E Заказчик");
  await page.getByLabel("Телефон").fill(`+79${suffix}`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("combobox", { name: "Населённый пункт" }).fill("Югорск");
  await page.getByRole("option").filter({ hasText: "Югорск" }).first().click();
  await page.getByLabel("Пароль", { exact: true }).fill("SafePass!2026");
  await page.getByLabel("Повторите пароль").fill("SafePass!2026");

  const requiredConsent = page.getByLabel(/Принимаю пользовательское соглашение заказчика/);
  await requiredConsent.uncheck();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByText("Нужно принять обязательные юридические документы")).toBeVisible();
  await requiredConsent.check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page).toHaveURL(/\/app\/client\/requests/);
  await expect(page.getByText("E2E Заказчик")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/app\/client\/requests/);
  const storage = await page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage))
  }));
  expect(JSON.stringify(storage)).not.toMatch(/(?:access|refresh|jwt|bearer)[_-]?token/i);
  expect(JSON.stringify(storage)).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./);

  await page.goto("/app/admin/users");
  await expect(page).toHaveURL(/\/app\/client\/requests/);
  await page.goto("/app/performer/requests");
  await expect(page).toHaveURL(/\/app\/client\/requests/);

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("heading", { name: "Добро пожаловать!" })).toBeVisible();
  await page.goto("/app/client/balance");
  await expect(page).toHaveURL(/\/app$/);

  await page.getByLabel("Телефон или email").fill(email);
  await page.getByLabel("Пароль").fill("SafePass!2026");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/client\/requests/);
});

test("published legal documents remain publicly readable", async ({ page }) => {
  await page.goto("/legal");
  await expect(page.getByRole("heading", { name: "Документы сервиса «Забота Рядом»" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Открыть" })).toHaveCount(8);
  await page.goto("/legal/customer-agreement");
  await expect(page.getByText("Актуальная версия")).toBeVisible();
  await expect(page.locator("article.legal-document")).not.toBeEmpty();
});
