import { validateLabelDocument } from "@labelmaker/documents";
import type { LabelDocument } from "@labelmaker/domain";

export interface ValidatedPrintRequest {
  readonly document: LabelDocument;
  readonly printerId: string;
  readonly plateIds: readonly string[];
}

function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Print request must be an object");
  }
  return value as Record<string, unknown>;
}

export function validatePrintRequest(value: unknown): ValidatedPrintRequest {
  const request = plainObject(value);
  if (typeof request.printerId !== "string" || !request.printerId.trim()) {
    throw new TypeError("Print request printerId must be a non-empty string");
  }
  const document = validateLabelDocument(request.document);
  if (!Array.isArray(request.plateIds) || request.plateIds.length === 0) {
    throw new TypeError("Print request plateIds must be a non-empty array");
  }
  if (request.plateIds.length > document.plates.length) {
    throw new TypeError("Print request contains too many plate IDs");
  }

  const documentPlateIds = new Set(document.plates.map((plate) => plate.id));
  const plateIds = request.plateIds.map((plateId, index) => {
    if (typeof plateId !== "string" || !plateId.trim()) {
      throw new TypeError(
        `Print request plateIds[${index}] must be a non-empty string`,
      );
    }
    if (!documentPlateIds.has(plateId)) {
      throw new TypeError(`Print request references unknown plate ${plateId}`);
    }
    return plateId;
  });
  if (new Set(plateIds).size !== plateIds.length) {
    throw new TypeError("Print request contains duplicate plate IDs");
  }

  return { document, printerId: request.printerId, plateIds };
}
