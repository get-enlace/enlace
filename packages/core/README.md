# @get-enlace/core

Portable Enlace chain-execution engine — zero React, DOM, or CSS dependencies.

This is a private monorepo workspace package consumed by `@get-enlace/ui` and future headless runners (such as a CLI). It is bundled into `@get-enlace/ui` at build time.

---

## Capabilities

- **OpenAPI 3.x Spec Parsing**: Discovers paths, operations, parameters, request bodies, and response schemas.
- **Dependency Graph Compilation**: Evaluates explicit connections and implicit dependencies (assert checks, credential overrides) into an executable DAG.
- **Kahn's Algorithm Concurrency**: Detects cycles and calculates execution levels for concurrent readiness-driven branch dispatch.
- **Request Resolution**: Inlines scalar parameters, constructs raw JSON bodies, substitutes JSONPath tags, and generates `$rand.*` dynamic expressions.
- **Zero-Trust Credential Injection**: Resolves Bearer, Basic, API Key, and OAuth2 tokens directly into outgoing request payloads.
- **Cryptographic Serialization**: Implements PBKDF2 / AES-256-GCM encryption and decryption for `.enlace` export collections using Web Crypto (`crypto.subtle`).

---

## Environment Requirements

- **Node.js**: `>= 18.0.0` (requires global `fetch`, `FormData`, `File`, and `crypto.subtle`).
- Also executes seamlessly in all modern evergreen browsers (Chrome, Firefox, Safari, Edge).

---

## Development & Testing

```bash
npm test --workspace @get-enlace/core
npm run build --workspace @get-enlace/core
```
