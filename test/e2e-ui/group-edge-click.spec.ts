import { test, expect } from '@playwright/test';
import { ENLACE_COLLECTION_FORMAT, ENLACE_COLLECTION_VERSION } from '../../packages/ui/src/types.js';

// Regression test: a connector edge routed through the empty space inside
// an *expanded* group's frame used to be unclickable — React Flow's own
// node wrapper sets `pointer-events: all` as an inline style (unconditional,
// in its NodeWrapper source), and an expanded group's wrapper is sized to
// the whole frame, not just its visible titlebar/border, so it silently ate
// every click landing between member cards before the edge underneath ever
// saw it. Fixed via a `style: { pointerEvents: 'none' }` override on the
// expanded group's own Node object (buildFlowGraph.ts's buildFlowNodes) —
// React Flow's own sanctioned per-node override point, not a stylesheet
// rule (no stylesheet selector, however specific, can beat an inline style
// short of `!important`).
//
// GET /products and GET /products/{id} need no credential/body setup.
const groupedCollection = {
  format: ENLACE_COLLECTION_FORMAT,
  version: ENLACE_COLLECTION_VERSION,
  name: 'Grouped connector click repro',
  exportedAt: '2026-01-01T00:00:00.000Z',
  secrets: 'stripped',
  credentials: [],
  workflows: [
    {
      id: 'workflow-1',
      name: 'Grouped connector click repro',
      specHint: { operationIds: ['GET /products', 'GET /products/{id}'] },
      nodes: [
        { id: 'n1', kind: 'operation', operationId: 'GET /products', credentialId: null },
        { id: 'n2', kind: 'operation', operationId: 'GET /products/{id}', credentialId: null },
      ],
      connections: [{ fromNodeId: 'n1', toNodeId: 'n2' }],
      nodePositions: { n1: { x: 100, y: 200 }, n2: { x: 380, y: 200 } },
      groups: [
        { id: 'g1', name: 'Group', nodeIds: ['n1', 'n2'], collapsed: false, position: { x: 0, y: 0 }, skipConfirmOnDrop: true },
      ],
    },
  ],
};

test('a connector between two members of the same expanded group is still clickable', async ({ page }) => {
  await page.goto('/enlace/');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();

  await page.locator('input[type="file"][accept*=".enlace"]').setInputFiles({
    name: 'grouped-repro.enlace',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(groupedCollection)),
  });

  const edge = page.getByTestId('rf__edge-conn-n1->n2');
  await expect(edge).toHaveCount(1);
  await expect(edge).not.toHaveClass(/selected/);

  // A real bounding-box click risks landing in empty space next to a
  // curved/near-flat path rather than on its (thin) stroke — instead,
  // compute the path's own true midpoint in screen coordinates and click
  // exactly there, so this only exercises whatever's actually intercepting
  // (or not) the pointer at that pixel, same as a real user's click would.
  // `path`/DOMPoint below are cast through `any` rather than typed against
  // SVGPathElement/DOMPoint directly — this callback runs in the browser,
  // where those are real globals, but the root tsconfig covering this
  // file's typecheck has no "dom" lib (it also covers plain Node-context
  // example/test files), so there's no ambient type for them to check
  // against here.
  const point = await edge.locator('path.react-flow__edge-path').first().evaluate((path: any) => {
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const screenPoint = new (globalThis as any).DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
    return { x: screenPoint.x, y: screenPoint.y };
  });

  await page.mouse.click(point.x, point.y);

  await expect(edge).toHaveClass(/selected/);
});
