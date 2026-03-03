import { environment } from '../../../environments/environment';

const PLACEHOLDER_PATTERNS = [
  'REPLACE_BEFORE_DEPLOY',
  'PROD_POOL_ID',
  'PROD_CLIENT_ID',
  'XXXXXXXXXX',
  'price_PROD_',
];

/**
 * Checks the environment config for placeholder values that must be replaced
 * before a production deployment.
 *
 * In development mode: logs warnings to the console.
 * In production mode: throws an error to prevent broken deployments.
 */
export function validateEnvironment(): void {
  const issues: string[] = [];

  function check(path: string, value: unknown): void {
    if (typeof value === 'string') {
      for (const pattern of PLACEHOLDER_PATTERNS) {
        if (value.includes(pattern)) {
          issues.push(`${path} contains placeholder "${pattern}"`);
          break;
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, val] of Object.entries(value)) {
        check(`${path}.${key}`, val);
      }
    }
  }

  check('environment', environment);

  if (issues.length === 0) return;

  const msg = `Environment validation failed:\n  - ${issues.join('\n  - ')}`;

  if (environment.production) {
    throw new Error(msg);
  } else {
    console.warn(`[env-validator] ${msg}`);
  }
}
