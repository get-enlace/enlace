<div align="center">
  <img src="https://raw.githubusercontent.com/get-enlace/.github/refs/heads/main/brand/svgs/icon-full-100.svg" alt="Enlace Logo" width="64" height="64" />
  <h1>Enlace</h1>
  <p><strong>Turn your OpenAPI spec into an interactive visual execution graph.</strong></p>
  <p>Drag endpoints onto a canvas, wire inputs to outputs, and run multi-step API workflows concurrently — 100% in your browser.</p>

  <p>
    <a href="https://github.com/get-enlace/enlace/releases"><img src="https://img.shields.io/github/v/release/get-enlace/enlace?color=blue&label=release" alt="Release" /></a>
    <a href="https://www.npmjs.com/package/@get-enlace/ui"><img src="https://img.shields.io/npm/v/@get-enlace/ui?color=brightgreen&label=npm%20%40get-enlace%2Fui" alt="npm version" /></a>
    <a href="https://enlace-fastapi.onrender.com/enlace/"><img src="https://img.shields.io/badge/demo-live%20on%20render-success" alt="Live Demo" /></a>
    <a href="https://get-enlace.github.io/"><img src="https://img.shields.io/badge/docs-get--enlace.github.io-informational" alt="Documentation" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  </p>

  <p>
    <a href="https://enlace-fastapi.onrender.com/enlace/"><strong>🚀 Try the Live Demo</strong></a> •
    <a href="https://get-enlace.github.io/"><strong>📖 Documentation</strong></a> •
    <a href="https://github.com/get-enlace/enlace"><strong>⭐ Star on GitHub</strong></a>
  </p>
</div>

<br />

<div align="center">
  <img src="https://raw.githubusercontent.com/get-enlace/get-enlace.github.io/main/static/img/screenshots/canvas-chain-built.jpg" alt="Enlace Canvas Chained Execution" width="90%" style="border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);" />
</div>

<br />

## Why We Built Enlace

Modern APIs don't operate in silos, but the tools we use to test and explore them often do.

When testing a real-world scenario—such as creating a user, generating an auth token, creating an order with that user's ID, and processing a payment—developers usually find themselves caught between two extremes:

- **Single-endpoint doc viewers (like Swagger UI)** are fantastic for quick, one-off exploration and "Try it out" requests. But the moment a workflow requires chaining three or four calls together, you're stuck juggling multiple browser tabs, manually copy-pasting generated IDs, and re-authenticating across endpoints.
- **Full-featured API clients (like Postman or Insomnia)** can chain requests, but doing so requires writing boilerplate JavaScript pre-request/test scripts (`pm.environment.set`), managing environment variables, and maintaining separate external collections outside of your codebase.
- **Ad-hoc glue scripts** (`curl`, Python, bash) solve the automation, but they are throwaway, tedious to maintain, and lack visual feedback.

### The Missing Middle Ground

We built **Enlace** to live right in the sweet spot between single-call documentation and script-heavy API clients:

- **Zero Setup & Native to Your Code**: Mounts directly into your existing backend (FastAPI, Express, NestJS, ASP.NET Core, Spring Boot) in two lines of code, reading directly from your application's OpenAPI document.
- **Visual & Declarative**: Drag endpoints onto an infinite canvas and connect response fields into request parameters with live JSONPath autocomplete (`{{tag}}`) — no pre-request scripts or code needed.
- **Concurrent by Default**: Independent branches execute in parallel via Kahn’s algorithm DAG level-ordering, rather than strictly sequential loops.
- **100% In-Browser & Zero-Trust**: Everything runs client-side. Your secrets and tokens stay in browser memory, requests fire directly from your browser to your API, and nothing is proxied through an external server.

Enlace only needs one thing: **a valid OpenAPI 3.x document**. It works with FastAPI, Swashbuckle, Springdoc, NestJS, Express, or any hand-written spec.

---

## ⚡ 2-Line Quickstart

Mount Enlace into your existing backend with just two lines of code:

### Python (FastAPI)
```bash
pip install enlace-fastapi
```
```python
from enlace_fastapi import enlace

enlace(app, spec=app.openapi())
```

### Node.js (Express)
```bash
npm install @get-enlace/express
```
```typescript
import { enlace } from '@get-enlace/express';

app.use('/enlace', enlace({ spec: openApiDoc }));
```

### Node.js (NestJS)
```bash
npm install @get-enlace/nest
```
```typescript
import { EnlaceModule } from '@get-enlace/nest';

@Module({ imports: [EnlaceModule.forRoot({ spec: openApiDoc })] })
export class AppModule {}
```

### C# / .NET (ASP.NET Core)
```bash
dotnet add package Enlace.AspNetCore
```
```csharp
app.UseEnlace();
```

### Java (Spring Boot 3)
```xml
<dependency>
    <groupId>io.github.get-enlace</groupId>
    <artifactId>enlace-spring-boot-starter</artifactId>
    <version>0.0.9</version>
</dependency>
```
*Autoconfigured automatically at `/enlace` alongside Springdoc.*

---

## 🌟 Key Features

| Feature | Description |
| :--- | :--- |
| ⚡ **Concurrent Execution** | Independent DAG branches execute in parallel via Kahn's algorithm level-ordering. Slow endpoints never block unrelated sibling requests. |
| 🔒 **Zero-Trust Security** | All requests fire directly from the browser `fetch()`. Bearer tokens and secrets stay in browser memory and are automatically redacted from logs. The adapter never proxies execution traffic. |
| 💾 **IndexedDB Persistence** | Workflows, layouts, node groups, and last-run execution outputs survive browser refreshes automatically with zero database setup. |
| 🐞 **Interactive Debugger** | Double-click any connector edge to arm breakpoints. Preview resolved pre-flight requests before firing, pause/step/continue, or use **Debug failed** to resume from a failure point. |
| 🏷️ **Raw JSON & JSONPath** | Full raw JSON editing with schema autocomplete. Insert dynamic `{{tag}}` chips referencing upstream responses and generate random data with `$rand.*`. |
| 🧩 **Preset Nodes** | Insert **Wait** pacing timers or multi-condition **Assert** verification checks into your chain. |
| 📦 **Portable Exports** | Export workflows as `.enlace` JSON. Optional **Full credentials** export uses client-side Web Crypto PBKDF2 / AES-256-GCM encryption. |

---

## 🧪 Try It Locally (Sample API Harness)

You can clone this repository and run the self-contained development harness immediately:

```bash
git clone https://github.com/get-enlace/enlace.git
cd enlace
npm install
npm start
```

This launches:
- **Canvas UI**: [http://localhost:4000/enlace](http://localhost:4000/enlace)
- **Sample API Swagger UI**: [http://localhost:4000/api-docs](http://localhost:4000/api-docs)
- **Mock OAuth2 Issuer**: `http://localhost:4001`

### 1. Parallel Execution Walkthrough
1. Drag onto the canvas: `POST /customers` (A), `PATCH /customers/{id}` (B), `POST /products` (C), `POST /orders` (D).
2. Connect box-to-box: `A → B`, `A → C`, `A → D`, `C → D`.
3. In B: map `path.id` from `A.id`.
4. In D: map `body.customerId` from `A.id`, and `body.productId` from `C.id`.
5. Click **Run**: Calls A fires first, then **B and C fire concurrently**, and once both resolve, D executes.

### 2. Interactive Breakpoint Walkthrough
1. **Double-click** the connector line between `A` and `C`. A red dot appears, indicating an armed breakpoint.
2. Click **Debug** (or Run).
3. Execution runs step A, then pauses before step C fires.
4. Inspect the pre-flight preview in the **Debugger** pane, then click **Step** or **Continue** to resume.

---

## 📂 Ecosystem Repositories

Enlace is organized into dedicated repositories per ecosystem:

- **[`get-enlace/enlace`](https://github.com/get-enlace/enlace)** — Anchor repository (Canvas UI & Execution Engine).
- **[`get-enlace/enlace-python`](https://github.com/get-enlace/enlace-python)** — FastAPI adapter (`enlace-fastapi`).
- **[`get-enlace/enlace-js`](https://github.com/get-enlace/enlace-js)** — Express (`@get-enlace/express`) & NestJS (`@get-enlace/nest`) adapters.
- **[`get-enlace/enlace-dotnet`](https://github.com/get-enlace/enlace-dotnet)** — ASP.NET Core adapter (`Enlace.AspNetCore`).
- **[`get-enlace/enlace-java`](https://github.com/get-enlace/enlace-java)** — Spring Boot starter (`enlace-spring-boot-starter`).
- **[`get-enlace/enlace-examples`](https://github.com/get-enlace/enlace-examples)** — Cross-language conformance sample apps.
- **[`get-enlace/get-enlace.github.io`](https://github.com/get-enlace/get-enlace.github.io)** — Documentation site and guides.

---

## 🛠️ Architecture & Contributing

- Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for a technical deep-dive into the client-side execution model, data model, and security guarantees.
- Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for instructions on local setup, running tests, and submitting pull requests.

---

## 📄 License

Enlace is open-source software licensed under the [MIT License](LICENSE).  
Copyright (c) 2026 The Enlace Authors.
