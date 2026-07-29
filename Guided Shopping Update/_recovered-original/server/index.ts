import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import databaseRoutes from './routes/database';
import guidedShoppingRoutes from './routes/guidedShopping';
import adminConfigRoutes from './routes/adminConfig';
import prcProxyRoutes from './routes/prcProxy';
import { closeConnection } from './config/database';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '4001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/database', databaseRoutes);
app.use('/api/guided-shopping', guidedShoppingRoutes);
app.use('/api/admin-config', adminConfigRoutes);
app.use('/api/prc', prcProxyRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static Vite build (Docker runtime: /app/dist; local: ../dist)
const candidateDistDirs = [
  path.resolve('/app/dist'),
  path.resolve(__dirname, '../../dist'),
  path.resolve(__dirname, '../dist'),
  path.resolve(process.cwd(), 'dist'),
];
const distDir = candidateDistDirs.find(d => fs.existsSync(d));

if (distDir) {
  console.log(`[Server] Serving static frontend from: ${distDir}`);
  app.use(express.static(distDir));
  // SPA fallback — any non-API GET serves index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  console.warn('[Server] No Vite dist directory found — serving API only');
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Database API available at http://localhost:${PORT}/api/database`);
  console.log(`🛍️  Guided Shopping API available at http://localhost:${PORT}/api/guided-shopping`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Shutting down server...');
  await closeConnection();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
