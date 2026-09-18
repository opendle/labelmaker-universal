import type { CodeElement } from "@labelmaker/domain";
import { generateCodeArtwork } from "@labelmaker/rendering";
import { useMemo, type CSSProperties } from "react";

export function CodeArtwork({
  element,
  className = "",
  style,
}: {
  readonly element: CodeElement;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  const { kind, value, format, qr, barcode, includeMargin } = element;
  const artwork = useMemo(() => {
    try {
      return generateCodeArtwork({
        kind,
        value,
        ...(includeMargin === undefined ? {} : { includeMargin }),
        ...(format === undefined ? {} : { format }),
        ...(qr === undefined ? {} : { qr }),
        ...(barcode === undefined ? {} : { barcode }),
      });
    } catch {
      return null;
    }
  }, [kind, value, format, qr, barcode, includeMargin]);
  if (artwork) {
    return (
      <img
        alt=""
        draggable={false}
        className={className}
        src={artwork.dataUrl}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          ...style,
        }}
      />
    );
  } else {
    return (
      <span className={className} style={style} aria-label="Invalid code">
        Invalid code
      </span>
    );
  }
}
