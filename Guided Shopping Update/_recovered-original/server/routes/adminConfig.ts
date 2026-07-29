import express, { Request, Response } from 'express';
import * as configStore from '../services/configStore';

const router = express.Router();

const ALLOWED_KEYS = new Set(['tiles', 'pages']);

router.get('/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'Unknown config key' });
  try {
    const value = await configStore.get(key);
    return res.json({ key, value });
  } catch (err: any) {
    console.error('[admin-config] get failed:', err.message);
    return res.status(500).json({ error: 'Failed to read config' });
  }
});

router.put('/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ error: 'Unknown config key' });
  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: 'value is required' });
  try {
    await configStore.put(key, value);
    return res.json({ key, ok: true });
  } catch (err: any) {
    console.error('[admin-config] put failed:', err.message);
    return res.status(500).json({ error: 'Failed to write config' });
  }
});

export default router;
