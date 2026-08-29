import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiJson, expectJson, expectReady, loginByApi, switchUser } from "./helpers";

test.beforeEach(async ({ page }) => expectReady(page));

test("mock top-up reaches the success UI without live payment operations", async ({ page }) => {
  await loginByApi(page, "client@zabota.local");
  await page.goto("/app/client/balance");
  await expect(page.getByRole("heading", { name: "Пополнить баланс" })).toBeVisible();
  await page.getByRole("button", { name: "500 ₽" }).click();
  await page.getByRole("button", { name: "Перейти к оплате" }).click();
  await expect(page.getByRole("heading", { name: "Тестовая платёжная форма" })).toBeVisible();
  await page.getByRole("button", { name: "Оплатить тестово" }).click();
  await expect(page.getByRole("heading", { name: "Платёж принят" })).toBeVisible();
  await expect(page.getByText(/Платёж подтверждён/)).toBeVisible();
});

test("protected document is downloadable only by its owner", async ({ page }) => {
  const helper = await loginByApi(page, "performer@zabota.local");
  const bytes = Buffer.from("%PDF-1.4\nPlaywright protected file\n%%EOF");
  const upload = await page.request.post("/api/performer-documents", {
    headers: { authorization: `Bearer ${helper.token}` },
    data: {
      type: "self_employed",
      fileName: "e2e-proof.pdf",
      fileData: `data:application/pdf;base64,${bytes.toString("base64")}`
    }
  });
  const document = await expectJson<{ id: string; checksum: string }>(upload, 201);
  expect(document.checksum).toBe(createHash("sha256").update(bytes).digest("hex"));

  const allowed = await page.request.get(`/api/performer-documents/${document.id}/download`, {
    headers: { authorization: `Bearer ${helper.token}` }
  });
  expect(allowed.status()).toBe(200);
  expect(Buffer.from(await allowed.body())).toEqual(bytes);
  expect(allowed.headers()["content-disposition"]).toContain("e2e-proof.pdf");

  const foreign = await switchUser(page, "performer2@zabota.local");
  const denied = await page.request.get(`/api/performer-documents/${document.id}/download`, {
    headers: { authorization: `Bearer ${foreign.token}` }
  });
  await expectJson(denied, 403);

  const adminDenied = await page.request.get("/api/admin/users", {
    headers: { authorization: `Bearer ${foreign.token}` }
  });
  await expectJson(adminDenied, 403);
});
