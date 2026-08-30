import type { ImageElement } from "@labelmaker/domain";
import { Eraser, Pencil, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  drawingResultFromCanvas,
  type DrawingImageResult,
} from "./drawing-image.js";
import { IconButton } from "./controls.js";
import { Modal } from "./Modal.js";

type DrawingTool = "pen" | "eraser";
interface DrawingState {
  readonly tool: DrawingTool;
  readonly ready: boolean;
  readonly message: string;
}

type DrawingAction =
  | { readonly type: "set-tool"; readonly tool: DrawingTool }
  | { readonly type: "ready" }
  | { readonly type: "message"; readonly message: string }
  | { readonly type: "unavailable"; readonly message: string }
  | { readonly type: "clear-message" };

function drawingReducer(
  state: DrawingState,
  action: DrawingAction,
): DrawingState {
  if (action.type === "set-tool") return { ...state, tool: action.tool };
  if (action.type === "ready") return { ...state, ready: true, message: "" };
  if (action.type === "unavailable") {
    return { ...state, ready: false, message: action.message };
  }
  if (action.type === "message") return { ...state, message: action.message };
  return { ...state, message: "" };
}

const DRAWING_RESOLUTION_SCALE = 4;
const DRAWING_REFERENCE_WIDTH = 240;
const NEW_DRAWING_WIDTH = DRAWING_REFERENCE_WIDTH * DRAWING_RESOLUTION_SCALE;
const NEW_DRAWING_HEIGHT = 120 * DRAWING_RESOLUTION_SCALE;
const PEN_WIDTH = 3;
const ERASER_WIDTH = 10;

interface DrawingPointerSample {
  readonly clientX: number;
  readonly clientY: number;
}

function canvasPoint(canvas: HTMLCanvasElement, event: DrawingPointerSample) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x:
      ((event.clientX - bounds.left) / Math.max(1, bounds.width)) *
      canvas.width,
    y:
      ((event.clientY - bounds.top) / Math.max(1, bounds.height)) *
      canvas.height,
  };
}

function fillCanvasWhite(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The drawing canvas is not available.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

export function DrawingEditorDialog({
  image,
  onClose,
  onSave,
}: {
  readonly image?: ImageElement | undefined;
  readonly onClose: () => void;
  readonly onSave: (result: DrawingImageResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const previousPointRef = useRef<{ x: number; y: number } | null>(null);
  const [state, dispatch] = useReducer(drawingReducer, {
    tool: "pen",
    ready: !image,
    message: "",
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!image) {
      canvas.width = NEW_DRAWING_WIDTH;
      canvas.height = NEW_DRAWING_HEIGHT;
      try {
        fillCanvasWhite(canvas);
      } catch (error) {
        dispatch({
          type: "unavailable",
          message:
            error instanceof Error
              ? error.message
              : "The canvas could not open.",
        });
      }
      return;
    }
    let active = true;
    const source = new Image();
    source.onload = () => {
      if (!active || !canvasRef.current) return;
      const target = canvasRef.current;
      target.width = Math.max(1, source.naturalWidth);
      target.height = Math.max(1, source.naturalHeight);
      const context = target.getContext("2d");
      if (!context) {
        dispatch({
          type: "unavailable",
          message: "The drawing canvas is not available.",
        });
        return;
      }
      context.fillStyle = "white";
      context.fillRect(0, 0, target.width, target.height);
      context.drawImage(source, 0, 0);
      dispatch({ type: "ready" });
    };
    source.onerror = () => {
      if (active) {
        dispatch({
          type: "unavailable",
          message: "The image could not open.",
        });
      }
    };
    source.src = image.source;
    return () => {
      active = false;
    };
  }, [image]);

  const drawTo = useCallback(
    (event: DrawingPointerSample, startNewStroke: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const point = canvasPoint(canvas, event);
      const previous = startNewStroke
        ? point
        : (previousPointRef.current ?? point);
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.strokeStyle = state.tool === "pen" ? "black" : "white";
      context.lineWidth =
        (state.tool === "pen" ? PEN_WIDTH : ERASER_WIDTH) *
        (canvas.width / DRAWING_REFERENCE_WIDTH);
      context.lineCap = "round";
      context.lineJoin = "round";
      if (startNewStroke) {
        context.fillStyle = context.strokeStyle;
        context.arc(point.x, point.y, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.stroke();
      }
      previousPointRef.current = point;
      dispatch({ type: "clear-message" });
    },
    [state.tool],
  );

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!state.ready || activePointerIdRef.current !== null) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // WebKit can reject pointer capture for an Apple Pencil contact. The
      // pointer events still contain valid drawing coordinates.
    }
    activePointerIdRef.current = event.pointerId;
    drawingRef.current = true;
    drawTo(event.nativeEvent, true);
  };
  const continueDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || activePointerIdRef.current !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nativeEvent = event.nativeEvent;
    const coalescedSamples =
      typeof nativeEvent.getCoalescedEvents === "function"
        ? nativeEvent.getCoalescedEvents()
        : [];
    const samples =
      coalescedSamples.length > 0 ? coalescedSamples : [nativeEvent];
    for (const sample of samples) drawTo(sample, false);
  };
  const stopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    drawingRef.current = false;
    activePointerIdRef.current = null;
    previousPointRef.current = null;
  };

  const save = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state.ready) return;
    try {
      const result = drawingResultFromCanvas(canvas);
      if (!result) {
        dispatch({
          type: "message",
          message: "Draw something before you save.",
        });
        return;
      }
      onSave(result);
    } catch (error) {
      dispatch({
        type: "message",
        message:
          error instanceof Error
            ? error.message
            : "The drawing could not save.",
      });
    }
  }, [onSave, state.ready]);

  useEffect(() => {
    const saveWithEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat) return;
      event.preventDefault();
      save();
    };
    globalThis.document.addEventListener("keydown", saveWithEnter);
    return () =>
      globalThis.document.removeEventListener("keydown", saveWithEnter);
  }, [save]);

  return (
    <Modal
      className="drawing-modal"
      labelId="drawing-editor-title"
      onClose={onClose}
    >
      <form
        className="drawing-editor-content"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="dialog-header drawing-header">
          <div>
            <h2 id="drawing-editor-title">
              {image ? "Edit image" : "Draw image"}
            </h2>
          </div>
          <IconButton
            initialFocus
            label="Close drawing editor"
            onClick={onClose}
          >
            <X size={18} />
          </IconButton>
        </div>
        <div
          className="drawing-tools"
          role="toolbar"
          aria-label="Drawing tools"
        >
          <button
            aria-pressed={state.tool === "pen"}
            className={`tool-button${state.tool === "pen" ? " active" : ""}`}
            disabled={!state.ready}
            onClick={() => dispatch({ type: "set-tool", tool: "pen" })}
            type="button"
          >
            <Pencil size={16} /> Pen
          </button>
          <button
            aria-pressed={state.tool === "eraser"}
            className={`tool-button${state.tool === "eraser" ? " active" : ""}`}
            disabled={!state.ready}
            onClick={() => dispatch({ type: "set-tool", tool: "eraser" })}
            type="button"
          >
            <Eraser size={16} /> Eraser
          </button>
          <button
            className="tool-button drawing-clear"
            disabled={!state.ready}
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              fillCanvasWhite(canvas);
              dispatch({ type: "clear-message" });
            }}
            type="button"
          >
            <Trash2 size={16} /> Clear
          </button>
        </div>
        <div className="drawing-surface">
          <canvas
            aria-label="Drawing canvas"
            className="drawing-canvas"
            onPointerCancel={stopDrawing}
            onPointerDown={startDrawing}
            onLostPointerCapture={stopDrawing}
            onPointerMove={continueDrawing}
            onPointerUp={stopDrawing}
            ref={canvasRef}
            tabIndex={0}
          />
        </div>
        {state.message && (
          <p aria-live="polite" className="drawing-message">
            {state.message}
          </p>
        )}
        <div className="dialog-footer end">
          <button
            className="button primary"
            disabled={!state.ready}
            type="submit"
          >
            {image ? "Save image" : "Add drawing"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
