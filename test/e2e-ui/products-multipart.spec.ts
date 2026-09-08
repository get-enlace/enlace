import { test, expect, type Page } from '@playwright/test';
import { ENLACE_COLLECTION_FORMAT, ENLACE_COLLECTION_VERSION } from '../../packages/ui/src/types.js';

// Avoids canvas drag-and-drop (see playwright.config.ts). Imports a
// collection with POST /products, configures the declared oauth2Password
// credential (products require it), then re-selects the file behind an
// already-configured uploaded_file tag chip and Runs.
//
// The Body section is Raw JSON only now (no Form mode) — the fixture's node
// carries a rawBody with the image field already wired up as an
// `uploaded_file` tag chip (as if configured in an earlier session); the
// actual File blob is never persisted across import (see rawBodyResolver.ts
// and ARCHITECTURE.md's Data Model), so this test's own job is exercising
// that "re-select the file" recovery path, same as a real re-opened export
// would need.

const productCollection = {
  format: ENLACE_COLLECTION_FORMAT,
  version: ENLACE_COLLECTION_VERSION,
  name: 'Product image demo',
  exportedAt: '2026-01-01T00:00:00.000Z',
  secrets: 'stripped',
  credentials: [],
  workflows: [
    {
      id: 'workflow-1',
      name: 'Product image demo',
      specHint: { operationIds: ['POST /products'] },
      nodes: [
        {
          id: 'product-1',
          kind: 'operation',
          operationId: 'POST /products',
          credentialId: null,
          rawBody: {
            template: JSON.stringify({ name: 'Gadget', price: 19.5, image: '{{enlace:tag1}}' }, null, 2),
            tags: { tag1: { id: 'tag1', type: 'uploaded_file', fileName: 'placeholder.png' } },
          },
        },
      ],
      connections: [],
      nodePositions: { 'product-1': { x: 120, y: 120 } },
    },
  ],
};

async function openCredentialsDrawer(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: /Credentials \(\d+\)/ }).click();
}

test('POST /products multipart: re-select the image behind an uploaded_file tag, Run, see imageLocation', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/enlace/');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();

  // Import first — replaceWorkflow clears credentials, so configure oauth2 after.
  await page.locator('input[type="file"][accept*=".enlace"]').setInputFiles({
    name: 'product-demo.enlace',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(productCollection)),
  });

  await openCredentialsDrawer(page);
  await page.locator('.declared-credential', { hasText: 'oauth2Password' }).getByRole('button', { name: 'Configure' }).click();
  await page.getByPlaceholder('resource owner username').fill('admin');
  await page.getByPlaceholder('resource owner password').fill('anything');
  await page.getByRole('button', { name: 'Verify & Save' }).click();
  await expect(page.locator('.credential-card', { hasText: 'oauth2Password' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Close credentials' }).click();

  await page.locator('.react-flow__node').filter({ hasText: '/products' }).click();
  await expect(page.getByRole('heading', { name: 'Body' })).toBeVisible();

  // Attach the oauth2 credential via the lock menu.
  await page.getByRole('button', { name: 'Credential' }).click();
  await page.getByRole('option', { name: 'oauth2Password' }).click();

  // The image field is already an uploaded_file tag chip (imported above) —
  // click it to open the config modal and re-select the file, same recovery
  // flow a real re-opened export needs (the blob itself is never persisted).
  await page.locator('.tag-chip', { hasText: 'placeholder.png' }).click();
  await page.getByLabel('File to upload').setInputFiles({
    name: 'gadget.png',
    mimeType: 'image/png',
    buffer: Buffer.from('fake-png-bytes'),
  });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.tag-chip', { hasText: 'gadget.png' })).toBeVisible();

  await page.getByRole('button', { name: 'Run', exact: true }).click();

  await expect(page.getByText('201')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.debug-body__pre').filter({ hasText: '"imageLocation"' })).toContainText(
    'enlace-sample-product-images'
  );
});
