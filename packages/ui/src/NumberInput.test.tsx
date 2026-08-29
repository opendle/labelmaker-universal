// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { NumberInput } from "./NumberInput.js";

function NumberInputHarness() {
  const [value, setValue] = useState(18);
  return (
    <>
      <NumberInput
        aria-label="Test value"
        onValueChange={setValue}
        value={value}
      />
      <output>{value}</output>
    </>
  );
}

function SnappedNumberInputHarness() {
  const [value, setValue] = useState(0);
  return (
    <>
      <NumberInput
        aria-label="Snapped value"
        normalizeValue={(nextValue) => Math.round(nextValue / 45) * 45}
        onValueChange={setValue}
        value={value}
      />
      <output>{value}</output>
    </>
  );
}

describe("NumberInput", () => {
  it("keeps an empty draft and accepts its replacement", () => {
    render(<NumberInputHarness />);
    const input = screen.getByLabelText("Test value");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue(null);
    expect(screen.getByText("18")).toBeInTheDocument();

    fireEvent.blur(input);
    expect(input).toHaveValue(18);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "20" } });
    expect(input).toHaveValue(20);
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("keeps a normalized multi-digit draft until blur", async () => {
    const user = userEvent.setup();
    render(<SnappedNumberInputHarness />);
    const input = screen.getByLabelText("Snapped value");

    await user.clear(input);
    await user.type(input, "68");

    expect(input).toHaveValue(68);
    expect(screen.getByText("90")).toBeInTheDocument();

    await user.tab();
    expect(input).toHaveValue(90);
  });
});
