import type { Express } from 'express';

// Render terminates requests through its managed edge proxy before the Node
// service. Trust only the nearest proxy hop, rather than every forwarded IP.
export const RENDER_TRUSTED_PROXY_HOPS = 1;

export function configureRenderProxyTrust(app: Express): void {
  app.set('trust proxy', RENDER_TRUSTED_PROXY_HOPS);
}
