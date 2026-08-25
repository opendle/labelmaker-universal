import {
  MacOsMakeIdTransportProvider,
  MakeIdE1Adapter,
} from "../dist/index.js";

const shouldPrint = process.argv.includes("--print");
const context = {
  log: {
    debug: (message, detail) => console.error(message, detail ?? {}),
    info: (message, detail) => console.error(message, detail ?? {}),
    warn: (message, detail) => console.error(message, detail ?? {}),
    error: (message, detail) => console.error(message, detail ?? {}),
  },
};
const adapter = new MakeIdE1Adapter(new MacOsMakeIdTransportProvider());
const printers = await adapter.discover({ timeoutMs: 5_000 }, context);
if (printers.length !== 1) {
  throw new Error(
    `Expected one paired MakeID E1 printer; found ${printers.length}`,
  );
}
const printer = printers[0];
const session = await adapter.connect(printer, context);
try {
  const status = await session.status();
  console.log(
    JSON.stringify({ printer: printer.displayName, status }, null, 2),
  );
  if (!shouldPrint) process.exitCode = status.state === "ready" ? 0 : 2;
  if (shouldPrint) {
    if (status.state !== "ready") throw new Error("The printer is not ready");
    const heightPixels = 80;
    const data = new Uint8Array(12 * heightPixels);
    data[0] = 0x80;
    data[11] = 0x01;
    data[(heightPixels - 1) * 12] = 0x80;
    data[heightPixels * 12 - 1] = 0x01;
    await session.print({
      id: `makeid-hardware-smoke-${Date.now()}`,
      printerId: printer.id,
      pages: [{ widthPixels: 96, heightPixels, bytesPerRow: 12, data }],
      copies: 1,
      mediaId: "makeid-e1-16mm-continuous",
      options: { "makeid.darkness": 20 },
    });
    console.log("The four-corner hardware test was sent.");
  }
} finally {
  await session.close();
}
