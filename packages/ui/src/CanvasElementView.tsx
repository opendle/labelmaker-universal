import type { LabelElement, LabelPlate, TextElement } from "@labelmaker/domain";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { SelectionHandles } from "./controls.js";
import { pointsToMillimeters } from "./label-layout.js";

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type ElementStyle = CSSProperties & Record<`--${string}`, string | number>;

export function CanvasElementView({
  element,
  plate,
  canvasScale,
  selected,
  editing,
  onActivate,
  onDoubleClick,
  onEndEdit,
  onTextInput,
  onFocus,
  onMoveKey,
  onMoveStart,
  onResizeStart,
  onRotateStart,
}: {
  readonly element: LabelElement;
  readonly plate: LabelPlate;
  readonly canvasScale: number;
  readonly selected: boolean;
  readonly editing: boolean;
  readonly onActivate: (element: LabelElement) => void;
  readonly onDoubleClick: (element: LabelElement) => void;
  readonly onEndEdit: () => void;
  readonly onTextInput: (element: TextElement, text: string) => void;
  readonly onFocus: (element: LabelElement) => void;
  readonly onMoveKey: (
    event: KeyboardEvent<HTMLButtonElement>,
    element: LabelElement,
  ) => void;
  readonly onMoveStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: LabelElement,
  ) => void;
  readonly onResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: TextElement,
    corner: ResizeCorner,
  ) => void;
  readonly onRotateStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: TextElement,
  ) => void;
}) {
  const frameStyle: ElementStyle = {
    "--element-left": `${(element.xMm / plate.size.widthMm) * 100}%`,
    "--element-top": `${(element.yMm / plate.size.heightMm) * 100}%`,
    "--element-width": `${(element.widthMm / plate.size.widthMm) * 100}%`,
    "--element-height": `${(element.heightMm / plate.size.heightMm) * 100}%`,
    "--element-rotation": `rotate(${element.rotationDeg}deg)`,
  };
  if (element.kind === "rectangle") {
    return (
      <div
        aria-hidden="true"
        className={`canvas-shape ${element.filled ? "filled" : "outlined"}`}
        style={
          {
            ...frameStyle,
            "--shape-border-width": `${element.strokeWidthMm}px`,
            "--shape-radius": `${element.cornerRadiusMm}px`,
          } as ElementStyle
        }
      />
    );
  }
  const label =
    element.kind === "image"
      ? "Image element"
      : `Text element: ${element.kind === "text" ? element.text : "code"}`;
  const textStyle: ElementStyle =
    element.kind === "text"
      ? {
          "--element-font-family": element.fontFamily,
          "--element-font-size": `${pointsToMillimeters(element.fontSizePt) * canvasScale}px`,
          "--element-line-height": `${pointsToMillimeters(element.lineHeightPt ?? element.fontSizePt) * canvasScale}px`,
          "--element-font-style": element.fontStyle ?? "normal",
          "--element-font-weight": element.fontWeight,
          "--element-align-items":
            (element.verticalAlign ?? "middle") === "top"
              ? "flex-start"
              : element.verticalAlign === "bottom"
                ? "flex-end"
                : "center",
          "--element-justify":
            element.align === "left"
              ? "flex-start"
              : element.align === "right"
                ? "flex-end"
                : "center",
          textAlign: element.align,
        }
      : {};
  const editorLineCount =
    element.kind === "text" ? element.text.split(/\r\n?|\n/).length : 1;
  return (
    <div
      className={`canvas-element ${element.kind === "image" ? "canvas-image" : "canvas-text"} ${selected ? "selected" : ""} ${editing ? "editing" : ""}`}
      style={{ ...frameStyle, ...textStyle }}
    >
      {editing && element.kind === "text" ? (
        <span className="canvas-element-control canvas-text-control">
          <textarea
            aria-label="Edit text on label"
            className="inline-text-editor"
            data-element-id={element.id}
            onBlur={onEndEdit}
            onChange={(event) =>
              onTextInput(element, event.currentTarget.value)
            }
            style={
              {
                "--editor-line-count": editorLineCount,
                fontFamily: element.fontFamily,
                fontSize: `${pointsToMillimeters(element.fontSizePt) * canvasScale}px`,
                fontStyle: element.fontStyle ?? "normal",
                fontWeight: element.fontWeight,
                lineHeight: `${pointsToMillimeters(element.lineHeightPt ?? element.fontSizePt) * canvasScale}px`,
                textAlign: element.align,
              } as ElementStyle
            }
            value={element.text}
          />
        </span>
      ) : (
        <button
          aria-label={label}
          className="canvas-element-control"
          onClick={() => onActivate(element)}
          onDoubleClick={() => onDoubleClick(element)}
          onFocus={() => onFocus(element)}
          onKeyDown={(event) => onMoveKey(event, element)}
          onPointerDown={(event) => onMoveStart(event, element)}
          type="button"
        >
          {element.kind === "image" ? (
            <img
              alt=""
              className={`fit-${element.fit}`}
              draggable={false}
              src={element.source}
            />
          ) : element.kind === "text" ? (
            <span className="inline-text-editor">{element.text}</span>
          ) : null}
        </button>
      )}
      {selected && element.kind === "text" && !editing && (
        <SelectionHandles
          onResizeStart={(corner, event) =>
            onResizeStart(event, element, corner)
          }
          onRotateStart={(event) => onRotateStart(event, element)}
        />
      )}
    </div>
  );
}
