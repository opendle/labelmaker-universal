import { MakeIdE1Adapter } from "../dist/index.js";
import { MacOsMakeIdTransportProvider } from "../dist/macos-transport.js";
import { createInterface } from "node:readline/promises";

const shouldPrint = process.argv.includes("--print");
const shouldTestPowerCycle = process.argv.includes("--power-cycle");
const context = {
  log: {
    debug: (message, detail) => console.error(message, detail ?? {}),
    info: (message, detail) => console.error(message, detail ?? {}),
    warn: (message, detail) => console.error(message, detail ?? {}),
    error: (message, detail) => console.error(message, detail ?? {}),
  },
};
const adapter = new MakeIdE1Adapter(new MacOsMakeIdTransportProvider());
const printers = await adapter.discover(
  { timeoutMs: 5_000, includeUnpaired: true },
  context,
);
const e1Printers = printers.filter(
  (candidate) => candidate.connection.profileId === "e1-abf0-203",
);
if (e1Printers.length !== 1) {
  throw new Error(
    `Expected one nearby MakeID E1 printer; found ${e1Printers.length}`,
  );
}
const printer = e1Printers[0];
const session = await adapter.connect(printer, context);
try {
  const status = await session.status();
  console.log(
    JSON.stringify({ printer: printer.displayName, status }, null, 2),
  );
  if (!shouldPrint && !shouldTestPowerCycle) {
    process.exitCode = status.state === "ready" ? 0 : 2;
  }
  if (shouldTestPowerCycle) {
    if (status.state !== "ready") throw new Error("The printer is not ready");
    const terminal = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    await terminal.question(
      "Turn the printer off, wait five seconds, turn it on, then press Enter. ",
    );
    terminal.close();
    const reconnectedStatus = await session.status();
    console.log(
      JSON.stringify(
        { printer: printer.displayName, reconnectedStatus },
        null,
        2,
      ),
    );
    process.exitCode = reconnectedStatus.state === "ready" ? 0 : 2;
  }
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
