import type {
  ImageElement,
  LabelElement,
  LabelPlate,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { SelectionHandles } from "./controls.js";
import { pointsToMillimeters } from "./label-layout.js";
import { MonochromeImage } from "./MonochromeImage.js";
import { isFlagGuideElement } from "./editor-operations.js";
import { ShapeArtwork } from "./ShapeArtwork.js";

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type FramedElement = TextElement | ImageElement | ShapeElement;
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
    element: FramedElement,
    corner: ResizeCorner,
  ) => void;
  readonly onRotateStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: FramedElement,
  ) => void;
}) {
  const inlineEditorRef = useRef<HTMLTextAreaElement>(null);
  const inlineMeasureRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const editor = inlineEditorRef.current;
    if (!editing || element.kind !== "text" || !editor) return;
    editor.select();
  }, [editing, element.id, element.kind]);
  useLayoutEffect(() => {
    const editor = inlineEditorRef.current;
    const measure = inlineMeasureRef.current;
    if (!editing || element.kind !== "text" || !editor || !measure) return;
    const measuredHeight = Number.parseFloat(
      globalThis.getComputedStyle(measure).height,
    );
    if (!(measuredHeight > 0)) {
      editor.style.height = `${editor.scrollHeight}px`;
      editor.style.transform = "";
      return;
    }
    editor.style.height = `${measuredHeight}px`;
    const editorHeight = Math.max(measuredHeight, editor.scrollHeight);
    const overflowHeight = editorHeight - measuredHeight;
    const verticalOffset =
      (element.verticalAlign ?? "middle") === "top"
        ? 0
        : element.verticalAlign === "bottom"
          ? overflowHeight
          : overflowHeight / 2;
    editor.style.height = `${editorHeight}px`;
    editor.style.transform =
      verticalOffset > 0 ? `translateY(${verticalOffset}px)` : "";
    editor.scrollTop = 0;
  }, [canvasScale, editing, element]);
  const frameStyle: ElementStyle = {
    "--element-left": `${(element.xMm / plate.size.widthMm) * 100}%`,
    "--element-top": `${(element.yMm / plate.size.heightMm) * 100}%`,
    "--element-width": `${(element.widthMm / plate.size.widthMm) * 100}%`,
    "--element-height": `${(element.heightMm / plate.size.heightMm) * 100}%`,
    "--element-rotation": `rotate(${element.rotationDeg}deg)`,
  };
  if (isFlagGuideElement(plate, element) && element.kind === "rectangle") {
    return (
      <ShapeArtwork
        className="canvas-shape canvas-flag-guide"
        element={element}
        style={frameStyle}
      />
    );
  }
  const label =
    element.kind === "image"
      ? "Image element"
      : element.kind === "rectangle"
        ? `${element.shapeType ?? "rectangle"} shape element`
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
  const measurementText =
    element.kind === "text" && /(?:\r\n?|\n)$/.test(element.text)
      ? `${element.text}\u200b`
      : element.kind === "text"
        ? element.text
        : "";
  return (
    <div
      className={`canvas-element ${element.kind === "image" ? "canvas-image" : element.kind === "rectangle" ? "canvas-shape-element" : "canvas-text"} ${selected ? "selected" : ""} ${editing ? "editing" : ""}`}
      style={{ ...frameStyle, ...textStyle }}
    >
      {editing && element.kind === "text" ? (
        <span className="canvas-element-control canvas-text-control">
          <span
            aria-hidden="true"
            className="inline-text-editor inline-text-measure"
            ref={inlineMeasureRef}
          >
            {measurementText}
          </span>
          <textarea
            aria-label="Edit text on label"
            className="inline-text-editor"
            data-element-id={element.id}
            ref={inlineEditorRef}
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
          style={
            element.kind === "text" ? { textAlign: element.align } : undefined
          }
          type="button"
        >
          {element.kind === "image" ? (
            <MonochromeImage element={element} />
          ) : element.kind === "text" ? (
            <span className="inline-text-editor">{element.text}</span>
          ) : element.kind === "rectangle" ? (
            <ShapeArtwork className="shape-artwork" element={element} />
          ) : null}
        </button>
      )}
      {selected &&
        (element.kind === "text" ||
          element.kind === "image" ||
          element.kind === "rectangle") &&
        !editing && (
          <SelectionHandles
            elementLabel={element.kind === "rectangle" ? "shape" : element.kind}
            rotationDeg={element.rotationDeg}
            onResizeStart={(corner, event) =>
              onResizeStart(event, element, corner)
            }
            onRotateStart={(event) => onRotateStart(event, element)}
          />
        )}
    </div>
  );
}
