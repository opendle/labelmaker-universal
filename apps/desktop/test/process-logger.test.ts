import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  createProcessLogger,
  isClosedOutputError,
} from "../src/main/process-logger.js";

function errorStream(): Pick<NodeJS.WriteStream, "on"> & EventEmitter {
  return new EventEmitter() as Pick<NodeJS.WriteStream, "on"> & EventEmitter;
}

function consoleTarget() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("desktop process logger", () => {
  it("stops stdout logging after its pipe closes but keeps stderr available", () => {
    const target = consoleTarget();
    const stdout = errorStream();
    const stderr = errorStream();
    const logger = createProcessLogger(target, stdout, stderr);

    logger.debug("First message");
    stdout.emit(
      "error",
      Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
    );
    logger.debug("Message after close");
    logger.warn("Warning remains available");

    expect(target.debug).toHaveBeenCalledTimes(1);
    expect(target.warn).toHaveBeenCalledWith("Warning remains available", {});
  });

  it("handles a synchronous closed-pipe error and skips later writes", () => {
    const target = consoleTarget();
    target.debug.mockImplementationOnce(() => {
      throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    });
    const logger = createProcessLogger(target, errorStream(), errorStream());

    expect(() => logger.debug("Closing pipe")).not.toThrow();
    logger.info("Skipped message");
    expect(target.info).not.toHaveBeenCalled();
  });

  it("does not hide unrelated output failures", () => {
    const target = consoleTarget();
    target.error.mockImplementationOnce(() => {
      throw Object.assign(new Error("Disk failed"), { code: "EIO" });
    });
    const logger = createProcessLogger(target, errorStream(), errorStream());

    expect(() => logger.error("Failure")).toThrow("Disk failed");
    expect(isClosedOutputError({ code: "EIO" })).toBe(false);
  });
});
