import {
  drawingResultFromImageSource,
  type DrawingImageResult,
} from "./drawing-image.js";
import {
  loadIconCatalog,
  type IconCatalogEntry,
  type IconNode,
} from "./icon-catalog.js";

const ICON_RASTER_SIZE = 512;
const ICON_FRAME_REFERENCE_SIZE = 96;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function iconNodeMarkup(node: IconNode): string {
  return node
    .map(([elementName, attributes]) => {
      const serializedAttributes: string[] = [];
      for (const [name, value] of Object.entries(attributes)) {
        if (name === "key") continue;
        const attributeName = name.replace(
          /[A-Z]/g,
          (letter) => `-${letter.toLocaleLowerCase()}`,
        );
        serializedAttributes.push(`${attributeName}="${escapeXml(value)}"`);
      }
      const serialized = serializedAttributes.join(" ");
      return `<${elementName}${serialized ? ` ${serialized}` : ""}/>`;
    })
    .join("");
}

export function iconSource(icon: IconCatalogEntry): string {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_RASTER_SIZE}" height="${ICON_RASTER_SIZE}" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconNodeMarkup(icon.node)}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

export async function drawingResultFromIcon(
  name: string,
): Promise<DrawingImageResult | null> {
  const icons = await loadIconCatalog();
  const icon = icons.find((candidate) => candidate.name === name);
  if (!icon) throw new Error("The selected icon is not available.");
  const result = await drawingResultFromImageSource(iconSource(icon));
  if (!result) return null;
  const frameScale = ICON_FRAME_REFERENCE_SIZE / ICON_RASTER_SIZE;
  return {
    ...result,
    widthPixels: result.widthPixels * frameScale,
    heightPixels: result.heightPixels * frameScale,
  };
}
