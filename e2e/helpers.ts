import { expect, type APIResponse, type Page } from "@playwright/test";

export type LoginResult = { token: string; user: { id: string; role: string; email?: string } };

export async function loginByApi(page: Page, phoneOrEmail: string, password = "password123") {
  const response = await page.request.post("/api/auth/login", { data: { phoneOrEmail, password } });
  const payload = await expectJson<LoginResult>(response, 200);
  return payload;
}

export async function switchUser(page: Page, phoneOrEmail: string, password = "password123") {
  await page.context().clearCookies();
  return loginByApi(page, phoneOrEmail, password);
}

export async function apiJson<T>(page: Page, path: string, token?: string, options: { method?: string; data?: unknown } = {}) {
  const response = await page.request.fetch(path, {
    method: options.method ?? "GET",
    data: options.data,
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
  return expectJson<T>(response, 200);
}

export async function expectJson<T>(response: APIResponse, status: number) {
  const body = await response.text();
  expect(response.status(), `${response.url()}: ${body}`).toBe(status);
  return (body ? JSON.parse(body) : null) as T;
}

export async function expectReady(page: Page) {
  const response = await page.request.get("/api/ready");
  const payload = await expectJson<{ status: string; checks: { postgres: string } }>(response, 200);
  expect(payload.status).toBe("ready");
  expect(payload.checks.postgres).toBe("ok");
}
