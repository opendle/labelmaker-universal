import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

export async function startStaticServer(rootDirectory) {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath =
        requestUrl.pathname === "/"
          ? "index.html"
          : decodeURIComponent(requestUrl.pathname.slice(1));
      const path = resolve(rootDirectory, relativePath);
      if (
        !path.startsWith(`${rootDirectory}${sep}`) ||
        !(await stat(path)).isFile()
      ) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type":
          {
            ".css": "text/css; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".png": "image/png",
            ".svg": "image/svg+xml",
          }[extname(path)] ?? "application/octet-stream",
      });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The screenshot server did not report a local port.");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

export function watchPageFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      !text.startsWith(
        'Viewport argument key "interactive-widget" not recognized',
      )
    ) {
      const location = message.location();
      failures.push(
        location.url
          ? `${text} (${location.url}:${location.lineNumber})`
          : text,
      );
    }
  });
  return failures;
}

export function settlePage(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    );
  });
}

export function installCaptureHost(options) {
  const platform =
    typeof options === "object" && options?.platform === "android"
      ? "android"
      : "ipados";
  const includeBluetoothPrinter =
    typeof options === "boolean"
      ? options
      : (options?.includeBluetoothPrinter ?? false);
  const startWithConfiguredPrinter =
    typeof options === "boolean"
      ? true
      : (options?.startWithConfiguredPrinter ?? true);
  const printerStorageKey = `labelmaker.${platform}.printers.v1`;
  const transportDeviceId = `${platform === "android" ? "android" : "ipad"}-ble-workshop`;
  const printerId = `makeid:${transportDeviceId}`;
  localStorage.setItem(
    printerStorageKey,
    JSON.stringify(
      startWithConfiguredPrinter
        ? {
            version: 2,
            printerIds: [printerId],
            activePrinterId: printerId,
            settings: {
              [printerId]: {
                displayName: "Workshop printer",
                darkness: 20,
                printHeadSizeMm: 12,
                marginTopMm: 2,
                marginBottomMm: 2,
              },
            },
            printerRecords: {
              [printerId]: {
                id: printerId,
                adapterId: "makeid",
                displayName: "MakeID E1",
                model: "MakeID E1",
                transport: "bluetooth-low-energy",
                connection: {
                  transportDeviceId,
                  profileId: "e1-abf0-203",
                  advertisedName: "MakeID E1",
                },
              },
            },
          }
        : {
            version: 2,
            printerIds: [],
            activePrinterId: null,
            settings: {},
            printerRecords: {},
          },
    ),
  );
  const statusResponse = new Uint8Array(36);
  statusResponse.set([0x66, 36, 0, 0x10]);
  let statusBinary = "";
  for (const byte of statusResponse) {
    statusBinary += String.fromCharCode(byte);
  }
  const statusBytesBase64 = btoa(statusBinary);
  async function replyTo(request) {
    const reply = (value) => ({
      version: 1,
      id: request?.id,
      ...value,
    });
    switch (request?.method) {
      case "getHostInfo":
        return reply({
          ok: true,
          result: {
            version: 1,
            platform,
            presentation: "mobile-touch",
            printerStorageKey,
            jobIdPrefix: platform,
          },
        });
      case "loadWorkspaceRecovery":
        return reply({ ok: true, result: null });
      case "storeWorkspaceRecovery":
      case "clearWorkspaceAssociation":
      case "bluetoothPreserve":
      case "bluetoothRelease":
        return reply({ ok: true, result: null });
      case "bluetoothDiscover":
        if (includeBluetoothPrinter) {
          return reply({
            ok: true,
            result: [
              {
                id: `${platform === "android" ? "android" : "ipad"}-ble-office`,
                name: "MakeID E1-Office",
                transport: "bluetooth-low-energy",
              },
            ],
          });
        }
        break;
      case "bluetoothConnect":
        return reply({
          ok: true,
          result: { connectionId: "capture-makeid-e1" },
        });
      case "bluetoothWrite":
      case "bluetoothClose":
        return reply({ ok: true, result: null });
      case "bluetoothRead":
        return reply({
          ok: true,
          result: { bytesBase64: statusBytesBase64 },
        });
    }
    return reply({
      ok: false,
      error: {
        code: "CAPTURE_METHOD_UNAVAILABLE",
        message: `The screenshot host does not support ${String(request?.method)}.`,
      },
    });
  }

  if (platform === "ipados") {
    Object.defineProperty(window, "webkit", {
      configurable: true,
      value: {
        messageHandlers: {
          labelmaker: { postMessage: replyTo },
        },
      },
    });
    return;
  }

  const androidPort = {
    onmessage: null,
    async postMessage(serialized) {
      const request = JSON.parse(serialized);
      const response = await replyTo(request);
      androidPort.onmessage?.({ data: JSON.stringify(response) });
    },
  };
  Object.defineProperty(window, "labelmakerAndroid", {
    configurable: true,
    value: androidPort,
  });
}
