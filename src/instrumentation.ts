import type { Instrumentation } from 'next';

export const register = async () => {
  // All Node-only startup work lives in instrumentation-node.ts, dynamically imported
  // so the Edge bundle never pulls in process.on / node:sqlite / pino.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { start } = await import('./instrumentation-node');
  await start();
};

// Next.js calls this for every server-side error that escapes RSC render, route
// handlers, or server actions — the safety net beyond per-action try/catch. The logger
// is imported lazily so this hook stays Edge-safe.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { log } = await import('./lib/log');
  log.error(
    {
      err,
      path: request.path,
      method: request.method,
      routeType: context.routeType,
      routePath: context.routePath,
    },
    'request error'
  );
};
