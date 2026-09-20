import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../../middlewares/auth';
import { eventBus } from '../../services/EventBus';

export const eventsRouter = Router();

eventsRouter.get('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
  });

  // Flush headers immediately and inform client of connection
  res.write(': connected\n\n');
  if (typeof (res as any).flush === 'function') {
    (res as any).flush();
  }

  eventBus.subscribe(userId, res);

  // Ping heartbeat every 20 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    } catch (_) {
      cleanup();
    }
  }, 20000);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(pingInterval);
    eventBus.unsubscribe(userId, res);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});
