# Enlace Architecture

This document specifies the architecture, data model, security boundaries, and execution semantics of **Enlace** — an interactive visual execution graph for OpenAPI 3.x APIs.

---

## 1. System Vision & Design Principles

1. **OpenAPI-First Contract**: The sole input requirement for Enlace is a valid OpenAPI 3.x document (JSON or YAML). Enlace is agnostic to how that document was generated (FastAPI, Swashbuckle, Springdoc, NestJS Swagger, or hand-written).
2. **100% Client-Side Execution**: All HTTP execution, field mapping, dependency resolution, and credential injection execute directly within the user's browser. There is no server-side execution engine, proxy, or orchestration backend.
3. **Thin, Symmetric Adapters**: Language adapters (Python, Node.js, .NET, Java) are intentionally lightweight and symmetric. Each adapter only has two responsibilities:
   - Serve the pre-compiled `@get-enlace/ui` static bundle.
   - Resolve and serve the application's OpenAPI document.
4. **Zero-Trust Credential Isolation**: Authenticating secrets (Bearer tokens, API keys, Basic auth, OAuth2 tokens) live exclusively in browser session memory. Credentials are never written to unencrypted storage, never logged, and never routed through the adapter.
5. **Deterministic Concurrency**: Workflows are directed acyclic graphs (DAGs). Independent branches execute concurrently using Kahn's algorithm for level-ordering and per-node readiness resolution.

---

## 2. Component Topology & Traffic Boundaries

Enlace enforces two distinct HTTP relationships that never cross:

```
                     ┌────────────────────────────────────────┐
                     │       Browser (Client-Side Only)       │
                     │                                        │
                     │  @get-enlace/ui (React Flow Canvas)    │
                     │   - Node Inspector & Raw JSON Editor   │
                     │   - IndexedDB Persistence Layer        │
                     │   - Interactive Breakpoint Debugger    │
                     │                                        │
                     │  @get-enlace/core (Execution Engine)   │
                     │   - Spec parser & dependency DAG       │
                     │   - Kahn's algorithm concurrency       │
                     │   - Request building & JSONPath tags   │
                     └───────────────┬────────────────────────┘
                                     │
             ┌───────────────────────┴─────────────────────────┐
             │ HTTP (Spec & Static UI Bundle)                  │ HTTP (Direct Execution Calls)
             ▼                                                 ▼
   ┌───────────────────────────┐                     ┌───────────────────────────┐
   │ Language Framework Adapter│                     │     Target API Under      │
   │ (FastAPI, Express, Nest,  │                     │           Test            │
   │  ASP.NET Core, Spring)    │                     │  (Any language / origin)  │
   │                           │                     └───────────────────────────┘
   │ - Mounts /enlace route    │
   │ - Resolves openapi.json   │
   └───────────────────────────┘
```

1. **Browser ↔ Adapter**: The browser requests the Enlace UI bundle and the target OpenAPI document from the adapter.
2. **Browser ↔ Target API**: All workflow execution calls fire **directly** from the browser `fetch()` to the target API endpoints. The adapter never acts as an API gateway or reverse proxy.

---

## 3. Repository & Package Ecosystem

The Enlace ecosystem consists of modular, decoupled components:

| Component | Repository | Role | Technology |
| :--- | :--- | :--- | :--- |
| **Engine & Canvas** | [`get-enlace/enlace`](https://github.com/get-enlace/enlace) | Anchor repository. Houses the headless engine (`@get-enlace/core`) and the canvas UI (`@get-enlace/ui`). | TypeScript, React, React Flow, Zustand, Vite |
| **Python Adapter** | [`get-enlace/enlace-python`](https://github.com/get-enlace/enlace-python) | FastAPI adapter (`enlace-fastapi`). | Python, `uv` workspace |
| **Node.js Adapters** | [`get-enlace/enlace-js`](https://github.com/get-enlace/enlace-js) | Express (`@get-enlace/express`) and NestJS (`@get-enlace/nest`) adapters. | TypeScript, npm monorepo |
| **.NET Adapter** | [`get-enlace/enlace-dotnet`](https://github.com/get-enlace/enlace-dotnet) | ASP.NET Core middleware (`Enlace.AspNetCore`). | C# / .NET 8 |
| **Java Adapter** | [`get-enlace/enlace-java`](https://github.com/get-enlace/enlace-java) | Spring Boot 3 starter (`enlace-spring-boot-starter`). | Java 17+, Spring Boot 3 |
| **Conformance Suite** | [`get-enlace/enlace-examples`](https://github.com/get-enlace/enlace-examples) | Cross-framework validation apps implementing the uniform [`CONTRACT.md`](https://github.com/get-enlace/enlace-examples/blob/main/CONTRACT.md). | Multi-language |
| **Documentation** | [`get-enlace.github.io`](https://github.com/get-enlace/get-enlace.github.io) | Project website, user guides, and reference docs. | Docusaurus, TypeScript |

---

## 4. Core Data Model

The data model cleanly separates the execution workflow from visual canvas chrome.

```typescript
/** An operation discovered from the OpenAPI spec */
interface Operation {
  id: string; // e.g. "POST /orders"
  method: string;
  path: string;
  parameters: OperationParameter[];
  requestBodySchema: object | null;
  responseSchema: object | null;
}

/** Discriminated union of executable canvas nodes */
type WorkflowNode = OperationNode | PresetsNode;

interface OperationNode {
  id: string;
  kind: "operation";
  operationId: string;
  credentialId: string | null;
  rawParams?: {
    paths: Record<string, RawBody>;
    queries: Record<string, RawBody>;
  } | null;
  rawHeaders?: Record<string, RawBody> | null;
  rawBody?: RawBody | null;
  credentialExtraParamOverrides?: Record<string, FieldValue>;
}

/** Preset collections (Wait timers, Assertions) */
interface PresetsNode {
  id: string;
  kind: "presets";
  credentialId: null;
  presets: Preset[];
}

type Preset =
  | { id: string; kind: "wait"; durationMs: number }
  | { id: string; kind: "assert"; checks: AssertCheck[] };

interface AssertCheck {
  id: string;
  source: {
    type: "response_body" | "response_raw" | "response_header" | "response_status";
    sourceNodeId: string;
    jsonPath?: string;
    headerName?: string;
  };
  operator: "equals" | "notEquals" | "contains" | "exists" | "notExists" | "greaterThan" | "lessThan";
  expected?: string;
}

/** Execution ordering edge */
interface WorkflowConnection {
  fromNodeId: string;
  toNodeId: string;
}

/** Visual layout grouping (canvas only, not part of execution) */
interface NodeGroup {
  id: string;
  name: string;
  nodeIds: string[];
  collapsed: boolean;
  position: { x: number; y: number };
}

/** Top-level workflow definition */
interface Workflow {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}
```

---

## 5. Execution Semantics & Concurrency

### 5.1 Graph Compilation & Cycle Detection
1. When **Run** is triggered, the engine builds a directed dependency graph.
2. The graph incorporates both explicit `WorkflowConnection` edges and implicit dependency edges:
   - Any `credentialExtraParamOverrides` referencing an upstream step.
   - Any `AssertCheck` referencing a prior step's response.
3. The graph is evaluated using **Kahn's algorithm** to verify it is acyclic and compute top-level execution tiers. If a cycle exists, execution aborts before any HTTP request fires with a `CyclicWorkflowError`.

### 5.2 Readiness-Driven Concurrency
Execution is **per-node and readiness-driven**, not locked into rigid sequential waves:
- A node fires the instant **all** of its direct upstream dependencies have successfully resolved to `'completed'`.
- Sibling branches run concurrently. If branch `A -> B` takes 2000ms and branch `A -> C` takes 100ms, node `C` completes immediately without waiting for `B`.
- Downstream nodes depending only on `C` fire immediately upon `C`'s completion.

### 5.3 Interactive Debugging & Breakpoints
- **Breakpoints**: Armed by double-clicking a connection edge. Armed connections display a distinct red marker.
- **Pre-Flight Preview**: When a node's dependencies are satisfied but it is held by an armed breakpoint, the engine compiles the complete outgoing HTTP request (substituting all headers, parameters, and tag values) and emits a preview payload without sending the request.
- **Run Controls**:
  - `Continue`: Resumes all currently paused nodes until the next breakpoint.
  - `Step`: Resumes a single designated paused node.
  - `Stop`: Immediately aborts waiting nodes, halts admission of newly ready nodes, and marks unreached nodes as `'skipped'`.

### 5.4 Error Handling & "Debug Failed"
- If a node returns an HTTP error (4xx/5xx) or encounters a network failure:
  - Downstream dependent nodes are marked as `'skipped'`.
  - Independent siblings already in flight are allowed to settle.
- **Rerun Failed / Debug Failed**:
  - The engine can seed execution with the completed results of a prior run (`resumeFrom: RunResult`).
  - Already-successful upstream nodes are preserved in cache.
  - Execution restarts specifically at the failed node, with or without breakpoints armed.

---

## 6. Persistence & Storage Architecture

1. **Client-Side IndexedDB**:
   - Enlace persists canvas layouts, nodes, connections, node groups, and last-run execution outputs using the browser's IndexedDB API.
   - Storage is namespaced by the adapter's mount path (e.g. `enlace_db_/enlace`), ensuring multiple instances on the same host do not collide.
   - Zero database setup is required on the host server.
2. **Export / Import Format (`.enlace`)**:
   - Workflows export to structured, versioned JSON (`enlace-collection` v1).
   - **Partial Export (Default)**: Exports canvas structure, node configs, and credential names/types with all secrets stripped.
   - **Full Encrypted Export**: Uses the Web Crypto API (`crypto.subtle`) to derive an AES-256-GCM key using PBKDF2 (600,000 iterations, SHA-256) from a user-provided passphrase. The resulting payload is cryptographically sealed.

---

## 7. Security & Trust Model

1. **In-Memory Secrets**:
   - Bearer tokens, Basic passwords, and API keys are stored in browser runtime memory only.
   - Secrets are automatically redacted from the UI debug pane, execution logs, and IndexedDB snapshots.
2. **CORS Policy**:
   - Because HTTP calls originate directly from the client browser, cross-origin targets must allow browser requests via appropriate `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers` configurations.
3. **Session Cookies**:
   - When configured with `cookie` auth, Enlace relies on native browser cookie handling via `credentials: 'include'`. Enlace never reads, stores, or transmits session cookies manually.
