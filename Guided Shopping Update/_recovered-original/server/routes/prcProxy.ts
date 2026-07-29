/**
 * Same-origin proxy to timeline-prc for the browser app.
 *
 * The prc endpoints (recommend / saved-cart / order-complete) are gated by
 * GUIDED_SHOPPING_WEBHOOK_SECRET — which must never ship in the browser
 * bundle. The frontend calls /api/prc/* on its own origin; this proxy adds
 * the secret server-side (compose passes it as VITE_TIMELINE_WEBHOOK_SECRET)
 * and forwards to TIMELINE base (VITE_TIMELINE_BASE_URL).
 */
import express, { Request, Response } from 'express';

const router = express.Router();
const BASE = process.env.VITE_TIMELINE_BASE_URL || process.env.TIMELINE_BASE_URL || 'https://prc.wubba.ai';
const SECRET = process.env.VITE_TIMELINE_WEBHOOK_SECRET || process.env.GUIDED_SHOPPING_WEBHOOK_SECRET || '';

const ALLOWED: Record<string, string> = {
  'recommend': '/api/guided-shopping/recommend',
  'saved-cart': '/api/guided-shopping/saved-cart',
  'order-complete': '/api/guided-shopping/order-complete',
};

async function forward(req: Request, res: Response, target: string) {
  try {
    const url = new URL(`${BASE}${target}`);
    for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, String(v));
    const r = await fetch(url.toString(), {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(SECRET ? { 'X-Guided-Shopping-Secret': SECRET } : {}),
      },
      body: req.method === 'POST' ? JSON.stringify(req.body || {}) : undefined,
    });
    const body = await r.text();
    res.status(r.status).type('application/json').send(body);
  } catch (e: any) {
    res.status(502).json({ success: false, error: `prc proxy: ${e.message}` });
  }
}

router.post('/:name', (req, res) => {
  const target = ALLOWED[req.params.name];
  if (!target) return res.status(404).json({ error: 'unknown proxy target' });
  return forward(req, res, target);
});
router.get('/:name', (req, res) => {
  const target = ALLOWED[req.params.name];
  if (!target) return res.status(404).json({ error: 'unknown proxy target' });
  return forward(req, res, target);
});

export default router;
