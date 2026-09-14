# @get-enlace/ui

The core canvas UI and in-browser execution engine for [Enlace](https://github.com/get-enlace/enlace) — an interactive visual execution graph for any OpenAPI 3.x API.

This package contains the drag-and-drop canvas, the operations palette, the node inspector with JSONPath tag mapping, the interactive step debugger, and local IndexedDB persistence, pre-compiled as an optimized static web bundle.

---

## Framework Adapters

In most cases, you don't need to install `@get-enlace/ui` directly. Instead, install the official adapter for your backend framework:

| Framework | Package / Dependency | Ecosystem |
| :--- | :--- | :--- |
| **FastAPI** | [`enlace-fastapi`](https://pypi.org/project/enlace-fastapi/) | Python / PyPI |
| **Express** | [`@get-enlace/express`](https://www.npmjs.com/package/@get-enlace/express) | Node.js / npm |
| **NestJS** | [`@get-enlace/nest`](https://www.npmjs.com/package/@get-enlace/nest) | Node.js / npm |
| **ASP.NET Core** | [`Enlace.AspNetCore`](https://www.nuget.org/packages/Enlace.AspNetCore) | .NET / NuGet |
| **Spring Boot** | [`enlace-spring-boot-starter`](https://central.sonatype.com/artifact/io.github.get-enlace/enlace-spring-boot-starter) | Java / Maven Central |

Each adapter serves this package's static assets and automatically resolves your application's OpenAPI document.

---

## Direct / Custom Usage

If you are building a custom adapter (e.g. for Fastify, Koa, Go, Rust, or Elixir) or embedding Enlace into an existing dashboard, you can consume `@get-enlace/ui` directly:

### 1. Installation

```bash
npm install @get-enlace/ui
```

### 2. Serving Static Assets

The package exports helper functions to resolve the local filesystem path to the static assets:

```typescript
import { getAssetPath } from '@get-enlace/ui';
import express from 'express';

const app = express();

// Serve the compiled HTML, JS, and CSS
app.use('/enlace', express.static(getAssetPath()));
```

### 3. OpenAPI Document Contract

The UI expects your backend to serve the OpenAPI 3.x JSON or YAML document at `/enlace/spec` (or a custom path configured via query parameter `?spec=/path/to/openapi.json`).

---

## How It Works

- **Zero Server Footprint**: All chain execution, JSONPath mapping, and Kahn's algorithm DAG scheduling run 100% client-side in the browser.
- **Zero-Trust Security**: Authenticating credentials live in browser memory and are never sent to or proxied through the host adapter.
- **Local Persistence**: Layouts and execution history are autosaved to the browser's IndexedDB.

---

## Documentation & Links

- **Documentation**: [https://get-enlace.github.io/](https://get-enlace.github.io/)
- **GitHub Repository**: [https://github.com/get-enlace/enlace](https://github.com/get-enlace/enlace)
- **Live Demo**: [https://enlace-fastapi.onrender.com/enlace/](https://enlace-fastapi.onrender.com/enlace/)
- **License**: MIT
