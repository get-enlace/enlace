# Contributing to Enlace

Thank you for your interest in contributing to **Enlace**! Whether you are fixing a bug, adding an adapter, improving the canvas UX, or refining documentation, your contributions are welcome.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please be respectful and constructive in all issues, pull requests, and discussions.

---

## How Can I Contribute?

### 1. Reporting Bugs
- Search existing [GitHub Issues](https://github.com/get-enlace/enlace/issues) to make sure your bug has not already been reported.
- If it hasn't, open a new issue using the **Bug Report** template.
- Include your environment (browser, OS, adapter version), clear steps to reproduce, and a minimal OpenAPI spec snippet if possible.

### 2. Suggesting Enhancements
- Check [Roadmap](https://github.com/get-enlace/enlace/blob/main/ROADMAP.md) and open issues to see if your idea is already being explored.
- Open a new issue using the **Feature Request** template describing the problem and your proposed solution.

### 3. Improving Documentation
- Documentation lives at [`get-enlace.github.io`](https://github.com/get-enlace/get-enlace.github.io).
- Typos, clearer quickstart guides, and adapter usage examples are always appreciated!

### 4. Code Contributions
- For non-trivial features or architecture changes, please open an issue first to discuss the approach before investing significant coding time.
- For small bug fixes and polish, feel free to open a Pull Request directly.

---

## Local Development Setup

### Prerequisites
- **Node.js**: `>= 18.0.0`
- **npm**: `>= 9.0.0`

### Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/get-enlace/enlace.git
cd enlace
npm install
```

### Running Locally

```bash
# 1. Start the integrated dev harness (sample API + mock OAuth2 server + canvas)
npm start
# -> Canvas UI:       http://localhost:4000/enlace
# -> Mock Swagger UI: http://localhost:4000/api-docs
# -> Mock OAuth2:     http://localhost:4001

# 2. Or start the Vite hot-reloading dev server for rapid UI iteration:
npm run dev --workspace @get-enlace/ui
# -> Hot Reload UI:   http://localhost:5173
```

### Running Tests & Verification

Before submitting code, ensure all test suites and typechecks pass:

```bash
npm run typecheck       # TypeScript checks across all workspaces
npm test                # Unit tests: @get-enlace/core (Node) & @get-enlace/ui (jsdom)
npm run test:e2e        # HTTP integration tests against sample API
npm run test:e2e-ui     # Playwright UI smoke tests (requires `npx playwright install chromium`)
npm run build           # Full build: @get-enlace/core -> @get-enlace/ui
```

---

## Git Workflow & Conventional Commits

1. **Fork & Branch**:
   - Branch off `main`:
     - `feat/your-feature-name`
     - `fix/issue-description`
     - `docs/what-changed`

2. **Commit Messages**:
   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat(canvas): add zoom-to-fit button`
   - `fix(executor): handle empty array response in JSONPath mapping`
   - `docs(readme): add FastAPI quickstart snippet`
   - `chore(deps): update react-flow to latest`

3. **Submitting a Pull Request**:
   - Open a PR against `main`.
   - Fill out the PR template with a clear explanation of changes and screenshots/GIFs for UI changes.
   - Ensure GitHub Actions CI checks pass.

---

## Architecture Context

Enlace is structured as an npm workspace monorepo:
- **`packages/core`** (`@get-enlace/core`): Headless execution engine (spec parsing, Kahn's algorithm DAG runner, JSONPath resolution, credential injection). Zero React/DOM dependencies.
- **`packages/ui`** (`@get-enlace/ui`): React Flow visual canvas, node inspector, interactive step debugger, and IndexedDB local autosave. Bundles `@get-enlace/core` at build time.
- **`examples/sample-api`**: Self-contained dev harness with mock OAuth2 server for local testing.

For a comprehensive technical deep-dive into the design decisions, read [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Questions?

Need help or want to discuss an idea? Feel free to open a [Discussion](https://github.com/get-enlace/enlace/discussions) or join our community channels!
