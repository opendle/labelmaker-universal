import type { ShapeElement } from "@labelmaker/domain";
import {
  shapeLineStrokeWidthMm,
  shapeRenderGeometry,
} from "@labelmaker/rendering";
import type { CSSProperties } from "react";

export function ShapeArtwork({
  element,
  className,
  style,
}: {
  readonly element: ShapeElement;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  const shapeType = element.shapeType ?? "rectangle";
  const geometry = shapeRenderGeometry(element);
  const fill = geometry.filled ? "currentColor" : "none";
  const stroke = geometry.filled ? "none" : "currentColor";
  return (
    <svg
      aria-hidden="true"
      className={className}
      preserveAspectRatio="none"
      style={style}
      viewBox={`0 0 ${element.widthMm} ${element.heightMm}`}
    >
      {shapeType === "line" ? (
        <line
          stroke="currentColor"
          strokeLinecap="butt"
          strokeWidth={shapeLineStrokeWidthMm(element)}
          x1={0}
          x2={element.widthMm}
          y1={element.heightMm / 2}
          y2={element.heightMm / 2}
        />
      ) : shapeType === "circle" ? (
        <ellipse
          cx={element.widthMm / 2}
          cy={element.heightMm / 2}
          fill={fill}
          rx={geometry.widthMm / 2}
          ry={geometry.heightMm / 2}
          stroke={stroke}
          strokeWidth={geometry.strokeWidthMm}
        />
      ) : (
        <rect
          fill={fill}
          height={geometry.heightMm}
          rx={geometry.cornerRadiusMm}
          stroke={stroke}
          strokeWidth={geometry.strokeWidthMm}
          width={geometry.widthMm}
          x={geometry.insetMm}
          y={geometry.insetMm}
        />
      )}
    </svg>
  );
}
