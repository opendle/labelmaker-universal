import type { LabelDocument } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";

import {
  appendElementAndFlagPeer,
  createImage,
  createPlate,
  createShape,
  deleteElementAndFlagPeer,
  editableElementCount,
  moveElementLayer,
  plateEditorWidthMm,
  toggleFlagPlate,
  trimPlate,
  updateElementAndFlagPeer,
  updatePlateEditorHeight,
  updatePlateEditorWidth,
} from "./editor-operations.js";

const document: LabelDocument = {
  schemaVersion: 1,
  id: "workspace",
  name: "Trim test",
  defaultPlateSize: { widthMm: 100, heightMm: 16 },
  plates: [
    {
      id: "plate",
      name: "Wide frame",
      size: { widthMm: 100, heightMm: 16 },
      margins: { leftMm: 2, rightMm: 3 },
      elements: [
        {
          id: "text",
          kind: "text",
          xMm: 10,
          yMm: 2,
          widthMm: 80,
          heightMm: 12,
          rotationDeg: 0,
          text: "I\nWIDE",
          fontFamily: "Georgia",
          fontSizePt: 12,
          fontWeight: 400,
          fontStyle: "italic",
          align: "center",
        },
        {
          id: "image",
          kind: "image",
          xMm: 0,
          yMm: 0,
          widthMm: 100,
          heightMm: 16,
          rotationDeg: 0,
          source: "data:image/png;base64,AA==",
          fit: "contain",
          brightness: 128,
          contrast: 128,
        },
      ],
    },
  ],
};

describe("createPlate", () => {
  it("names a new label by its position", () => {
    expect(createPlate(document).name).toBe("Label 2");
  });
});

describe("createImage", () => {
  it("uses a transparent background for imported images and drawings", () => {
    const image = createImage(
      document.plates[0]!,
      "data:image/png;base64,image",
    );

    expect(image.transparentBackground).toBe(true);
  });
});

describe("trimPlate", () => {
  it("uses the first and last black raster pixels instead of element frames", async () => {
    const trimmed = await trimPlate(document, "plate", async () => ({
      minX: 43,
      maxX: 56,
    }));
    const plate = trimmed.plates[0]!;
    const text = plate.elements[0]!;

    expect(plate.size.widthMm).toBe(18);
    expect(text.xMm).toBe(-31);
  });

  it("does not use a white image frame as trim bounds", async () => {
    const withoutImage: LabelDocument = {
      ...document,
      plates: document.plates.map((plate) => ({
        ...plate,
        elements: plate.elements.filter((element) => element.kind === "text"),
      })),
    };

    const blackPixels = async () => ({ minX: 43, maxX: 56 });
    expect(
      (await trimPlate(document, "plate", blackPixels)).plates[0]!.size.widthMm,
    ).toBe(
      (await trimPlate(withoutImage, "plate", blackPixels)).plates[0]!.size
        .widthMm,
    );
  });

  it("adds no hidden padding when both trim margins are zero", async () => {
    const zeroMargins = {
      ...document,
      plates: document.plates.map((plate) => ({
        ...plate,
        margins: { leftMm: 0, rightMm: 0 },
      })),
    };
    const plate = (
      await trimPlate(zeroMargins, "plate", async () => ({
        minX: 43,
        maxX: 56,
      }))
    ).plates[0]!;
    expect(plate.size.widthMm).toBe(13);
  });

  it("rounds up to a whole millimeter and centers the rounding padding", async () => {
    const zeroMargins = {
      ...document,
      plates: document.plates.map((plate) => ({
        ...plate,
        margins: { leftMm: 0, rightMm: 0 },
        elements: plate.elements.filter((element) => element.kind === "text"),
      })),
    };

    const plate = (
      await trimPlate(zeroMargins, "plate", async () => ({
        minX: 45,
        maxX: 55.7,
      }))
    ).plates[0]!;
    const text = plate.elements[0]!;
    expect(plate.size.widthMm).toBe(11);
    expect(text.xMm).toBeCloseTo(-34.85);
  });

  it("enlarges the plate when black pixels extend outside its current width", async () => {
    const plate = (
      await trimPlate(document, "plate", async () => ({
        minX: -6,
        maxX: 108,
      }))
    ).plates[0]!;

    expect(plate.size.widthMm).toBe(119);
    expect(plate.elements[0]?.xMm).toBe(18);
  });
});

describe("shapes and layers", () => {
  it.each(["line", "rectangle", "circle"] as const)(
    "creates and centers a %s shape",
    (shapeType) => {
      const plate = document.plates[0]!;
      const shape = createShape(plate, shapeType);
      expect(shape).toMatchObject({ kind: "rectangle", shapeType });
      expect(shape.xMm + shape.widthMm / 2).toBe(plate.size.widthMm / 2);
      expect(shape.yMm + shape.heightMm / 2).toBe(plate.size.heightMm / 2);
      if (shapeType === "circle") expect(shape.widthMm).toBe(shape.heightMm);
    },
  );

  it.each(["line", "rectangle", "circle"] as const)(
    "uses whole-millimeter defaults for a %s shape",
    (shapeType) => {
      const shape = createShape(
        {
          ...document.plates[0]!,
          size: { widthMm: 19.4, heightMm: 11.7 },
        },
        shapeType,
      );

      expect(Number.isInteger(shape.xMm)).toBe(true);
      expect(Number.isInteger(shape.yMm)).toBe(true);
      expect(Number.isInteger(shape.widthMm)).toBe(true);
      expect(Number.isInteger(shape.heightMm)).toBe(true);
    },
  );

  it("moves an element to the back or front", () => {
    const plate = document.plates[0]!;
    expect(
      moveElementLayer(plate, "image", "back").elements.map(({ id }) => id),
    ).toEqual(["image", "text"]);
    expect(
      moveElementLayer(plate, "text", "front").elements.map(({ id }) => id),
    ).toEqual(["image", "text"]);
  });

  it("keeps flag peers paired and the separation guide last", () => {
    const flag = toggleFlagPlate(document.plates[0]!);
    const reordered = moveElementLayer(flag, "image--flag-peer", "back");
    expect(editableElementCount(reordered)).toBe(2);
    expect(reordered.elements.map(({ id }) => id)).toEqual([
      "image",
      "text",
      "image--flag-peer",
      "text--flag-peer",
      `flag-guide-${flag.id}`,
    ]);
  });

  it("adds a shape and its mirrored peer to a flag", () => {
    const flag = toggleFlagPlate(document.plates[0]!);
    const shape = createShape(toggleFlagPlate(flag), "circle");
    const changed = appendElementAndFlagPeer(flag, shape);
    expect(changed.elements.find((element) => element.id === shape.id)).toEqual(
      shape,
    );
    expect(
      changed.elements.find(
        (element) => element.id === `${shape.id}--flag-peer`,
      )?.xMm,
    ).toBe(flag.size.widthMm - shape.xMm - shape.widthMm);
    expect(changed.elements.at(-1)?.id).toBe(`flag-guide-${flag.id}`);
  });

  it("deletes a flag source and its mirrored peer together", () => {
    const flag = toggleFlagPlate(document.plates[0]!);
    const changed = deleteElementAndFlagPeer(flag, "text--flag-peer");
    expect(changed.elements.map(({ id }) => id)).toEqual([
      "image",
      "image--flag-peer",
      `flag-guide-${flag.id}`,
    ]);
  });
});

describe("updatePlateEditorHeight", () => {
  it("keeps the label center fixed when its height changes", () => {
    const plate = document.plates[0]!;

    const taller = updatePlateEditorHeight(plate, 20);
    expect(taller.size.heightMm).toBe(20);
    expect(taller.elements.map(({ yMm }) => yMm)).toEqual([4, 2]);

    const shorter = updatePlateEditorHeight(taller, 12);
    expect(shorter.size.heightMm).toBe(12);
    expect(shorter.elements.map(({ yMm }) => yMm)).toEqual([0, -2]);
  });

  it("moves flag sources and peers and rebuilds its full-height guide", () => {
    const flag = toggleFlagPlate(document.plates[0]!);
    const taller = updatePlateEditorHeight(flag, 20);

    expect(taller.elements.find(({ id }) => id === "text")?.yMm).toBe(4);
    expect(
      taller.elements.find(({ id }) => id === "text--flag-peer")?.yMm,
    ).toBe(4);
    expect(taller.elements.at(-1)).toMatchObject({ yMm: 1, heightMm: 18 });
  });
});

describe("toggleFlagPlate", () => {
  it("keeps all source geometry and toggles back exactly", () => {
    const original = document.plates[0]!;
    const flag = toggleFlagPlate(original);
    const textElements = flag.elements.filter(
      (element) => element.kind === "text",
    );
    expect(textElements).toHaveLength(2);
    expect(flag.size.widthMm).toBe(202);
    expect(textElements[0]).toEqual(original.elements[0]);
    expect(textElements[1]?.xMm).toBe(112);
    expect(textElements[0]?.text).toBe("I\nWIDE");
    expect(toggleFlagPlate(flag)).toEqual(original);
  });

  it("treats the configured flag width as one half and keeps peers aligned", () => {
    const original = document.plates[0]!;
    const flag = updatePlateEditorWidth(toggleFlagPlate(original), 80);
    expect(plateEditorWidthMm(flag)).toBe(80);
    expect(flag.size.widthMm).toBe(162);

    const source = flag.elements.find((element) => element.id === "text")!;
    const moved = updateElementAndFlagPeer(flag, { ...source, xMm: 12 });
    const peer = moved.elements.find(
      (element) => element.id === "text--flag-peer",
    );
    const movedSource = moved.elements.find(
      (element) => element.id === "text",
    )!;
    expect(peer?.xMm).toBe(70);
    expect((peer?.xMm ?? 0) - 82).toBe(
      80 - (movedSource.xMm + movedSource.widthMm),
    );
    expect(toggleFlagPlate(moved).elements[0]?.xMm).toBe(12);

    const movedFromPeer = updateElementAndFlagPeer(moved, {
      ...peer!,
      xMm: 74,
    });
    expect(
      movedFromPeer.elements.find((element) => element.id === "text")?.xMm,
    ).toBe(8);
    expect(toggleFlagPlate(movedFromPeer).elements[0]?.xMm).toBe(8);
  });
});
