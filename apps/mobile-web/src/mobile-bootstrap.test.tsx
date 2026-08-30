// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { mountMobileApplication } from "./mobile-bootstrap.js";
import type { NativeBridge } from "./native-bridge.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("mobile application bootstrap", () => {
  it("shows a safe startup message when the native bridge is missing", async () => {
    const root = document.createElement("div");

    await act(() => mountMobileApplication(root));

    expect(root).toHaveTextContent("Label Maker could not start");
    expect(root).toHaveTextContent("Close the application and open it again.");
  });

  it("shows a safe recovery message when native host information fails", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const bridge: NativeBridge = {
      call: async () => {
        throw new Error("private native failure");
      },
      registerConnectionResetHandler: () => () => undefined,
      registerSystemBackHandler: () => () => undefined,
    };

    await act(() => mountMobileApplication(root, bridge));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Label Maker could not start",
    );
    expect(screen.queryByText("private native failure")).toBeNull();
  });
});
