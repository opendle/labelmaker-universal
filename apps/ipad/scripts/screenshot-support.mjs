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
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      !text.startsWith(
        'Viewport argument key "interactive-widget" not recognized',
      )
    ) {
      failures.push(text);
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
  const includeBluetoothPrinter =
    typeof options === "boolean"
      ? options
      : (options?.includeBluetoothPrinter ?? false);
  const startWithConfiguredPrinter =
    typeof options === "boolean"
      ? true
      : (options?.startWithConfiguredPrinter ?? true);
  localStorage.setItem(
    "labelmaker.ipados.printers.v1",
    JSON.stringify(
      startWithConfiguredPrinter
        ? {
            printerIds: ["makeid:ipad-ble-workshop"],
            activePrinterId: "makeid:ipad-ble-workshop",
            settings: {
              "makeid:ipad-ble-workshop": {
                displayName: "Workshop printer",
                darkness: 20,
                printHeadSizeMm: 12,
                marginTopMm: 2,
                marginBottomMm: 2,
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
  Object.defineProperty(window, "webkit", {
    configurable: true,
    value: {
      messageHandlers: {
        labelmaker: {
          async postMessage(request) {
            switch (request?.method) {
              case "loadWorkspaceRecovery":
                return { ok: true, result: null };
              case "storeWorkspaceRecovery":
              case "clearWorkspaceAssociation":
                return { ok: true, result: null };
              case "bluetoothDiscover":
                if (includeBluetoothPrinter) {
                  return {
                    ok: true,
                    result: [
                      { id: "ipad-ble-office", name: "MakeID E1-Office" },
                    ],
                  };
                }
                break;
              case "bluetoothConnect":
                return {
                  ok: true,
                  result: { connectionId: "capture-makeid-e1" },
                };
              case "bluetoothWrite":
              case "bluetoothClose":
                return { ok: true, result: null };
              case "bluetoothRead":
                return {
                  ok: true,
                  result: { bytesBase64: statusBytesBase64 },
                };
            }
            return {
              ok: false,
              error: {
                code: "CAPTURE_METHOD_UNAVAILABLE",
                message: `The screenshot host does not support ${String(request?.method)}.`,
              },
            };
          },
        },
      },
    },
  });
}
