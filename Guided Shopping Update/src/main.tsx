/**
 * Entry — mode switcher.
 *
 *   default      → the new "3 Complete Pairs" experience (App.tsx)
 *   ?ui=classic  → the original tiles + tabs wizard (ClassicApp.tsx), kept
 *                  intact as the alternate method (Light Filters → AR →
 *                  Frames → … tabs, tiles, try-on, admin).
 *
 * Each mode dynamically imports its own stylesheet — the classic app is
 * Tailwind-based (preflight reset) and the new app is token-based CSS; loading
 * both at once would contaminate each other.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';

const params = new URLSearchParams(window.location.search);
const classic = params.get('ui') === 'classic';

function switchHref(toClassic: boolean): string {
  const q = new URLSearchParams(window.location.search);
  if (toClassic) q.set('ui', 'classic'); else q.delete('ui');
  const s = q.toString();
  return window.location.pathname + (s ? `?${s}` : '');
}

const swapPill: React.CSSProperties = {
  position: 'fixed', right: 16, bottom: 16, zIndex: 9999,
  background: '#0E7490', color: '#fff', padding: '10px 16px', borderRadius: 999,
  fontSize: 13, fontWeight: 700, textDecoration: 'none',
  boxShadow: '0 4px 14px rgba(0,0,0,.25)',
};

(async () => {
  let el: React.ReactElement;
  if (classic) {
    await import('./classic.css');
    const { default: ClassicApp } = await import('./ClassicApp');
    el = (
      <>
        <ClassicApp />
        <a href={switchHref(false)} style={swapPill}>✨ New experience</a>
      </>
    );
  } else {
    await import('./index.css');
    const { default: App } = await import('./App');
    el = <App />;
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{el}</React.StrictMode>,
  );
})();
