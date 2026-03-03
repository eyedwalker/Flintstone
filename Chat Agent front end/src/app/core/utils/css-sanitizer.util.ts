/**
 * Sanitize CSS strings before injecting via bypassSecurityTrustHtml.
 * Strips known XSS vectors from CSS to prevent injection attacks from
 * AI-generated or user-edited styles.
 */
export function sanitizeCss(css: string): string {
  return css
    // Remove any script tags that might have been injected
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Remove javascript: protocol (used in url() values)
    .replace(/javascript\s*:/gi, '')
    // Remove expression() — IE CSS expression (legacy XSS vector)
    .replace(/expression\s*\(/gi, '')
    // Remove -moz-binding (Firefox XSS vector)
    .replace(/-moz-binding\s*:/gi, '')
    // Remove behavior: url() (IE XSS vector)
    .replace(/behavior\s*:/gi, '')
    // Remove @import (can load external stylesheets with JS)
    .replace(/@import\b/gi, '')
    // Remove data: URIs in url() that aren't images (could execute JS in some browsers)
    .replace(/url\s*\(\s*['"]?\s*data:(?!image\/)/gi, 'url(data:blocked/')
    // Remove event handlers that might appear in HTML within style tags
    .replace(/on\w+\s*=/gi, '');
}
