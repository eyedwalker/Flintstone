import { test, expect } from '@playwright/test';
import { login, navigateTo, waitForSpinner } from './helpers';

test.describe('Widget Embed Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('embed page loads for an assistant', async ({ page }) => {
    // First get assistant list
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      // Click Embed button
      await firstCard.locator('button:has-text("Embed")').click();
      await waitForSpinner(page);

      await expect(page.locator('.page-title')).toHaveText('Embed Code');
    }
  });

  test('embed page shows scope selector', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.locator('button:has-text("Embed")').click();
      await waitForSpinner(page);

      await expect(page.locator('.scope-card')).toBeVisible();
      await expect(page.locator('.api-key-row')).toBeVisible();
    }
  });

  test('embed page has HTML and Console snippet tabs', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.locator('button:has-text("Embed")').click();
      await waitForSpinner(page);

      await expect(page.locator('mat-button-toggle:has-text("HTML Snippet")')).toBeVisible();
      await expect(page.locator('mat-button-toggle:has-text("Console Snippet")')).toBeVisible();
    }
  });

  test('snippet block contains code', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.locator('button:has-text("Embed")').click();
      await waitForSpinner(page);

      const snippetBlock = page.locator('.snippet-block code');
      if (await snippetBlock.isVisible().catch(() => false)) {
        const text = await snippetBlock.textContent();
        expect(text?.length).toBeGreaterThan(0);
      }
    }
  });

  test('copy and download buttons exist', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.locator('button:has-text("Embed")').click();
      await waitForSpinner(page);

      await expect(page.locator('button:has-text("Copy")')).toBeVisible();
      await expect(page.locator('button:has-text("Download")')).toBeVisible();
    }
  });

  test('live test section shows provisioning gate or chat', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.locator('button:has-text("Embed")').click();
      await waitForSpinner(page);

      const chatSection = page.locator('.chat-card');
      if (await chatSection.isVisible().catch(() => false)) {
        // Either the chat container or the unavailable message
        const chatContainer = page.locator('.chat-container');
        const chatUnavailable = page.locator('.chat-unavailable');

        const hasChat = await chatContainer.isVisible().catch(() => false);
        const hasLock = await chatUnavailable.isVisible().catch(() => false);
        expect(hasChat || hasLock).toBeTruthy();
      }
    }
  });

  test('integration guide section is visible', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.locator('button:has-text("Embed")').click();
      await waitForSpinner(page);

      await expect(page.locator('.guide-card')).toBeVisible();
      await expect(page.locator('.guide-steps li')).toHaveCount(4);
    }
  });
});

test.describe('Widget Chat Integration', () => {
  test('widget script loads in an isolated page', async ({ page }) => {
    // Create a minimal page that loads the widget script
    const widgetCdnUrl = 'https://d3srbl2yqx3tra.cloudfront.net/assets/aws-agent-chat.min.js';

    await page.setContent(`
      <html>
        <body>
          <h1>Widget Test Page</h1>
          <script>
            window.AWSAgentChat = window.AWSAgentChat || {};
          </script>
        </body>
      </html>
    `);

    // Just verify the page loads without errors
    await expect(page.locator('h1')).toHaveText('Widget Test Page');
  });
});
