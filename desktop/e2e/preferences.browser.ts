import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { locales, messages, fileCount } from "../src/i18n";

const production = "http://127.0.0.1:1431/";

async function fits(page: Page) {
  const overflow = await page.evaluate(() => {
    const targets = document.querySelectorAll<HTMLElement>(
      ".main, .app-shell, .setting-card, .theme-choices, .app-dialog[open], .activity-panel",
    );
    return [...targets]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className}: ${el.scrollWidth}/${el.clientWidth}`);
  });
  expect(
    overflow,
    "No horizontal overflow in either reading direction",
  ).toEqual([]);
  const controls = await page
    .locator(".setting-card button, .setting-card select, .theme-choices span")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => node.textContent),
    );
  expect(controls, "Localized controls must not clip their labels").toEqual([]);
}
async function capture(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: "image/png" });
}

for (const { id, dir } of locales)
  for (const theme of ["light", "dark"] as const) {
    test(`${id} / ${theme}: production navigation, responsive layout, permissions and real detail components`, async ({
      page,
    }) => {
      const { ui, access } = messages[id];
      // Any accidental real-device enumeration or permission request fails the
      // test. Locale/theme navigation never needs a connected board.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "serial", {
          configurable: true,
          value: {
            requestPort() {
              throw Error("Unexpected hardware request");
            },
            getPorts() {
              throw Error("Unexpected hardware enumeration");
            },
          },
        });
      });
      await page.goto(production);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Language", exact: true })
        .selectOption(id);
      await expect(page.locator("html")).toHaveAttribute("lang", id);
      await expect(page.locator("html")).toHaveAttribute("dir", dir);
      await expect(
        page.getByRole("combobox", { name: ui.language, exact: true }),
      ).toHaveValue(id);
      await page.getByRole("button", { name: ui[theme], exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("button", { name: ui[theme], exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("heading", { name: ui.appearance, exact: true }),
      ).toBeVisible();
      await fits(page);
      // Contrast is measured from actual computed foreground / solid setting-card
      // background colors, not just token names or screenshot existence.
      const contrast = await page
        .locator(".setting-copy p")
        .first()
        .evaluate((el) => {
          const luminance = (css: string) => {
            const rgb = css
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((n) => {
                const v = n / 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const a = luminance(getComputedStyle(el).color),
            b = luminance(
              getComputedStyle(el.closest(".setting-card")!).backgroundColor,
            );
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      await capture(page, `${id}-${theme}-settings-desktop`);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", id);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("heading", { name: ui.title, exact: true }),
      ).toBeVisible();
      await page.locator(".browser-access summary").click();
      await expect(
        page.getByText(access.steps[1], { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(access.denied, { exact: true }),
      ).toBeVisible();
      await page.locator(".browser-access summary").click();
      await capture(page, `${id}-${theme}-share-desktop`);
      await page
        .getByRole("button", { name: ui.activity, exact: true })
        .click();
      await expect(
        page.getByRole("searchbox", { name: ui.searchTransfers }),
      ).toBeVisible();
      await expect(
        page.getByText(ui.emptyActivityHelp, { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: ui.settings, exact: true })
        .click();
      await page.setViewportSize({ width: 390, height: 844 });
      await fits(page);
      await capture(page, `${id}-${theme}-settings-mobile`);
      await page.getByRole("button", { name: ui.share, exact: true }).click();
      await fits(page);
      await capture(page, `${id}-${theme}-share-mobile`);
      // Development-only synthetic data exercises production device / transfer
      // dialogs. It is never bundled or presented as hardware acceptance.
      await page.addInitScript(
        ({ id, theme }) => {
          localStorage.setItem("airbridge.language.v1", id);
          localStorage.setItem("airbridge.theme.v1", theme);
        },
        { id, theme },
      );
      await page.goto("/tests/product.html");
      await expect(page.locator("html")).toHaveAttribute("dir", dir);
      await page
        .getByRole("button", {
          name: `${ui.deviceDetails}: Studio MacBook Pro`,
          exact: true,
        })
        .click();
      await expect(page.getByRole("dialog")).toContainText(ui.signalHint);
      const address = page.getByRole("dialog").locator("code").first();
      await expect(address).toHaveText("02:00:00:00:00:01");
      await expect(address).toHaveAttribute("dir", "ltr");
      await fits(page);
      await page.getByRole("button", { name: ui.close, exact: true }).click();
      await page
        .getByRole("button", {
          name: `${ui.details}: ${fileCount(2, id)}`,
          exact: true,
        })
        .click();
      await expect(page.getByRole("dialog")).toContainText(ui.hashChecked);
      await page
        .getByRole("dialog")
        .getByText("Coastline.jpg", { exact: true })
        .click();
      await expect(
        page.getByRole("dialog").locator("code[dir=ltr]").first(),
      ).toHaveText("a".repeat(64));
      await fits(page);
      await capture(page, `${id}-${theme}-checked-receive-mobile`);
    });
  }

test("English is the default even with an Arabic browser locale; invalid saved values recover", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "ar-EG",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.addInitScript(() => {
      localStorage.setItem("airbridge.language.v1", "unsupported");
      localStorage.setItem("airbridge.theme.v1", "unknown");
    });
    await page.goto(production);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("system appearance follows OS changes, explicit choice persists, motion remains independent", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(production);
  await page
    .getByRole("button", { name: "Pause animations", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "System", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("Currently dark", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Resume animations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("denied preference storage still allows live language, RTL and theme changes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
  });
  await page.goto(production);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("ar");
  await page
    .getByRole("button", { name: messages.ar.ui.dark, exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("combobox", { name: messages.ar.ui.language, exact: true })
    .selectOption("fr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(
    page.getByRole("heading", { name: messages.fr.ui.appearance, exact: true }),
  ).toBeVisible();
});

for (const { id } of locales)
  test(`${id}: permission-denial recovery is localized`, async ({ page }) => {
    await page.addInitScript((id) => {
      localStorage.setItem("airbridge.language.v1", id);
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      });
    }, id);
    await page.goto(production);
    await page
      .getByRole("button", { name: messages[id].web.prepare, exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      messages[id].access.denied,
    );
    await expect(page.locator(".discovery-stage")).toHaveAttribute(
      "data-signal",
      "idle",
    );
    await expect(
      page.getByRole("button", { name: messages[id].web.prepare, exact: true }),
    ).toBeEnabled();
  });
