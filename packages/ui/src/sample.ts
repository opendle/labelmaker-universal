import type { LabelDocument } from "@labelmaker/domain";

import { DEFAULT_TYPEFACE } from "./typefaces.js";

export const sampleDocument: LabelDocument = {
  schemaVersion: 1,
  id: "workspace-workshop",
  name: "Labels",
  defaultPlateSize: { widthMm: 62, heightMm: 16 },
  plates: [
    {
      id: "plate-resistors",
      name: "Resistors",
      size: { widthMm: 62, heightMm: 16 },
      margins: { leftMm: 0, rightMm: 0 },
      elements: [
        {
          id: "element-resistors",
          kind: "text",
          xMm: 4,
          yMm: 3.2,
          widthMm: 54,
          heightMm: 9.6,
          rotationDeg: 0,
          text: "RESISTORS",
          fontFamily: DEFAULT_TYPEFACE,
          fontSizePt: 18,
          fontWeight: 700,
          align: "center",
        },
      ],
    },
    {
      id: "plate-capacitors",
      name: "Capacitors",
      size: { widthMm: 62, heightMm: 16 },
      margins: { leftMm: 0, rightMm: 0 },
      elements: [
        {
          id: "element-capacitors",
          kind: "text",
          xMm: 4,
          yMm: 3.2,
          widthMm: 54,
          heightMm: 9.6,
          rotationDeg: 0,
          text: "CAPACITORS",
          fontFamily: DEFAULT_TYPEFACE,
          fontSizePt: 18,
          fontWeight: 700,
          align: "center",
        },
      ],
    },
    {
      id: "plate-connectors",
      name: "Connectors",
      size: { widthMm: 62, heightMm: 16 },
      margins: { leftMm: 0, rightMm: 0 },
      elements: [
        {
          id: "element-connectors",
          kind: "text",
          xMm: 4,
          yMm: 3.2,
          widthMm: 54,
          heightMm: 9.6,
          rotationDeg: 0,
          text: "CONNECTORS",
          fontFamily: DEFAULT_TYPEFACE,
          fontSizePt: 18,
          fontWeight: 700,
          align: "center",
        },
      ],
    },
  ],
};
