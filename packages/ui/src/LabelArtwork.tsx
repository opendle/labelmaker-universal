import type { LabelPlate } from "@labelmaker/domain";
import type { CSSProperties } from "react";

import { containerFontSize, printableMarginPercent } from "./label-layout.js";

type ArtworkStyle = CSSProperties & Record<`--${string}`, string | number>;

export function LabelArtwork({
  plate,
  verticalMarginMm,
  className,
}: {
  readonly plate: LabelPlate;
  readonly verticalMarginMm: number;
  readonly className: string;
}) {
  const marginPercent = printableMarginPercent(
    verticalMarginMm,
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
              }}
            >
              {element.text}
            </span>
          );
        }
        if (element.kind === "image") {
          return (
            <img
              alt=""
              className={`label-artwork-element label-artwork-image fit-${element.fit}`}
              key={element.id}
              src={element.source}
              style={frame}
            />
          );
        }
        if (element.kind === "rectangle") {
          return (
            <span
              aria-hidden="true"
              className={`label-artwork-element label-artwork-shape ${element.filled ? "filled" : "outlined"}`}
              key={element.id}
              style={
                {
                  ...frame,
                  "--artwork-shape-border": element.filled
                    ? "0"
                    : `${element.strokeWidthMm}px solid #222`,
                } as ArtworkStyle
              }
            />
          );
        }
        return null;
      })}
      <span
        aria-hidden="true"
        className="artwork-nonprintable top"
        style={{ height: `${marginPercent}%` }}
      />
      <span
        aria-hidden="true"
        className="artwork-nonprintable bottom"
        style={{ height: `${marginPercent}%` }}
      />
    </span>
  );
}
