import { icons, type LucideIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  drawingResultFromImageSource,
  type DrawingImageResult,
} from "./drawing-image.js";

export type IconName = keyof typeof icons;

const ICON_RASTER_SIZE = 96;

export function iconSource(name: IconName): string {
  const Icon = icons[name] as LucideIcon;
  const markup = renderToStaticMarkup(
    <Icon
      color="#000000"
      height={ICON_RASTER_SIZE}
      strokeWidth={2}
      width={ICON_RASTER_SIZE}
    />,
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

export function drawingResultFromIcon(
  name: IconName,
): Promise<DrawingImageResult | null> {
  return drawingResultFromImageSource(iconSource(name));
}
