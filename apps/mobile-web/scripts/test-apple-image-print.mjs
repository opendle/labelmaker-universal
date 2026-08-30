import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { webkit } from "playwright";
import { createServer } from "vite";

const applicationRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  logLevel: "error",
  root: applicationRoot,
  server: { hmr: false, host: "127.0.0.1" },
});
let browser;
try {
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error("The mobile test server did not start.");
  browser = await webkit.launch();
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    const value = message.text();
    if (
      message.type() === "error" &&
      !value.startsWith("Refused to connect to ws://")
    ) {
      failures.push(value);
    }
  });
  await page.goto(new URL("test/apple-image-print.html", baseUrl).href);
  const result = await page.evaluate(async () => {
    const configurationKey = "labelmaker.ipados.printers.v1";
    const deviceId = "ipad-ble-image-vector";
    const printerId = `makeid:${deviceId}`;
    localStorage.setItem(
      configurationKey,
      JSON.stringify({
        version: 2,
        printerIds: [printerId],
        activePrinterId: printerId,
        settings: {},
        printerRecords: {
          [printerId]: {
            id: printerId,
            adapterId: "makeid",
            displayName: "MakeID E1",
            model: "MakeID E1",
            transport: "bluetooth-low-energy",
            connection: {
              transportDeviceId: deviceId,
              profileId: "e1-abf0-203",
            },
          },
        },
      }),
    );
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 2;
    sourceCanvas.height = 1;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("The source canvas is not available.");
    sourceContext.fillStyle = "black";
    sourceContext.fillRect(0, 0, 1, 1);
    sourceContext.fillStyle = "white";
    sourceContext.fillRect(1, 0, 1, 1);
    const source = sourceCanvas.toDataURL("image/png");
    const status = new Uint8Array(36);
    status.set([0x66, 36, 0, 0x10]);
    let statusBinary = "";
    for (const byte of status) statusBinary += String.fromCharCode(byte);
    const statusBase64 = btoa(statusBinary);
    let writes = [];
    const reply = async (request) => {
      const success = (value) => ({
        version: 1,
        id: request.id,
        ok: true,
        result: value,
      });
      switch (request.method) {
        case "bluetoothConnect":
          return success({ connectionId: "apple-image-vector" });
        case "bluetoothWrite":
          writes.push(request.payload.bytesBase64);
          return success(null);
        case "bluetoothRead":
          return success({ bytesBase64: statusBase64 });
        case "bluetoothClose":
          return success(null);
        default:
          return {
            version: 1,
            id: request.id,
            ok: false,
            error: { code: "UNEXPECTED_METHOD", message: request.method },
          };
      }
    };
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: { messageHandlers: { labelmaker: { postMessage: reply } } },
    });
    const [{ createNativeBridge }, { MobilePrinterService }] =
      await Promise.all([
        import("/src/native-bridge.ts"),
        import("/src/printer-service.ts"),
      ]);
    const service = new MobilePrinterService(
      createNativeBridge(),
      configurationKey,
      "ipados-image-vector",
    );
    const plate = {
      id: "plate-image-vector",
      name: "Image vector",
      size: { widthMm: 10, heightMm: 10 },
      margins: { leftMm: 0, rightMm: 0 },
      elements: [
        {
          id: "image-vector",
          kind: "image",
          xMm: 0,
          yMm: 0,
          widthMm: 10,
          heightMm: 10,
          rotationDeg: 0,
          source,
          fit: "stretch",
          brightness: 128,
          contrast: 128,
          transparentBackground: false,
        },
      ],
    };
    const workspace = {
      schemaVersion: 1,
      id: "workspace-image-vector",
      name: "Image vector",
      defaultPlateSize: { widthMm: 10, heightMm: 10 },
      plates: [plate],
    };
    await service.print({
      document: workspace,
      printerId,
      plateIds: [plate.id],
    });
    const imageWrites = writes;
    writes = [];
    const emptyPlate = { ...plate, elements: [] };
    await service.print({
      document: { ...workspace, plates: [emptyPlate] },
      printerId,
      plateIds: [emptyPlate.id],
    });
    const emptyWrites = writes;
    const rasterWrites = (values) =>
      values
        .map((value) =>
          Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
        )
        .filter((value) => value[3] === 0x1b)
        .map((value) => Array.from(value));
    return {
      imageRasterWrites: rasterWrites(imageWrites),
      emptyRasterWrites: rasterWrites(emptyWrites),
    };
  });
  assert.equal(failures.length, 0, failures.join("\n"));
  assert.ok(result.imageRasterWrites.length > 0, "No image raster was sent.");
  assert.ok(result.emptyRasterWrites.length > 0, "No empty raster was sent.");
  assert.notDeepEqual(
    result.imageRasterWrites,
    result.emptyRasterWrites,
    "The image pixels did not change the MakeID raster packets.",
  );
  console.log("Apple WebKit image pixels reached the MakeID raster packets.");
} finally {
  await browser?.close();
  await server.close();
}
