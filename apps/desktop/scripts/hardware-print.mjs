import { _electron as electron } from "playwright";
import { resolve } from "node:path";

if (!process.argv.includes("--confirm-print")) {
  throw new Error(
    "This command prints one physical label. Add -- --confirm-print to continue.",
  );
}

const appDirectory = resolve(import.meta.dirname, "..");
const application = await electron.launch({
  args: ["--no-sandbox", appDirectory],
  env: { ...process.env, LABELMAKER_WINDOW_SIZE: "1100x760" },
});

try {
  const page = await application.firstWindow();
  await page.waitForSelector(".label-canvas");
  const configured = page
    .locator(".printer-item")
    .filter({ hasText: /^YichipFPGA-/ });
  const restored = await configured
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!restored) {
    await page.getByRole("button", { name: "Add printer" }).click();
    const discovered = page
      .locator(".discovery-item")
      .filter({ hasText: /^YichipFPGA-/ });
    await discovered.waitFor({ timeout: 30_000 });
    await discovered.getByRole("button", { name: "Add" }).click();
    await configured.waitFor({ timeout: 60_000 });
  }
  await configured.click();

  await page.getByLabel("Left margin").fill("0");
  await page.getByLabel("Right margin").fill("0");
  await page.getByRole("button", { name: "Trim plate to content" }).click();
  await page.getByRole("button", { name: /^Print$/ }).click();
  await page
    .getByText(/label sent to YichipFPGA-/)
    .waitFor({ timeout: 90_000 });
  process.stdout.write("The trimmed desktop hardware print completed.\n");
} finally {
  await application.close();
}
