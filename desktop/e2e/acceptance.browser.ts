import type { Page } from "@playwright/test";
import { test, expect } from "./test";

// These are real browser/storage tests. Only serial and native protocol input
// are synthetic; no hardware chooser or radio interface is opened.
async function runHarness(page: Page, path: string) {
  await page.goto(path);
  await page.locator("#run").click();
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await page.locator("#result").innerText()).status;
        } catch {
          return "running";
        }
      },
      { timeout: 45_000 },
    )
    .toMatch(/^(passed|failed)$/);
  const result = JSON.parse(await page.locator("#result").innerText());
  await test.info().attach("acceptance-result", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result, JSON.stringify(result)).toHaveProperty("status", "passed");
  return result;
}

test("application failure flows: cancel, disconnect, recovery, corruption and receipts", async ({
  page,
}) => {
  const result = await runHarness(page, "/tests/failures.html");
  expect(result.checks).toHaveLength(6);
  expect(
    result.checks.every((check: { passed: boolean }) => check.passed),
  ).toBe(true);
  expect(result).toMatchObject({
    serial: "synthetic only",
    storage: "real browser OPFS",
    hardware: false,
    native_airdrop: false,
  });
});

test("real OPFS close/reopen and independent destination SHA256", async ({
  page,
}) => {
  const result = await runHarness(page, "/tests/storage.html");
  expect(result).toMatchObject({
    closes_and_reopens_checked: true,
    commit_after_hash: true,
    waits_for_completion_record: true,
    serial_hardware_tested: false,
    native_airdrop_tested: false,
  });
  expect(result.files.map((file: { bytes: number }) => file.bytes)).toEqual([
    0, 4097, 262145,
  ]);
  expect(result.files.map((file: { sha256: string }) => file.sha256)).toEqual([
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "e9893c07e509419a1ec218ebbf1c6308bf732248b8cf8cb2d1757e7782b755f1",
    "5d8e5555cdcfb3ece00bfa5de4340b2951a1af92423277c854969b18e03f4759",
  ]);
});

test("production build starts disconnected without requesting hardware", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort() {
          throw new Error("Production requested hardware on load");
        },
        getPorts() {
          throw new Error("Production enumerated hardware on load");
        },
      },
    });
  });
  await page.goto("http://127.0.0.1:1431/");
  await expect(page.locator(".discovery-stage")).toHaveClass(/is-idle/);
  await expect(page.locator(".peer-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Choose receive folder", exact: true }),
  ).toBeVisible();
  // Test-only harness source must not be shipped in the production bundle.
  const response = await page.request.get(
    "http://127.0.0.1:1431/tests/failures.tsx",
  );
  expect(response.headers()["content-type"]).not.toContain("javascript");
});
