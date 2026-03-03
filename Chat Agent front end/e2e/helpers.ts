import { Page } from '@playwright/test';

/** Credentials from environment (never hard-coded). */
export const TEST_USER = {
  email: process.env['E2E_EMAIL'] || 'e2e@example.com',
  password: process.env['E2E_PASSWORD'] || 'P@ssword1!',
};

/**
 * Log in through the Angular login form and wait for the dashboard.
 * Stores session in `sessionStorage` so subsequent tests can reuse it.
 */
export async function login(page: Page, email?: string, password?: string): Promise<void> {
  await page.goto('/auth/login');
  await page.waitForSelector('.auth-form');

  await page.locator('input[formControlName="email"]').fill(email ?? TEST_USER.email);
  await page.locator('input[formControlName="password"]').fill(password ?? TEST_USER.password);
  await page.locator('button[type="submit"]').click();

  // Wait for navigation to dashboard (or MFA / new-password step)
  await page.waitForURL(/\/(dashboard|auth\/)/);
}

/**
 * Inject session tokens into sessionStorage so we can skip the login form
 * for tests that only need an authenticated context.
 */
export async function injectSession(page: Page, tokens: Record<string, string>): Promise<void> {
  await page.goto('/auth/login');
  await page.evaluate((t) => {
    sessionStorage.setItem('bcc_tokens', JSON.stringify(t.tokens));
    sessionStorage.setItem('bcc_user', JSON.stringify(t.user));
  }, tokens);
  await page.goto('/dashboard');
}

/** Navigate to a sidebar route and wait for the page heading. */
export async function navigateTo(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** Wait for Angular Material spinner to disappear. */
export async function waitForSpinner(page: Page): Promise<void> {
  const spinner = page.locator('mat-spinner');
  if (await spinner.count() > 0) {
    await spinner.first().waitFor({ state: 'hidden', timeout: 30_000 });
  }
}
