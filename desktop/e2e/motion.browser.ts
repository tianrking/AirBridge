import { test, expect } from "./test";

test("waves propagate, pause, follow transfer state and stop on disconnect", async ({
  page,
}) => {
  await page.goto("/tests/motion.html");
  const stage = page.locator(".discovery-stage");
  const wave = page.locator(".signal-waves > span").first();
  await expect(stage).toHaveAttribute("data-signal", "listening");
  await expect(wave).toHaveCSS("animation-name", "signal-expand");
  await expect(wave).toHaveCSS("animation-duration", "6.4s");
  const original = await wave.evaluate((el) => getComputedStyle(el).transform);
  await expect
    .poll(() => wave.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(original);
  await page
    .getByRole("button", { name: "Pause signal animation", exact: true })
    .click();
  await expect(stage).toHaveAttribute("data-motion", "paused");
  await expect(wave).toHaveCSS("animation-play-state", "paused");
  const paused = await wave.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(150); // Deliberately observe that a paused animation stays still.
  expect(await wave.evaluate((el) => getComputedStyle(el).transform)).toBe(
    paused,
  );
  await page
    .getByRole("button", { name: "Resume signal animation", exact: true })
    .click();
  await expect(wave).toHaveCSS("animation-play-state", "running");
  await page.getByRole("button", { name: "Toggle transfer ring" }).click();
  await expect(stage).toHaveAttribute("data-signal", "transferring");
  await expect(wave).toHaveCSS("animation-duration", "4.8s");
  await page.getByRole("button", { name: "Toggle transfer ring" }).click();
  await expect(stage).toHaveAttribute("data-signal", "listening");
  await expect(wave).toHaveCSS("animation-duration", "6.4s");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(stage).toHaveAttribute("data-signal", "idle");
  await expect(page.locator(".signal-waves")).toBeHidden();
  await expect(page.locator(".peer-card:not(:disabled)")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pause signal animation", exact: true }),
  ).toBeDisabled();
});

test("background visibility pauses decorative waves without changing connection", async ({
  page,
}) => {
  await page.goto("/tests/motion.html");
  const stage = page.locator(".discovery-stage");
  // Exercise the browser visibility-event boundary deterministically. This is
  // event injection, not a claim to test OS suspension or physical serial.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stage).toHaveAttribute("data-motion", "hidden");
  await expect(stage).toHaveAttribute("data-signal", "listening");
  await expect(page.locator(".signal-waves > span").first()).toHaveCSS(
    "animation-play-state",
    "paused",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stage).toHaveAttribute("data-motion", "running");
  await page
    .getByRole("button", { name: "Pause signal animation", exact: true })
    .click();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(stage).toHaveAttribute("data-motion", "paused");
});

test("reduced motion is honored on load and when changed, with keyboard control", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/motion.html");
  const stage = page.locator(".discovery-stage");
  await expect(stage).toHaveAttribute("data-motion", "reduced");
  await expect(page.locator(".signal-waves")).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Animation reduced by system preference",
    }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      stage.evaluate((el) => el.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const pause = page.getByRole("button", {
    name: "Pause signal animation",
    exact: true,
  });
  await expect(pause).toBeEnabled();
  await pause.focus();
  await page.keyboard.press("Enter");
  await expect(stage).toHaveAttribute("data-motion", "paused");
  await page.getByLabel("Preview language").selectOption("zh-Hant");
  await expect(
    page.getByRole("button", { name: "繼續訊號動畫" }),
  ).toBeVisible();
  await page.getByLabel("Preview language").selectOption("es");
  await expect(
    page.getByRole("button", { name: "Reanudar animación de señal" }),
  ).toBeVisible();
});

test("device disappearance disables selection before its visual exit", async ({
  page,
}) => {
  await page.goto("/tests/motion.html");
  await page
    .getByRole("button", { name: "Remove iPhone", exact: true })
    .click();
  await expect(
    page.locator('[data-peer="02:00:00:00:00:02"] .peer-card'),
  ).toBeDisabled();
  await expect(page.locator('[data-peer="02:00:00:00:00:02"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Add iPhone", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Choose a recipient: iPhone",
      exact: true,
    }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
