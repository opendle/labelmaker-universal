# ADR 0001: Use raster pages at the printer-adapter boundary

- Status: accepted
- Date: 2026-08-25

## Context

Printer manufacturers use different transports and command languages. The label
editor must remain independent from these differences.

## Decision

The shared renderer converts each plate to a transport-neutral one-bit raster
page. A printer adapter receives raster pages plus common print settings and
converts them to printer commands.

## Consequences

- The UI and saved document do not import printer protocol code.
- Adapters can share common raster tests.
- A printer with useful vector-native features cannot use them in the first
  contract. A later optional vector capability can be added without changing the
  basic raster path.
