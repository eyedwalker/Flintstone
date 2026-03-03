import { test, expect } from '@playwright/test';
import { login, navigateTo, waitForSpinner } from './helpers';

test.describe('Escalation Configuration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigates to escalation page from sidebar', async ({ page }) => {
    const escalationLink = page.locator('a:has-text("Escalation")');
    if (await escalationLink.isVisible().catch(() => false)) {
      await escalationLink.click();
      await expect(page).toHaveURL(/\/escalation/);
      await expect(page.locator('h2')).toHaveText('Escalation Configuration');
    }
  });

  test('shows assistant selector dropdown', async ({ page }) => {
    await navigateTo(page, '/escalation');
    await waitForSpinner(page);

    await expect(page.locator('mat-select')).toBeVisible();
    await expect(page.locator('mat-label:has-text("Select Assistant")')).toBeVisible();
  });

  test('config sections hidden until assistant selected', async ({ page }) => {
    await navigateTo(page, '/escalation');
    await waitForSpinner(page);

    // Config sections should not be visible when no assistant is selected
    await expect(page.locator('.config-sections')).toBeHidden();
  });

  test('selecting an assistant shows config sections', async ({ page }) => {
    await navigateTo(page, '/escalation');
    await waitForSpinner(page);

    // Open the assistant dropdown
    await page.locator('mat-select').first().click();

    // Wait for options to appear
    const options = page.locator('mat-option');
    if (await options.count() > 0) {
      await options.first().click();
      await waitForSpinner(page);

      // Config sections should be visible now
      await expect(page.locator('.config-sections')).toBeVisible();
      await expect(page.locator('mat-slide-toggle:has-text("Enable Escalation")')).toBeVisible();
    }
  });

  test('Salesforce connection card has required fields', async ({ page }) => {
    await navigateTo(page, '/escalation');
    await waitForSpinner(page);

    // Select first assistant if available
    await page.locator('mat-select').first().click();
    const options = page.locator('mat-option');
    if (await options.count() > 0) {
      await options.first().click();
      await waitForSpinner(page);

      await expect(page.locator('mat-card-title:has-text("Salesforce Connection")')).toBeVisible();
      await expect(page.locator('input[placeholder="https://yourorg.my.salesforce.com"]')).toBeVisible();
      await expect(page.locator('button:has-text("Test Connection")')).toBeVisible();
    }
  });

  test('trigger mode radio buttons are present', async ({ page }) => {
    await navigateTo(page, '/escalation');
    await waitForSpinner(page);

    await page.locator('mat-select').first().click();
    const options = page.locator('mat-option');
    if (await options.count() > 0) {
      await options.first().click();
      await waitForSpinner(page);

      await expect(page.locator('mat-radio-button:has-text("Manual only")')).toBeVisible();
      await expect(page.locator('mat-radio-button:has-text("Auto-detect only")')).toBeVisible();
      await expect(page.locator('mat-radio-button:has-text("Both manual + auto-detect")')).toBeVisible();
    }
  });

  test('auto-trigger rules show when trigger mode is auto or both', async ({ page }) => {
    await navigateTo(page, '/escalation');
    await waitForSpinner(page);

    await page.locator('mat-select').first().click();
    const options = page.locator('mat-option');
    if (await options.count() > 0) {
      await options.first().click();
      await waitForSpinner(page);

      // Select "Auto-detect only"
      await page.locator('mat-radio-button:has-text("Auto-detect only")').click();

      // Auto-trigger rules should appear
      await expect(page.locator('.auto-triggers')).toBeVisible();
      await expect(page.locator('mat-label:has-text("Trigger Keywords")')).toBeVisible();
      await expect(page.locator('mat-label:has-text("Max Turns Before Escalation")')).toBeVisible();
    }
  });

  test('case defaults section has priority, origin, status dropdowns', async ({ page }) => {
    await navigateTo(page, '/escalation');
    await waitForSpinner(page);

    await page.locator('mat-select').first().click();
    const options = page.locator('mat-option');
    if (await options.count() > 0) {
      await options.first().click();
      await waitForSpinner(page);

      await expect(page.locator('mat-card-title:has-text("Case Defaults")')).toBeVisible();
      await expect(page.locator('mat-label:has-text("Priority")')).toBeVisible();
      await expect(page.locator('mat-label:has-text("Origin")')).toBeVisible();
      await expect(page.locator('mat-label:has-text("Status")')).toBeVisible();
    }
  });

  test('save button is present', async ({ page }) => {
    await navigateTo(page, '/escalation');
    await waitForSpinner(page);

    await page.locator('mat-select').first().click();
    const options = page.locator('mat-option');
    if (await options.count() > 0) {
      await options.first().click();
      await waitForSpinner(page);

      await expect(page.locator('button:has-text("Save Configuration")')).toBeVisible();
    }
  });
});
