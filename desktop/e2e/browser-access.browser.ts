import { test, expect } from "./test";

const production = "http://127.0.0.1:1431/";

test("default production surface is animated before any hardware permission", async ({
  page,
}) => {
  await page.goto(production);
  const stage = page.locator(".discovery-stage");
  await expect(stage).toHaveAttribute("data-signal", "idle");
  const ambient = page.locator(".ambient-field > span").first();
  await expect(ambient).toHaveCSS("animation-name", "ambient-drift");
  const before = await ambient.evaluate((el) => getComputedStyle(el).transform);
  await expect
    .poll(() => ambient.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(before);
  await page
    .getByRole("button", { name: "Pause animations", exact: true })
    .click();
  await expect(ambient).toHaveCSS("animation-play-state", "paused");
  await expect(page.locator(".signal-waves")).toBeHidden();
  await expect(page.locator(".peer-card")).toHaveCount(0);
});

test("API availability is explained without claiming permission was granted", async ({
  page,
}) => {
  await page.goto(production);
  await expect(page.locator(".browser-access")).toHaveAttribute(
    "data-support",
    "ready",
  );
  await expect(
    page.getByText("Permissions requested only when you choose to connect.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.locator(".browser-access summary").click();
  await expect(
    page.getByText("Web Serial does not show Windows COM numbers.", {
      exact: false,
    }),
  ).toBeVisible();
});

for (const code of ["serial", "storage", "insecure"] as const) {
  test(`unsupported ${code} explains recovery and blocks connection`, async ({
    page,
  }) => {
    await page.addInitScript((feature) => {
      if (feature === "serial")
        Object.defineProperty(navigator, "serial", {
          configurable: true,
          value: undefined,
        });
      if (feature === "storage")
        Object.defineProperty(window, "showDirectoryPicker", {
          configurable: true,
          value: undefined,
        });
      if (feature === "insecure")
        Object.defineProperty(window, "isSecureContext", {
          configurable: true,
          value: false,
        });
    }, code);
    await page.goto(production);
    await expect(page.locator(".browser-access")).toHaveAttribute(
      "data-support",
      code,
    );
    await expect(
      page.getByRole("button", { name: "Choose receive folder", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".browser-access details")).toHaveAttribute(
      "open",
      "",
    );
  });
}

test("a real denying Permissions-Policy header is detected", async ({
  page,
}) => {
  await page.route(production, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "permissions-policy": "serial=()" },
    });
  });
  await page.goto(production);
  await expect(page.locator(".browser-access")).toHaveAttribute(
    "data-support",
    "policy",
  );
  await expect(
    page.getByRole("button", { name: "Choose receive folder", exact: true }),
  ).toBeDisabled();
});

test("embedded previews show an actionable full-page link", async ({
  page,
}) => {
  await page.route("**/embedded-acceptance", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<iframe src="/" title="AirBridge"></iframe>',
    }),
  );
  await page.goto(production + "embedded-acceptance");
  const frame = page.frameLocator('iframe[title="AirBridge"]');
  await expect(frame.locator(".browser-access")).toHaveAttribute(
    "data-support",
    "embedded",
  );
  await expect(
    frame.getByRole("link", { name: "Open in a full browser tab" }),
  ).toBeVisible();
});

test("folder permission denial leaves the bridge disconnected and offers a retry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: () =>
        Promise.reject(new DOMException("Access denied", "NotAllowedError")),
    });
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort() {
          throw new Error("Serial must not be opened after folder denial");
        },
      },
    });
  });
  await page.goto(production);
  await page
    .getByRole("button", { name: "Choose receive folder", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Try the button again");
  await expect(page.locator(".discovery-stage")).toHaveAttribute(
    "data-signal",
    "idle",
  );
  await expect(
    page.getByRole("button", { name: "Choose receive folder", exact: true }),
  ).toBeEnabled();
});
