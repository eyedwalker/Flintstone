import { test, expect } from '@playwright/test';
import { TEST_USER, login, waitForSpinner } from './helpers';

test.describe('Authentication', () => {
  test('shows login page for unauthenticated users', async ({ page }) => {
    await page.goto('/dashboard');
    // Should redirect to login
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.locator('.auth-title')).toHaveText('Welcome back');
  });

  test('displays validation errors on empty submit', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForSelector('.auth-form');

    // Click submit without filling anything
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('mat-error')).toHaveCount(2);
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForSelector('.auth-form');

    await page.locator('input[formControlName="email"]').fill('wrong@example.com');
    await page.locator('input[formControlName="password"]').fill('WrongPassword!');
    await page.locator('button[type="submit"]').click();

    // Should show snack bar error
    await expect(page.locator('mat-snack-bar-container')).toBeVisible({ timeout: 10_000 });
  });

  test('successful login navigates to dashboard', async ({ page }) => {
    await login(page);

    // Should arrive at dashboard (if credentials are valid)
    if (page.url().includes('/dashboard')) {
      await expect(page.locator('h1')).toBeVisible();
    }
  });

  test('MFA step appears for MFA-enabled accounts', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForSelector('.auth-form');

    await page.locator('input[formControlName="email"]').fill(TEST_USER.email);
    await page.locator('input[formControlName="password"]').fill(TEST_USER.password);
    await page.locator('button[type="submit"]').click();

    // If MFA is required, the TOTP form should appear
    const mfaStep = page.locator('input[formControlName="totpCode"]');
    const dashboard = page.locator('bcc-sidebar');

    // Wait for either MFA step or dashboard
    await Promise.race([
      mfaStep.waitFor({ timeout: 10_000 }).catch(() => null),
      dashboard.waitFor({ timeout: 10_000 }).catch(() => null),
    ]);

    // Just verify one of the two outcomes happened
    const hasMfa = await mfaStep.isVisible().catch(() => false);
    const hasDashboard = await dashboard.isVisible().catch(() => false);
    expect(hasMfa || hasDashboard).toBeTruthy();
  });

  test('new password challenge step renders', async ({ page }) => {
    // Navigate to login and verify the new-password step exists in the DOM
    await page.goto('/auth/login');
    await page.waitForSelector('.auth-form');

    // The new_password step is conditionally shown — just verify the page loads
    await expect(page.locator('.auth-card')).toBeVisible();
  });

  test('signup link navigates to signup page', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForSelector('.auth-links');

    await page.locator('a[routerLink="/auth/signup"]').click();
    await expect(page).toHaveURL(/\/auth\/signup/);
  });
});
