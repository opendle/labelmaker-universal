import type { LabelPlate } from "@labelmaker/domain";
import type { CSSProperties } from "react";

import {
  containerFontSize,
  printableVerticalCrop,
  type PrintableMargins,
} from "./label-layout.js";
import { CodeArtwork } from "./CodeArtwork.js";
import { MonochromeImage } from "./MonochromeImage.js";
import { ShapeArtwork } from "./ShapeArtwork.js";
import { textWithTrailingLineMarker } from "./text-layout.js";

type ArtworkStyle = CSSProperties & Record<`--${string}`, string | number>;

export function LabelArtwork({
  plate,
  printableMargins,
  className,
  mirrorArtwork = false,
  minimumLabelWidthMm = 0,
}: {
  readonly plate: LabelPlate;
  readonly printableMargins: PrintableMargins;
  readonly className: string;
  readonly mirrorArtwork?: boolean;
  readonly minimumLabelWidthMm?: number;
}) {
  const crop = printableVerticalCrop(plate.size.heightMm, printableMargins);
  const displayHeightMm = crop.heightMm || plate.size.heightMm;
  const outputWidthMm = Math.max(plate.size.widthMm, minimumLabelWidthMm);
  const aspectRatio = outputWidthMm / displayHeightMm;
  const visibleElements = crop.heightMm > 0 ? plate.elements : [];
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
      <span
        className="label-artwork-content"
        style={{ width: `${(plate.size.widthMm / outputWidthMm) * 100}%` }}
      >
        {visibleElements.map((element) => {
          const frame: ArtworkStyle = {
            left: `${(element.xMm / plate.size.widthMm) * 100}%`,
            top: `${((element.yMm - crop.topMm) / crop.heightMm) * 100}%`,
            width: `${(element.widthMm / plate.size.widthMm) * 100}%`,
            height: `${(element.heightMm / crop.heightMm) * 100}%`,
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
                <span className="label-artwork-text-content">
                  {textWithTrailingLineMarker(element.text)}
                </span>
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
          return (
            <CodeArtwork
              element={element}
              className="label-artwork-element"
              key={element.id}
              style={frame}
            />
          );
        })}
      </span>
    </span>
  );
}
