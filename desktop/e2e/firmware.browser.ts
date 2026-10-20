import { test, expect } from "./test";
import { firmwareMessages } from "../src/locales/flasher";
import { readFileSync } from "node:fs";
const firmwareRelease = JSON.parse(
  readFileSync(
    new URL("../src/web/firmware-release.json", import.meta.url),
    "utf8",
  ),
) as { segments: { path: string; bytes: number; sha256: string }[] };
const production = "http://127.0.0.1:1431/";
async function open(page: import("@playwright/test").Page, scenario = "ok") {
  await page.goto(`/tests/firmware.html?case=${scenario}`);
  await page
    .getByRole("button", { name: firmwareMessages.en.title, exact: true })
    .click();
  await page
    .getByRole("button", { name: firmwareMessages.en.prepare, exact: true })
    .click();
}
async function inspect(page: import("@playwright/test").Page, scenario = "ok") {
  await open(page, scenario);
  await page
    .getByRole("button", { name: firmwareMessages.en.choose, exact: true })
    .click();
}
test("production serves pinned v0.0.1 images and opens no port until the user's click", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort: () => {
          document.documentElement.dataset.choosers = "1";
          throw new DOMException("dismissed", "NotFoundError");
        },
      },
    });
  });
  await page.goto(production);
  await page
    .getByRole("button", { name: firmwareMessages.en.title, exact: true })
    .click();
  await expect(page.locator("html")).not.toHaveAttribute("data-choosers");
  await page
    .getByRole("button", { name: firmwareMessages.en.prepare, exact: true })
    .click();
  await expect(
    page.getByText(firmwareMessages.en.ready, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-choosers");
  await page
    .getByRole("button", { name: firmwareMessages.en.choose, exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-choosers", "1");
  await expect(
    page.getByText(firmwareMessages.en.cancelled, { exact: true }),
  ).toBeVisible();
  for (const item of firmwareRelease.segments) {
    const response = await page.request.get(
      `${production}firmware/v0.0.1/${item.path}`,
    );
    expect(response.ok()).toBe(true);
    const { createHash } = await import("node:crypto");
    const bytes = await response.body();
    expect(bytes.length).toBe(item.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
  }
});
test("successful virtual flash requires confirmation, verifies then releases before connecting", async ({
  page,
}) => {
  await inspect(page);
  const install = page.getByRole("button", {
    name: firmwareMessages.en.install,
    exact: true,
  });
  await expect(install).toBeDisabled();
  await expect(page.locator("#fixture")).toHaveAttribute("data-writes", "0");
  await page.getByRole("checkbox").check();
  await install.click();
  await expect(
    page.getByText(firmwareMessages.en.complete, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#fixture")).toHaveAttribute("data-writes", "1");
  await expect(page.locator("#fixture")).toHaveAttribute("data-closes", "1");
  await page
    .getByRole("button", { name: firmwareMessages.en.connect, exact: true })
    .click();
  await expect(page.locator("#fixture")).toHaveAttribute("data-connects", "1");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
for (const scenario of ["chip", "tamper", "dismiss"] as const)
  test(`virtual ${scenario} cannot write`, async ({ page }) => {
    await open(page, scenario);
    if (scenario !== "tamper")
      await page
        .getByRole("button", { name: firmwareMessages.en.choose, exact: true })
        .click();
    await expect(
      page.getByText(
        firmwareMessages.en[
          scenario === "tamper"
            ? "integrity"
            : scenario === "dismiss"
              ? "cancelled"
              : "chip"
        ],
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator("#fixture")).toHaveAttribute("data-writes", "0");
  });
for (const scenario of ["verify", "reset", "cleanup"] as const)
  test(`virtual ${scenario} failure offers recovery and never claims success`, async ({
    page,
  }) => {
    await inspect(page, scenario);
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: firmwareMessages.en.install, exact: true })
      .click();
    await expect(
      page.getByText(
        firmwareMessages.en[scenario === "cleanup" ? "release" : scenario],
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: firmwareMessages.en.connect,
        exact: true,
      }),
    ).toHaveCount(0);
    if (scenario === "cleanup") {
      await page
        .getByRole("button", { name: "Retry disconnect", exact: true })
        .click();
      await expect(
        page.getByText(firmwareMessages.en.cancelled, { exact: true }),
      ).toBeVisible();
    }
  });
test("cancel in review releases the port without writing; Escape cannot abandon ownership", async ({
  page,
}) => {
  await inspect(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: firmwareMessages.en.cancel, exact: true })
    .click();
  await expect(
    page.getByText(firmwareMessages.en.cancelled, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#fixture")).toHaveAttribute("data-writes", "0");
  await expect(page.locator("#fixture")).toHaveAttribute("data-closes", "1");
});
for (const language of Object.keys(
  firmwareMessages,
) as (keyof typeof firmwareMessages)[])
  test(`installer ${language} fits in light and dark mode with correct text direction`, async ({
    page,
  }) => {
    for (const theme of ["light", "dark"]) {
      await page.goto(`/tests/firmware.html?lang=${language}&theme=${theme}`);
      await page
        .getByRole("button", {
          name: firmwareMessages[language].title,
          exact: true,
        })
        .click();
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        language === "ar" ? "rtl" : "ltr",
      );
      await expect(
        page.getByText(firmwareMessages[language].requirements, {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page
        .getByRole("button", {
          name: firmwareMessages[language].prepare,
          exact: true,
        })
        .click();
      await expect(
        page.getByText(firmwareMessages[language].ready, { exact: true }),
      ).toBeVisible();
    }
  });

test("cancelling during a write shows pending cleanup and cannot claim completion", async ({
  page,
}) => {
  await inspect(page, "cancel");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: firmwareMessages.en.install, exact: true })
    .click();
  await expect(page.locator("#fixture")).toHaveAttribute("data-writes", "1");
  await page
    .getByRole("button", { name: firmwareMessages.en.cancel, exact: true })
    .click();
  await expect(
    page.getByText(firmwareMessages.en.cancelling, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: firmwareMessages.en.cancel, exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(firmwareMessages.en.cancelled, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#fixture")).toHaveAttribute("data-closes", "1");
  await expect(
    page.getByRole("button", {
      name: firmwareMessages.en.connect,
      exact: true,
    }),
  ).toHaveCount(0);
});
test("firmware setup works without file-system permission, independently of transfer support", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto(production);
  await page
    .getByRole("button", { name: firmwareMessages.en.title, exact: true })
    .click();
  await page
    .getByRole("button", { name: firmwareMessages.en.prepare, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: firmwareMessages.en.choose, exact: true }),
  ).toBeEnabled();
});
