import type { ShapeElement } from "@labelmaker/domain";
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
  const stroke = Math.max(0, element.strokeWidthMm);
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
          strokeWidth={stroke}
          x1={0}
          x2={element.widthMm}
          y1={element.heightMm / 2}
          y2={element.heightMm / 2}
        />
      ) : shapeType === "circle" ? (
        <ellipse
          cx={element.widthMm / 2}
          cy={element.heightMm / 2}
          fill={element.filled ? "currentColor" : "none"}
          rx={element.widthMm / 2}
          ry={element.heightMm / 2}
          stroke="currentColor"
          strokeWidth={stroke}
        />
      ) : (
        <rect
          fill={element.filled ? "currentColor" : "none"}
          height={element.heightMm}
          rx={Math.min(
            element.cornerRadiusMm,
            element.widthMm / 2,
            element.heightMm / 2,
          )}
          stroke="currentColor"
          strokeWidth={stroke}
          width={element.widthMm}
          x={0}
          y={0}
        />
      )}
    </svg>
  );
}
