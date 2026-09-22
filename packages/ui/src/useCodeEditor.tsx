import type {
  CodeElement,
  LabelDocument,
  LabelPlate,
} from "@labelmaker/domain";
import { generateCodeArtwork } from "@labelmaker/rendering";
import { useState } from "react";
import { replacePlate } from "./app-state.js";
import {
  CodeEditorDialog,
  type CodeConfiguration,
} from "./CodeEditorDialog.js";
import {
  appendElementAndFlagPeer,
  isFlagPlate,
  toggleFlagPlate,
  updateElementAndFlagPeer,
} from "./editor-operations.js";
import type { PrintableMargins } from "./label-layout.js";
import { newElementFrame } from "./new-element-frame.js";

export function useCodeEditor({
  activePlate,
  workspace,
  printableMargins,
  editWorkspace,
  selectElement,
  selectedElementIds = [],
}: {
  readonly selectedElementIds?: readonly string[];
  readonly activePlate: LabelPlate | undefined;
  readonly workspace: LabelDocument;
  readonly printableMargins: PrintableMargins;
  readonly editWorkspace: (workspace: LabelDocument, plateId: string) => void;
  readonly selectElement: (id: string) => void;
}) {
  const [target, setTarget] = useState<{
    kind: "qr" | "barcode";
    code?: CodeElement;
    ids?: readonly string[];
  } | null>(null);
  const close = () => setTarget(null);
  const save = (configuration: CodeConfiguration) => {
    if (!activePlate || !target) return;
    let element: CodeElement;
    if (target.code) {
      element = { ...target.code, ...configuration };
    } else {
      const artwork = generateCodeArtwork(configuration);
      const sourcePlate = isFlagPlate(activePlate)
        ? toggleFlagPlate(activePlate)
        : activePlate;
      const frame = newElementFrame(sourcePlate, 1, printableMargins);
      element = {
        ...configuration,
        id: `code-${globalThis.crypto.randomUUID()}`,
        ...newElementFrame(
          sourcePlate,
          (frame.heightMm * artwork.width) / artwork.height,
          printableMargins,
        ),
        rotationDeg: 0,
      };
    }
    editWorkspace(
      replacePlate(workspace, activePlate.id, (plate) =>
        target.code
          ? (target.ids ?? [element.id]).reduce((next, id) => {
              const original = plate.elements.find((item) => item.id === id);
              return original
                ? updateElementAndFlagPeer(next, {
                    ...original,
                    ...configuration,
                  } as CodeElement)
                : next;
            }, plate)
          : appendElementAndFlagPeer(plate, element),
      ),
      activePlate.id,
    );
    if (!target.ids || target.ids.length < 2) selectElement(element.id);
    close();
  };
  return {
    isOpen: target !== null,
    close,
    openNew: (kind: "qr" | "barcode") => setTarget({ kind }),
    openCode: (code: CodeElement) =>
      setTarget({
        kind: code.kind,
        code,
        ids:
          selectedElementIds.includes(code.id) &&
          activePlate?.elements
            .filter((item) => selectedElementIds.includes(item.id))
            .every((item) => item.kind === code.kind)
            ? selectedElementIds
            : [code.id],
      }),
    dialog: target && (
      <CodeEditorDialog
        kind={target.kind}
        initialCode={target.code}
        onClose={close}
        onSave={save}
      />
    ),
  };
}
