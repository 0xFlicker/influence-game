import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("homepage loads", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/influence/i);
  });

  test("API health check", async ({ request }) => {
    const response = await request.get("/health");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.status).toBe("ok");
  });

  test("games list API returns 200", async ({ request }) => {
    const response = await request.get("/api/games");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("games page loads", async ({ page }) => {
    const response = await page.goto("/games");
    expect(response?.status()).toBe(200);
  });

  test("free queue page loads", async ({ page }) => {
    const response = await page.goto("/games/free");
    expect(response?.status()).toBe(200);
  });
});
