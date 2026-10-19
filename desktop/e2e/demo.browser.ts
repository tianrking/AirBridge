import { test, expect } from "./test";
import { locales, messages } from "../src/i18n";

for (const { id, dir } of locales)
  test(`${id}: public demo is isolated from hardware and files`, async ({
    page,
  }) => {
    const { ui } = messages[id];
    await page.addInitScript((id) => {
      localStorage.setItem("airbridge.language.v1", id);
      const denied = () => {
        throw Error("Demo attempted a real device or file request");
      };
      Object.defineProperty(navigator, "serial", {
        configurable: true,
        value: { getPorts: denied, requestPort: denied },
      });
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: denied,
      });
      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: denied,
      });
    }, id);
    await page.goto("http://127.0.0.1:1431/?demo=1");
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    await expect(page.locator(".demo-banner")).toContainText(ui.demoDisclosure);
    await expect(
      page.getByRole("button", { name: ui.authorizePeer, exact: true }),
    ).toBeDisabled();
    await page
      .locator(".peer-card")
      .filter({ hasText: "Studio MacBook Pro" })
      .click();
    await page
      .getByRole("button", { name: ui.authorizePeer, exact: true })
      .click();
    await expect(page.locator(".receive-permissions")).toContainText(
      ui.authorizedPeer,
    );
    await page
      .getByRole("button", { name: ui.chooseFile, exact: true })
      .click();
    await page.locator(".send-button").click();
    await expect(page.locator(".discovery-stage")).toHaveAttribute(
      "data-signal",
      "transferring",
    );
    await expect(
      page.locator(".transfer-row").filter({ hasText: "Sample document.pdf" }),
    ).toHaveClass(/state-completed/, { timeout: 10000 });
    await page
      .locator(".transfer-row")
      .filter({ hasText: "Sample document.pdf" })
      .click();
    await expect(page.getByRole("dialog")).toContainText(ui.demoComplete);
    await page.getByRole("button", { name: ui.close, exact: true }).click();
    await expect(page.getByText(ui.sent, { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: ui.exitDemo, exact: true }).click();
    await expect(page.locator(".demo-banner")).toHaveCount(0);
    await expect(page.locator(".discovery-stage")).toHaveAttribute(
      "data-signal",
      "idle",
    );
    await expect(page.locator(".peer-card")).toHaveCount(0);
  });

test("public demo cancellation never reports native delivery", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:1431/?demo=1");
  await page.locator(".peer-card").first().click();
  await page
    .getByRole("button", { name: "Choose a file", exact: true })
    .click();
  await page.locator(".send-button").click();
  await page
    .locator(".transfer-row")
    .filter({ hasText: "Sample document.pdf" })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByText("Cancelled", { exact: true }).first(),
  ).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(
    page.getByText(messages.en.ui.demoComplete, { exact: true }),
  ).toHaveCount(0);
});

test("demo reconnect clears authorization and activity cannot export a file", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const denied = () => {
      throw Error("Demo requested a real device or disk operation");
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { getPorts: denied, requestPort: denied },
    });
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: denied,
    });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: denied,
    });
  });
  await page.goto("http://127.0.0.1:1431/?demo=1");
  await page.locator(".peer-card").first().click();
  await page
    .getByRole("button", { name: messages.en.ui.authorizePeer, exact: true })
    .click();
  await page.getByRole("button", { name: /^Activity(?: \d+)?$/ }).click();
  await expect(
    page.getByRole("button", {
      name: messages.en.ui.exportActivity,
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: messages.en.ui.share, exact: true })
    .click();
  await page
    .getByRole("button", { name: messages.en.ui.disconnect, exact: true })
    .click();
  await expect(page.locator(".discovery-stage")).toHaveAttribute(
    "data-signal",
    "idle",
  );
  await page
    .getByRole("button", { name: messages.en.ui.connect, exact: true })
    .click();
  await expect(page.locator(".peer-card")).toHaveCount(2);
  await expect(page.locator(".receive-permissions")).not.toContainText(
    messages.en.ui.authorizedPeer,
  );
});
