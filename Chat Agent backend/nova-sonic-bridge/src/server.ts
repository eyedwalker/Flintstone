/**
 * Nova Sonic 2 Bridge — entry point.
 *
 * Single-process Node.js service:
 *   • GET  /health                  → 200 OK for ECS / ALB health checks
 *   • WS   /stream?tenantId=&fromPhone=  → Twilio Media Stream endpoint
 *
 * Twilio webhook should return TwiML that opens a stream to this server:
 *   <Response>
 *     <Connect>
 *       <Stream url="wss://nova-sonic.example.com/stream?tenantId=...">
 *         <Parameter name="fromPhone" value="{{From}}" />
 *       </Stream>
 *     </Connect>
 *   </Response>
 */

import http from 'http';
import { WebSocketServer } from 'ws';
import { runSession } from './session';

const PORT = Number(process.env['PORT'] ?? 8080);

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname !== '/stream') {
    socket.destroy();
    return;
  }
  const tenantId = url.searchParams.get('tenantId') ?? '';
  const callerPhone = url.searchParams.get('fromPhone') ?? undefined;
  const direction = url.searchParams.get('direction') === 'outbound' ? 'outbound' : 'inbound';
  if (!tenantId) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    runSession(ws, { tenantId, callerPhone, direction }).catch((err) => {
      console.error('[Server] runSession crashed:', err);
      try { ws.close(1011, 'internal error'); } catch { /* ignore */ }
    });
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Server] Nova Sonic bridge listening on :${PORT}`);
});

// Graceful shutdown for ECS task termination.
const shutdown = (sig: string) => {
  console.log(`[Server] received ${sig}, shutting down`);
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
