import { test, expect } from '@playwright/test';
import { login, navigateTo, waitForSpinner } from './helpers';

test.describe('Assistants', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('displays assistant list page', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    await expect(page.locator('.page-title')).toHaveText('AI Assistants');
  });

  test('shows New Assistant button', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    await expect(page.locator('button:has-text("New Assistant")')).toBeVisible();
  });

  test('shows empty state or assistant cards', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const cards = page.locator('.assistant-card');
    const emptyState = page.locator('.empty-state:has-text("No assistants yet")');

    const hasCards = await cards.first().isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasCards || hasEmpty).toBeTruthy();
  });

  test('clicking New Assistant opens creation form', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    await page.locator('button:has-text("New Assistant")').click();

    // Should navigate to the assistant form
    await expect(page).toHaveURL(/\/assistants\//);
  });

  test('assistant card shows status badge and model label', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await expect(firstCard.locator('.status-badge')).toBeVisible();
      await expect(firstCard.locator('.model-label')).toBeVisible();
    }
  });

  test('assistant card has Content, Embed, and Metrics actions', async ({ page }) => {
    await navigateTo(page, '/assistants');
    await waitForSpinner(page);

    const firstCard = page.locator('.assistant-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await expect(firstCard.locator('button:has-text("Content")')).toBeVisible();
      await expect(firstCard.locator('button:has-text("Embed")')).toBeVisible();
      await expect(firstCard.locator('button:has-text("Metrics")')).toBeVisible();
    }
  });
});
