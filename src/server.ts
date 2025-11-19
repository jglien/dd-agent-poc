// Purpose: Minimal Express API that emits a log, a DogStatsD metric, and a Datadog trace per request.
// Why: Demonstrates metrics, logs, and traces in one call, aligned with Fargate Agent sidecar behavior.

import express, { Request, Response } from 'express';

const app = express();
const PORT = Number(process.env.PORT || 80);

// Health endpoint for ALB target group
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('ok');
});

// Root endpoint: emits log, metric, and trace
app.get('/', (req: Request, res: Response) => {
  const start = Date.now();

  // Business logic: simple response
  const message = 'hello from demo';
  res.status(200).send(message);

  const durationMs = Date.now() - start;
  const statusCode = res.statusCode;

  const logEvent = {
    level: 'info',
    msg: 'request served',
    route: '/',
    method: 'GET',
    status: statusCode,
    duration_ms: durationMs,
    timestamp: new Date().toISOString(),
  };
  // Emit JSON log to stdout
  console.log(JSON.stringify(logEvent));
});

const server = app.listen(PORT, () => {
  console.log(JSON.stringify({ level: 'info', msg: `listening on ${PORT}`, port: PORT }));
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
