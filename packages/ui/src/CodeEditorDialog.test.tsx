// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CodeElement } from "@labelmaker/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodeEditorDialog,
  type CodeConfiguration,
} from "./CodeEditorDialog.js";

afterEach(cleanup);
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const codeElement = (code: CodeConfiguration): CodeElement => ({
  ...code,
  id: "code",
  xMm: 0,
  yMm: 0,
  widthMm: 20,
  heightMm: 20,
  rotationDeg: 0,
});

describe("CodeEditorDialog", () => {
  it.each(["qr", "barcode"] as const)(
    "adds %s without a margin and restores the selected margin",
    (kind) => {
      const onSave = vi.fn();
      const view = render(
        <CodeEditorDialog kind={kind} onClose={vi.fn()} onSave={onSave} />,
      );
      change(kind === "qr" ? "Text" : "Content", "ABC-123");
      const checkbox = screen.getByRole("checkbox", { name: "Add margin" });
      expect(checkbox).not.toBeChecked();
      const preview = screen.getByRole("img", { name: /preview$/ });
      const source = preview.getAttribute("src");
      fireEvent.click(
        screen.getByRole("button", {
          name: kind === "qr" ? "Add QR code" : "Add barcode",
        }),
      );
      expect(onSave.mock.lastCall?.[0].includeMargin).toBe(false);
      fireEvent.click(checkbox);
      expect(preview.getAttribute("src")).not.toBe(source);
      fireEvent.click(
        screen.getByRole("button", {
          name: kind === "qr" ? "Add QR code" : "Add barcode",
        }),
      );
      expect(onSave.mock.lastCall?.[0].includeMargin).toBe(true);
      expect(screen.queryByText(/Higher correction/)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Keep the white border/),
      ).not.toBeInTheDocument();
      const saved = onSave.mock.lastCall?.[0] as CodeConfiguration;
      view.unmount();
      render(
        <CodeEditorDialog
          kind={kind}
          initialCode={codeElement(saved)}
          onClose={vi.fn()}
          onSave={onSave}
        />,
      );
      expect(
        screen.getByRole("checkbox", { name: "Add margin" }),
      ).toBeChecked();
    },
  );

  it("changes the preview when Medium changes to High for short content", () => {
    const onSave = vi.fn();
    render(<CodeEditorDialog kind="qr" onClose={vi.fn()} onSave={onSave} />);
    change("Text", "hello");
    const preview = screen.getByRole("img", { name: "QR code preview" });
    const medium = preview.getAttribute("src");
    change("Error correction", "Q");
    expect(preview.getAttribute("src")).not.toBe(medium);
    fireEvent.click(screen.getByRole("button", { name: "Add QR code" }));
    expect(onSave.mock.lastCall?.[0].qr.errorCorrection).toBe("Q");
  });

  it("blocks empty content and saves text with correction and a live preview", () => {
    const onSave = vi.fn();
    render(<CodeEditorDialog kind="qr" onClose={vi.fn()} onSave={onSave} />);
    expect(
      screen.getByRole("combobox", { name: "QR code type" }),
    ).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add QR code" })).toBeDisabled();
    change("Text", "Shelf A\nBox 5");
    change("Error correction", "H");
    expect(
      screen.getByRole("img", { name: "QR code preview" }),
    ).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"));
    fireEvent.click(screen.getByRole("button", { name: "Add QR code" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "Shelf A\nBox 5",
        qr: {
          data: { type: "text", text: "Shelf A\nBox 5" },
          errorCorrection: "H",
        },
      }),
    );
  });

  it("keeps raw Wi-Fi fields when switching types and hides the password for open networks", () => {
    const onSave = vi.fn();
    render(<CodeEditorDialog kind="qr" onClose={vi.fn()} onSave={onSave} />);
    change("QR code type", "wifi");
    change("Network name", "Workshop;West");
    change("Password", "safe:password");
    fireEvent.click(screen.getByRole("checkbox", { name: "Hidden network" }));
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    change("QR code type", "text");
    change("Text", "A note");
    change("QR code type", "wifi");
    expect(screen.getByLabelText("Network name")).toHaveValue("Workshop;West");
    fireEvent.click(screen.getByRole("button", { name: "Add QR code" }));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        qr: {
          data: {
            type: "wifi",
            ssid: "Workshop;West",
            password: "safe:password",
            security: "WPA",
            hidden: true,
          },
          errorCorrection: "M",
        },
      }),
    );
    change("Security", "nopass");
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add QR code" }));
    expect(onSave.mock.lastCall?.[0].qr.data.password).toBe("");
  });

  it("restores structured data and changes its type without a stale payload", () => {
    const onSave = vi.fn();
    render(
      <CodeEditorDialog
        kind="qr"
        initialCode={codeElement({
          kind: "qr",
          value: "stale",
          qr: {
            data: {
              type: "email",
              address: "one@example.com",
              subject: "Hello",
              body: "Line one\nLine two",
            },
            errorCorrection: "Q",
          },
        })}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "one@example.com",
    );
    expect(screen.getByLabelText("Message")).toHaveValue("Line one\nLine two");
    change("QR code type", "url");
    change("Website address", "example.com");
    expect(screen.getByRole("button", { name: "Save QR code" })).toBeDisabled();
    change("Website address", "https://example.com/path?a=1&b=2");
    fireEvent.click(screen.getByRole("button", { name: "Save QR code" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "https://example.com/path?a=1&b=2",
        qr: {
          data: { type: "url", url: "https://example.com/path?a=1&b=2" },
          errorCorrection: "Q",
        },
      }),
    );
  });

  it("does not treat missing coordinates as zero, and rejects coordinates outside the limits", () => {
    const onSave = vi.fn();
    render(<CodeEditorDialog kind="qr" onClose={vi.fn()} onSave={onSave} />);
    change("QR code type", "geo");
    change("Latitude", "0");
    expect(screen.getByRole("button", { name: "Add QR code" })).toBeDisabled();
    change("Longitude", "181");
    expect(screen.getByRole("button", { name: "Add QR code" })).toBeDisabled();
    change("Longitude", "-45.25");
    fireEvent.click(screen.getByRole("button", { name: "Add QR code" }));
    expect(onSave.mock.lastCall?.[0].qr.data).toEqual({
      type: "geo",
      latitude: 0,
      longitude: -45.25,
    });
  });

  it.each([
    ["phone", [["Phone number", "+1 555 010 1234"]]],
    [
      "sms",
      [
        ["Phone number", "+1 555 010 1234"],
        ["Message", "Hello"],
      ],
    ],
    [
      "contact",
      [
        ["First name", "Ada"],
        ["Last name", "Lovelace"],
        ["Email address", "ada@example.com"],
        ["Address", "10 Example Road"],
      ],
    ],
  ] as const)("saves the %s form", (type, fields) => {
    const onSave = vi.fn();
    render(<CodeEditorDialog kind="qr" onClose={vi.fn()} onSave={onSave} />);
    change("QR code type", type);
    for (const [label, value] of fields) change(label, value);
    fireEvent.click(screen.getByRole("button", { name: "Add QR code" }));
    expect(onSave.mock.lastCall?.[0].qr.data.type).toBe(type);
  });

  it("validates barcode content for its format, saves display options, and restores them", () => {
    const onSave = vi.fn();
    const view = render(
      <CodeEditorDialog kind="barcode" onClose={vi.fn()} onSave={onSave} />,
    );
    change("Barcode type", "ean13");
    change("Content", "abc");
    expect(screen.getByRole("button", { name: "Add barcode" })).toBeDisabled();
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
    change("Content", "590123412345");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show text below the bars" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add barcode" }));
    expect(onSave).toHaveBeenCalledWith({
      kind: "barcode",
      value: "590123412345",
      format: "ean13",
      barcode: { showText: false },
      includeMargin: false,
    });
    view.unmount();
    render(
      <CodeEditorDialog
        kind="barcode"
        initialCode={codeElement(
          onSave.mock.lastCall?.[0] as CodeConfiguration,
        )}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText("Barcode type")).toHaveValue("ean13");
    expect(screen.getByLabelText("Content")).toHaveValue("590123412345");
    expect(
      screen.getByRole("checkbox", { name: "Show text below the bars" }),
    ).not.toBeChecked();
    change("Barcode type", "datamatrix");
    expect(
      screen.queryByRole("checkbox", { name: "Show text below the bars" }),
    ).toBeNull();
  });

  it("closes with Escape and outside input, traps focus, and never saves on close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn();
    const view = render(
      <CodeEditorDialog kind="qr" onClose={onClose} onSave={onSave} />,
    );
    change("Text", "test");
    screen.getByRole("button", { name: "Add QR code" }).focus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Close QR code editor" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.pointerDown(view.container.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});
