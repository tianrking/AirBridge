import { test, expect } from "./test";
import type { Locator } from "@playwright/test";

const waveClock = (wave: Locator) =>
  wave.evaluate((el) => {
    const animation = el
      .getAnimations()
      .find(
        (item) =>
          item instanceof CSSAnimation &&
          item.animationName === "signal-expand",
      );
    return {
      rate: animation?.playbackRate,
      time: animation?.currentTime as number | undefined,
    };
  });

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
    .getByRole("button", { name: "Pause animations", exact: true })
    .click();
  await expect(stage).toHaveAttribute("data-motion", "paused");
  await expect(wave).toHaveCSS("animation-play-state", "paused");
  const paused = await wave.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(150); // Deliberately observe that a paused animation stays still.
  expect(await wave.evaluate((el) => getComputedStyle(el).transform)).toBe(
    paused,
  );
  await page
    .getByRole("button", { name: "Resume animations", exact: true })
    .click();
  await expect(wave).toHaveCSS("animation-play-state", "running");
  await page.getByRole("button", { name: "Toggle transfer ring" }).click();
  await expect(stage).toHaveAttribute("data-signal", "transferring");
  await expect.poll(async () => (await waveClock(wave)).rate).toBe(4 / 3);
  await page.getByRole("button", { name: "Toggle transfer ring" }).click();
  await expect(stage).toHaveAttribute("data-signal", "listening");
  await expect.poll(async () => (await waveClock(wave)).rate).toBe(1);
  await expect(wave).toHaveCSS("animation-duration", "6.4s");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(stage).toHaveAttribute("data-signal", "idle");
  await expect(page.locator(".signal-waves")).toBeHidden();
  await expect(page.locator(".peer-card:not(:disabled)")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pause animations", exact: true }),
  ).toBeEnabled();
});

test("pause survives route changes and reload without turning radio activity on", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:1431/");
  await page
    .getByRole("button", { name: "Pause animations", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.locator(".discovery-stage")).toHaveAttribute(
    "data-motion",
    "paused",
  );
  await page.reload();
  await expect(page.locator(".discovery-stage")).toHaveAttribute(
    "data-motion",
    "paused",
  );
  await expect(page.locator(".discovery-stage")).toHaveAttribute(
    "data-signal",
    "idle",
  );
  await page
    .getByRole("button", { name: "Resume animations", exact: true })
    .click();
  await expect(page.locator(".ambient-field > span").first()).toHaveCSS(
    "animation-play-state",
    "running",
  );
});

test("transfer tempo preserves a paused wave's phase", async ({ page }) => {
  await page.goto("/tests/motion.html");
  await page
    .getByRole("button", { name: "Pause animations", exact: true })
    .click();
  const wave = page.locator(".signal-waves > span").first();
  const phase = (await waveClock(wave)).time!;
  await page.getByRole("button", { name: "Toggle transfer ring" }).click();
  await expect.poll(async () => (await waveClock(wave)).rate).toBe(4 / 3);
  await expect(wave).toHaveCSS("animation-play-state", "paused");
  expect(Math.abs((await waveClock(wave)).time! - phase)).toBeLessThan(1);
});

test("a returning device reverses its exit without flashing or duplicating", async ({
  page,
}) => {
  await page.goto("/tests/motion.html");
  const phone = page.locator('[data-peer="02:00:00:00:00:02"] .peer-card');
  await expect(phone).toHaveCSS("opacity", "1");
  const sample = await page.evaluate(async () => {
    const button = (label: string) =>
      [...document.querySelectorAll("button")].find(
        (el) => el.textContent === label,
      )!;
    const card = document.querySelector<HTMLElement>(
      '[data-peer="02:00:00:00:00:02"] .peer-card',
    )!;
    button("Remove iPhone").click();
    await Promise.resolve();
    const exit = card
      .getAnimations()
      .find(
        (animation) =>
          animation instanceof CSSTransition &&
          animation.transitionProperty === "opacity",
      );
    if (!exit) throw new Error("Device exit did not transition");
    exit.pause();
    exit.currentTime = 90;
    const leaving = Number(getComputedStyle(card).opacity);
    const disabled = (card as HTMLButtonElement).disabled;
    button("Add iPhone").click();
    await Promise.resolve();
    return {
      disabled,
      leaving,
      returning: Number(getComputedStyle(card).opacity),
      same:
        card ===
        document.querySelector('[data-peer="02:00:00:00:00:02"] .peer-card'),
    };
  });
  expect(sample.disabled).toBe(true);
  expect(sample.same).toBe(true);
  expect(sample.leaving).toBeGreaterThan(0);
  expect(sample.leaving).toBeLessThan(1);
  expect(sample.returning).toBeGreaterThan(0);
  await expect(phone).toBeEnabled();
  await expect(phone).toHaveCSS("opacity", "1");
  await expect(page.locator('[data-peer="02:00:00:00:00:02"]')).toHaveCount(1);
});

test("selection and transfer progress share smooth transitions without early success", async ({
  page,
}) => {
  await page.goto("/tests/motion.html");
  const mac = page.getByRole("button", {
    name: "Choose a recipient: Studio MacBook Pro",
    exact: true,
  });
  const phone = page.getByRole("button", {
    name: "Choose a recipient: iPhone",
    exact: true,
  });
  await phone.click();
  await expect(phone).toHaveAttribute("aria-pressed", "true");
  await expect(mac).toHaveAttribute("aria-pressed", "false");
  await expect(phone.locator(".peer-selected")).toHaveCSS("opacity", "1");
  await expect(mac.locator(".peer-selected")).toHaveCSS("opacity", "0");
  await mac.click();
  await page.getByRole("button", { name: "Progress 15%", exact: true }).click();
  const value = page.locator(".peer-progress-value");
  await expect(value).toHaveCSS("stroke-dashoffset", "85px");
  const middle = await page.evaluate(async () => {
    [...document.querySelectorAll("button")]
      .find((el) => el.textContent === "Progress 82%")!
      .click();
    await Promise.resolve();
    const circle = document.querySelector(".peer-progress-value")!;
    const animation = circle
      .getAnimations()
      .find(
        (item) =>
          item instanceof CSSTransition &&
          item.transitionProperty === "stroke-dashoffset",
      );
    if (!animation) throw new Error("Progress ring did not interpolate");
    animation.pause();
    animation.currentTime = 220;
    return parseFloat(getComputedStyle(circle).strokeDashoffset);
  });
  expect(middle).toBeGreaterThan(18);
  expect(middle).toBeLessThan(85);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "82",
  );
  await page.getByRole("button", { name: "Await native confirmation" }).click();
  await expect(page.locator(".transfer-row")).toHaveClass(/state-finishing/);
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(page.locator(".success-text")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Confirm synthetic completion" })
    .click();
  await expect(page.locator(".transfer-row")).toHaveClass(/state-completed/);
  await expect(page.locator(".success-text")).toBeVisible();
  await expect(page.locator(".peer-progress-rotor")).toHaveCount(0);
});

test("unknown progress rotates the wrapper and reduced motion removes interpolation", async ({
  page,
}) => {
  await page.goto("/tests/motion.html");
  await page
    .getByRole("button", { name: "Unknown progress", exact: true })
    .click();
  await expect(page.locator(".peer-progress-rotor")).toHaveCSS(
    "animation-name",
    "spin",
  );
  await expect(page.locator(".peer-progress")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.getByRole("progressbar")).not.toHaveAttribute(
    "aria-valuenow",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Progress 82%", exact: true }).click();
  await expect(page.locator(".peer-progress-value")).toHaveCSS(
    "stroke-dashoffset",
    "18px",
  );
  await expect(page.locator(".peer-progress-value")).toHaveCSS(
    "transition-duration",
    "0s",
  );
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
    .getByRole("button", { name: "Pause animations", exact: true })
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
    name: "Pause animations",
    exact: true,
  });
  await expect(pause).toBeEnabled();
  await pause.focus();
  await page.keyboard.press("Enter");
  await expect(stage).toHaveAttribute("data-motion", "paused");
  await page.getByLabel("Preview language").selectOption("zh-Hant");
  await expect(
    page.getByRole("button", { name: "繼續動態效果" }),
  ).toBeVisible();
  await page.getByLabel("Preview language").selectOption("es");
  await expect(
    page.getByRole("button", { name: "Reanudar animaciones" }),
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
