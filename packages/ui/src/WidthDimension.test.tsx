// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { LabelPlate } from "@labelmaker/domain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidthDimension } from "./WidthDimension.js";

const plate: LabelPlate = {
  id: "plate",
  name: "Label",
  size: { widthMm: 40, heightMm: 16 },
  margins: { leftMm: 0, rightMm: 0 },
  elements: [],
};
afterEach(cleanup);

function Harness({
  fixed = false,
  minimum = 0,
  onChange = (_plate: LabelPlate) => {},
}) {
  const [value, setValue] = useState<LabelPlate>({
    ...plate,
    widthMode: fixed ? "fixed" : "auto",
  });
  return (
    <WidthDimension
      plate={value}
      outputWidthMm={Math.max(minimum, value.size.widthMm)}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe("WidthDimension", () => {
  it("sets a fixed width on Enter and shows its state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Plate width/ }));
    const input = screen.getByRole("spinbutton", { name: "Plate width" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "52.5" } });
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        widthMode: "fixed",
        size: { widthMm: 52.5, heightMm: 16 },
      }),
    );
    expect(
      screen.getByRole("button", { name: /52.5 mm, fixed/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("restores automatic width and closes the edit without applying its draft", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness fixed onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Plate width/ }));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "80" },
    });
    await user.click(
      screen.getByRole("button", { name: "Use automatic width" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ widthMode: "auto", size: plate.size }),
    );
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("cancels a draft with Escape and preserves an empty draft on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Plate width/ }));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "55" },
    });
    await user.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Plate width/ }));
    await user.clear(screen.getByRole("spinbutton"));
    await user.click(document.body);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("edits the saved width when the printer adds blank paper", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness fixed minimum={60} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /60 mm, fixed/ }));
    expect(screen.getByRole("spinbutton")).toHaveValue(40);
    await user.click(document.body);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects widths above the saved document limit on Enter and blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Plate width/ }));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "10001" },
    });
    await user.keyboard("{Enter}");
    expect(screen.getByRole("spinbutton")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(document.body);
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /40 mm, automatic/ }),
    ).toBeInTheDocument();
  });

  it("makes the automatic action available from a keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness fixed />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("spinbutton")).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Use automatic width" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /40 mm, automatic/ }),
    ).toBeInTheDocument();
  });
});
