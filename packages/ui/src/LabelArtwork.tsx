import type { LabelPlate } from "@labelmaker/domain";
import type { CSSProperties } from "react";

import {
  containerFontSize,
  printableMarginPercent,
  type PrintableMargins,
} from "./label-layout.js";
import { MonochromeImage } from "./MonochromeImage.js";
import { ShapeArtwork } from "./ShapeArtwork.js";

type ArtworkStyle = CSSProperties & Record<`--${string}`, string | number>;

export function LabelArtwork({
  plate,
  printableMargins,
  className,
  mirrorArtwork = false,
}: {
  readonly plate: LabelPlate;
  readonly printableMargins: PrintableMargins;
  readonly className: string;
  readonly mirrorArtwork?: boolean;
}) {
  const topMarginPercent = printableMarginPercent(
    printableMargins.topMm,
    plate.size.heightMm,
  );
  const bottomMarginPercent = printableMarginPercent(
    printableMargins.bottomMm,
    plate.size.heightMm,
  );
  const aspectRatio = plate.size.widthMm / plate.size.heightMm;
  return (
    <span
      className={`label-artwork ${className}`}
      style={
        {
          "--label-aspect": aspectRatio,
          aspectRatio: String(aspectRatio),
          ...(mirrorArtwork ? { transform: "scaleX(-1)" } : {}),
        } as ArtworkStyle
      }
    >
      {plate.elements.map((element) => {
        const frame: ArtworkStyle = {
          left: `${(element.xMm / plate.size.widthMm) * 100}%`,
          top: `${(element.yMm / plate.size.heightMm) * 100}%`,
          width: `${(element.widthMm / plate.size.widthMm) * 100}%`,
          height: `${(element.heightMm / plate.size.heightMm) * 100}%`,
          transform: `rotate(${element.rotationDeg}deg)`,
        };
        if (element.kind === "text") {
          return (
            <span
              className={`label-artwork-element label-artwork-text align-${element.align}`}
              key={element.id}
              style={{
                ...frame,
                fontFamily: element.fontFamily,
                fontSize: containerFontSize(
                  element.fontSizePt,
                  plate.size.widthMm,
                ),
                fontStyle: element.fontStyle ?? "normal",
                fontWeight: element.fontWeight,
                alignItems:
                  (element.verticalAlign ?? "middle") === "top"
                    ? "flex-start"
                    : element.verticalAlign === "bottom"
                      ? "flex-end"
                      : "center",
                lineHeight:
                  (element.lineHeightPt ?? element.fontSizePt) /
                  element.fontSizePt,
                textAlign: element.align,
              }}
            >
              <span className="label-artwork-text-content">{element.text}</span>
            </span>
          );
        }
        if (element.kind === "image") {
          return (
            <MonochromeImage
              className="label-artwork-element label-artwork-image"
              element={element}
              key={element.id}
              style={frame}
            />
          );
        }
        if (element.kind === "rectangle") {
          return (
            <ShapeArtwork
              className="label-artwork-element label-artwork-shape"
              element={element}
              key={element.id}
              style={frame}
            />
          );
        }
        return null;
      })}
      <span
        aria-hidden="true"
        className="artwork-nonprintable top"
        style={{ height: `${topMarginPercent}%` }}
      />
      <span
        aria-hidden="true"
        className="artwork-nonprintable bottom"
        style={{ height: `${bottomMarginPercent}%` }}
      />
    </span>
  );
}
