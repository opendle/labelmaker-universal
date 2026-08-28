import type { ImageElement } from "@labelmaker/domain";
import { useEffect, useRef, type CSSProperties } from "react";

import { renderMonochromeImageFrame } from "./image-raster.js";

export function MonochromeImage({
  element,
  className,
  style,
  label,
}: {
  readonly element: ImageElement;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (globalThis.navigator?.userAgent.includes("jsdom")) return;
    let active = true;
    const target = canvasRef.current;
    if (!target) return;
    const aspect = Math.max(0.05, element.widthMm / element.heightMm);
    const desiredWidth = Math.max(
      64,
      Math.round(target.clientWidth * 2) || 256,
    );
    const desiredHeight = desiredWidth / aspect;
    const rasterScale = Math.min(1, 512 / desiredWidth, 512 / desiredHeight);
    const width = Math.max(1, Math.round(desiredWidth * rasterScale));
    const height = Math.max(1, Math.round(desiredHeight * rasterScale));
    void renderMonochromeImageFrame(element, width, height)
      .then((rendered) => {
        if (!active || !canvasRef.current) return;
        const canvas = canvasRef.current;
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        canvas.getContext("2d")?.drawImage(rendered, 0, 0);
      })
      .catch(() => {
        if (!active || !canvasRef.current) return;
        const context = canvasRef.current.getContext("2d");
        if (!context) return;
        context.fillStyle = "white";
        context.fillRect(
          0,
          0,
          canvasRef.current.width,
          canvasRef.current.height,
        );
      });
    return () => {
      active = false;
    };
  }, [element]);

  return (
    <canvas
      aria-label={label}
      className={className}
      ref={canvasRef}
      role={label ? "img" : "presentation"}
      style={style}
    />
  );
}
