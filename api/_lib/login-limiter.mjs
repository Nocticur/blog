import { isIP } from 'node:net';

// Process-local fallback. Distributed deployments also need a shared/WAF limit.
export function createLoginLimiter({ limit = 10, windowMs = 15 * 60 * 1000, maxClients = 1000, now = Date.now } = {}) {
  const clients = new Map();
  return {
    consume(client) {
      const time = now();
      for (const [key, value] of clients) if (value.expires <= time) clients.delete(key);
      let state = clients.get(client);
      if (!state) {
        if (clients.size >= maxClients) return Math.max(1, Math.ceil(windowMs / 1000));
        state = { attempts: 0, expires: time + windowMs };
        clients.set(client, state);
      }
      if (state.attempts >= limit) return Math.max(1, Math.ceil((state.expires - time) / 1000));
      state.attempts++;
      return 0;
    },
  };
}

export function loginClient(request) {
  // This header is trusted only behind Vercel's proxy, which replaces it.
  const proxied = process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for')?.trim() : '';
  return (isIP(proxied || '') && proxied) || request.clientAddress || 'unknown';
}
