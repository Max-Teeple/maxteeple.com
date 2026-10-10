import { app } from './app';
import type { Bindings } from './types';

/**
 * html_handling is "none" so /liveview/groups.html is not redirected onto the
 * GET /liveview/groups API. Requests that miss a real file (/, /projects/,
 * /resume/) land here and resolve to index.html. Exact asset paths are served
 * before this Worker.
 */
async function fetchSiteAsset(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  const candidates = [url.pathname];
  if (url.pathname.endsWith('/')) {
    candidates.unshift(`${url.pathname}index.html`);
  } else if (!url.pathname.split('/').pop()?.includes('.')) {
    candidates.push(`${url.pathname}.html`);
    candidates.push(`${url.pathname}/index.html`);
  }

  let last = new Response('Not found', { status: 404 });
  for (const pathname of candidates) {
    const nextUrl = new URL(request.url);
    nextUrl.pathname = pathname;
    const response = await env.ASSETS.fetch(new Request(nextUrl.toString(), request));
    if (response.ok || response.status === 304) return response;
    last = response;
  }
  return last;
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/liveview' && !url.pathname.startsWith('/liveview/')) {
      return fetchSiteAsset(request, env);
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/liveview' || url.pathname === '/liveview/')) {
      const indexUrl = new URL(request.url);
      indexUrl.pathname = '/liveview/index.html';
      const index = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));
      const headers = new Headers(index.headers);
      headers.set('Cache-Control', 'no-cache');
      return new Response(index.body, { status: index.status, statusText: index.statusText, headers });
    }
    return app.fetch(request, env, ctx);
  }
};
