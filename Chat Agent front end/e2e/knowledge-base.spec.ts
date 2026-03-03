import { test, expect } from '@playwright/test';
import { login, navigateTo, waitForSpinner } from './helpers';

test.describe('Knowledge Bases', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to knowledge bases page', async ({ page }) => {
    await navigateTo(page, '/knowledge-bases');
    await waitForSpinner(page);

    await expect(page.locator('h2')).toHaveText('Knowledge Bases');
  });

  test('shows New Knowledge Base button', async ({ page }) => {
    await navigateTo(page, '/knowledge-bases');
    await waitForSpinner(page);

    await expect(page.locator('button:has-text("New Knowledge Base")')).toBeVisible();
  });

  test('clicking New Knowledge Base toggles create form', async ({ page }) => {
    await navigateTo(page, '/knowledge-bases');
    await waitForSpinner(page);

    // Form should be hidden initially
    await expect(page.locator('.create-card')).toBeHidden();

    // Click to show
    await page.locator('button:has-text("New Knowledge Base")').click();
    await expect(page.locator('.create-card')).toBeVisible();
    await expect(page.locator('input[placeholder="e.g. Product Documentation"]')).toBeVisible();

    // Create button disabled when name is empty
    const createBtn = page.locator('.create-card button:has-text("Create")');
    await expect(createBtn).toBeDisabled();

    // Fill name
    await page.locator('input[placeholder="e.g. Product Documentation"]').fill('Test KB');
    await expect(createBtn).toBeEnabled();
  });

  test('create form has default checkbox', async ({ page }) => {
    await navigateTo(page, '/knowledge-bases');
    await waitForSpinner(page);

    await page.locator('button:has-text("New Knowledge Base")').click();
    await expect(page.locator('mat-checkbox:has-text("Set as organization default")')).toBeVisible();
  });

  test('shows empty state or KB cards', async ({ page }) => {
    await navigateTo(page, '/knowledge-bases');
    await waitForSpinner(page);

    const cards = page.locator('.kb-card');
    const emptyState = page.locator('.empty-state:has-text("No knowledge bases yet")');

    const hasCards = await cards.first().isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasCards || hasEmpty).toBeTruthy();
  });

  test('KB card shows stats (content count, linked assistants, status)', async ({ page }) => {
    await navigateTo(page, '/knowledge-bases');
    await waitForSpinner(page);

    const firstCard = page.locator('.kb-card').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await expect(firstCard.locator('.stat-label:has-text("Content Items")')).toBeVisible();
      await expect(firstCard.locator('.stat-label:has-text("Linked Assistants")')).toBeVisible();
      await expect(firstCard.locator('.stat-label:has-text("Status")')).toBeVisible();
    }
  });
});
