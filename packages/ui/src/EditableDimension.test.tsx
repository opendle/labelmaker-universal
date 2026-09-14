// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { EditableDimension } from "./EditableDimension.js";

function Harness() {
  const [value, setValue] = useState(1.9);
  return (
    <EditableDimension
      label="Margin"
      min={0}
      value={value}
      onChange={setValue}
    />
  );
}

describe("EditableDimension", () => {
  it("uses the unit as a focus target and fits the draft until Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("spinbutton", { name: "Margin" });
    await user.click(screen.getByText("mm"));
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "12");
    fireEvent.change(input, { target: { value: "12.00" } });
    expect(input).toHaveValue(12);
    expect(
      input.parentElement?.querySelector('span[aria-hidden="true"]'),
    ).toHaveTextContent("12.00");
    await user.keyboard("{Enter}");
    expect(input).not.toHaveFocus();
    expect(
      input.parentElement?.querySelector('span[aria-hidden="true"]'),
    ).toHaveTextContent(/^12$/);
  });
});
