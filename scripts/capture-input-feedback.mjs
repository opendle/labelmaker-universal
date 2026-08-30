export async function installCaptureInputFeedback(page, mode) {
  if (mode !== "mouse" && mode !== "touch") {
    throw new Error("Capture input feedback must be mouse or touch.");
  }
  await page.evaluate((feedbackMode) => {
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    Object.assign(layer.style, {
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      position: "fixed",
      zIndex: "2147483647",
    });
    document.documentElement.append(layer);

    const cursor = document.createElement("div");
    cursor.innerHTML = `
      <svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true">
        <path d="M2 1.5 2.3 25l6.1-5.4 4.4 10.1 4.5-2-4.4-9.9 8-.4Z"
          fill="white" stroke="#111827" stroke-linejoin="round" stroke-width="1.8" />
      </svg>`;
    Object.assign(cursor.style, {
      display: feedbackMode === "mouse" ? "block" : "none",
      filter: "drop-shadow(0 1px 1px rgb(255 255 255 / 0.8))",
      height: "32px",
      left: "50%",
      position: "absolute",
      top: "50%",
      transform: "translate(-2px, -2px)",
      width: "24px",
    });
    layer.append(cursor);

    const positionCursor = (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    };
    const showPress = (event) => {
      positionCursor(event);
      const press = document.createElement("div");
      Object.assign(press.style, {
        background: "rgb(255 255 255 / 0.22)",
        border: "3px solid rgb(17 24 39 / 0.72)",
        borderRadius: "50%",
        boxShadow: "0 0 0 2px rgb(255 255 255 / 0.82)",
        height: feedbackMode === "touch" ? "36px" : "24px",
        left: `${event.clientX}px`,
        opacity: "1",
        position: "absolute",
        top: `${event.clientY}px`,
        transform: "translate(-50%, -50%) scale(0.55)",
        transition: "opacity 420ms ease-out, transform 420ms ease-out",
        width: feedbackMode === "touch" ? "36px" : "24px",
      });
      layer.insertBefore(press, cursor);
      requestAnimationFrame(() => {
        press.style.opacity = "0";
        press.style.transform = "translate(-50%, -50%) scale(1.35)";
      });
      setTimeout(() => press.remove(), 460);
    };

    document.addEventListener("pointermove", positionCursor, true);
    document.addEventListener("pointerdown", showPress, true);
  }, mode);
}

const mousePositions = new WeakMap();

export async function clickWithVisibleMouse(page, locator) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error("The mouse target is not visible.");
  const target = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const viewport = page.viewportSize();
  const start = mousePositions.get(page) ?? {
    x: (viewport?.width ?? 1_440) / 2,
    y: (viewport?.height ?? 810) / 2,
  };
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  const steps = Math.max(12, Math.min(24, Math.ceil(distance / 45)));
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    await page.mouse.move(
      start.x + (target.x - start.x) * eased,
      start.y + (target.y - start.y) * eased,
    );
    await page.waitForTimeout(24);
  }
  mousePositions.set(page, target);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await page.waitForTimeout(90);
}
