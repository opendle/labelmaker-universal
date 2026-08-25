# ADR 0002: Register adapters explicitly in each application shell

- Status: accepted
- Date: 2026-08-25

## Context

Third-party runtime plug-ins add code-signing, sandbox, compatibility, and
security problems before the adapter contract is stable.

## Decision

Desktop and server composition roots register installed adapters explicitly at
build time. Each adapter remains a separate package.

## Consequences

- Adding an adapter requires a new application build during the first releases.
- Adapter boundaries remain testable and independent.
- A signed plug-in system can be designed later from observed adapter needs.
