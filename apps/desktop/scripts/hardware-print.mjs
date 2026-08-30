import { _electron as electron } from "playwright";
import { resolve } from "node:path";

if (!process.argv.includes("--confirm-print")) {
  throw new Error(
    "This command prints one physical label. Add -- --confirm-print to continue.",
  );
}

const appDirectory = resolve(import.meta.dirname, "..");
const makeIdE1Name = String.raw`(?:YichipFPGA-[A-Za-z0-9]+|E1\d{2}[A-Za-z]\d{5})`;
const listedName = new RegExp(`^${makeIdE1Name}`, "i");
const successMessage = /label sent to .+$/i;
const application = await electron.launch({
  args: ["--no-sandbox", appDirectory],
  env: { ...process.env, LABELMAKER_WINDOW_SIZE: "1100x760" },
});

try {
  const page = await application.firstWindow();
  await page.waitForSelector(".label-canvas");
  const configuredTrigger = page.getByRole("button", {
    name: /^Selected printer:/,
  });
  const restored = await configuredTrigger
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!restored) {
    const directAdd = page.getByRole("button", { name: "Add printer" });
    if (await directAdd.isVisible()) {
      await directAdd.click();
    } else {
      await page
        .getByRole("button", { name: /^(Selected printer:|Choose printer)/ })
        .click();
      await page.getByRole("menuitem", { name: "Add a printer" }).click();
    }
    const discovered = page
      .locator(".discovery-item")
      .filter({ hasText: listedName });
    await discovered.waitFor({ timeout: 30_000 });
    await discovered.getByRole("button", { name: "Add" }).click();
    await configuredTrigger.waitFor({ timeout: 60_000 });
  }
  await page.getByLabel("Left margin").fill("0");
  await page.getByLabel("Right margin").fill("0");
  await page.getByLabel("Right margin").blur();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /^Print$/ }).click();
  await page.getByText(successMessage).waitFor({ timeout: 90_000 });
  process.stdout.write("The trimmed desktop hardware print completed.\n");
} finally {
  await application.close();
}
