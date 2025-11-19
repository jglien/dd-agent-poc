// Purpose: Minimal Express API that emits a log, a DogStatsD metric, and a Datadog trace per request.
// Why: Demonstrates metrics, logs, and traces in one call, aligned with Fargate Agent sidecar behavior.

import express, { Request, Response } from 'express';
import ddTracer from 'dd-trace';
import dgram from 'dgram';

// Initialize Datadog tracer early to auto-instrument libraries.
// Unified service tagging: DD_ENV, DD_SERVICE, DD_VERSION should be provided via environment (from your stack/globalTags).
ddTracer.init({
  logInjection: true,        // Adds trace IDs into logs for correlation
  runtimeMetrics: true,      // Collects runtime metrics from the tracer
  // Agent host stays default (localhost) in Fargate; DD_AGENT_HOST is not required.
});

const app = express();
const PORT = Number(process.env.PORT || 80);

// DogStatsD client (UDP to localhost:8125)
const STATSD_HOST = process.env.DD_DOGSTATSD_HOST || '127.0.0.1';
const STATSD_PORT = Number(process.env.DD_DOGSTATSD_PORT || 8125);
const statsdSocket = dgram.createSocket('udp4');

// Helper to send a DogStatsD counter metric
function sendRequestMetric(route: string, statusCode: number, durationMs: number) {
  // DogStatsD format: <metric.name>:<value>|<type>|#tag1:value,tag2:value
  const service = process.env.DD_SERVICE || 'dd-agent-poc';
  const env = process.env.DD_ENV || 'dev';
  const version = process.env.DD_VERSION || '0.1';

  const tags = `service:${service},env:${env},version:${version},route:${route},status:${statusCode}`;
  const counter = `demo.requests:1|c|#${tags}`;
  const timing = `demo.request_latency:${durationMs}|h|#${tags}`; // histogram for latency

  const payloads = [counter, timing];
  payloads.forEach((payload) => {
    const buf = Buffer.from(payload);
    statsdSocket.send(buf, 0, buf.length, STATSD_PORT, STATSD_HOST);
  });
}

// Health endpoint for ALB target group
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('ok');
});

// Root endpoint: emits log, metric, and trace
app.get('/', (req: Request, res: Response) => {
  const start = Date.now();
  // Start a manual span to demonstrate tracing explicitly
  const span = ddTracer.startSpan('web.request', {
    tags: {
      'http.method': 'GET',
      'http.url': '/',
    },
  });

  // Business logic: simple response
  const message = 'hello from datadog-apm demo';
  res.status(200).send(message);

  const durationMs = Date.now() - start;
  const statusCode = res.statusCode;

  // Structured log with correlation fields (dd-trace logInjection will add trace_id, span_id)
  const logEvent = {
    level: 'info',
    msg: 'request served',
    route: '/',
    method: 'GET',
    status: statusCode,
    duration_ms: durationMs,
    env: process.env.DD_ENV || 'dev',
    service: process.env.DD_SERVICE || 'dd-agent-poc',
    version: process.env.DD_VERSION || '0.1',
    timestamp: new Date().toISOString(),
  };
  // Emit JSON log to stdout
  // Fluent Bit/FireLens or the Datadog Agent will forward this to Datadog Logs
  console.log(JSON.stringify(logEvent));

  // Emit DogStatsD metrics
  sendRequestMetric('/', statusCode, durationMs);

  // Finish the trace span
  span.finish();
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
