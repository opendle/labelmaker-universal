import type { LabelElement, LabelPlate } from "@labelmaker/domain";
import { isFlagGuideElement, isFlagPlate } from "./editor-operations.js";

export function selectionKey(plate: LabelPlate, id: string): string {
  return isFlagPlate(plate) ? id.replace(/--flag-peer$/, "") : id;
}

export function uniqueSelection(
  plate: LabelPlate,
  ids: readonly string[],
): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const element = plate.elements.find((item) => item.id === id);
    const key = selectionKey(plate, id);
    if (!element || isFlagGuideElement(plate, element) || seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

export function elementBounds(element: LabelElement) {
  const angle = (element.rotationDeg * Math.PI) / 180;
  const widthMm =
    Math.abs(element.widthMm * Math.cos(angle)) +
    Math.abs(element.heightMm * Math.sin(angle));
  const heightMm =
    Math.abs(element.widthMm * Math.sin(angle)) +
    Math.abs(element.heightMm * Math.cos(angle));
  return {
    xMm: element.xMm + (element.widthMm - widthMm) / 2,
    yMm: element.yMm + (element.heightMm - heightMm) / 2,
    widthMm,
    heightMm,
  };
}

export function patchSelectedElements(
  plate: LabelPlate,
  ids: readonly string[],
  updated: LabelElement,
  fields: readonly string[],
): LabelElement[] {
  return plate.elements.flatMap((element) => {
    if (!ids.includes(element.id) || element.kind !== updated.kind) return [];
    const next = { ...element };
    for (const key of fields) {
      if (key === "id" || key === "kind") continue;
      const value = (updated as unknown as Record<string, unknown>)[key];
      if (value === undefined)
        delete (next as unknown as Record<string, unknown>)[key];
      else (next as unknown as Record<string, unknown>)[key] = value;
    }
    return [next];
  });
}
