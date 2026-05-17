// CORS proxy for hibiki
// Deploy to Cloudflare Workers (free tier: 100k req/day)
// Usage: GET https://your-worker.workers.dev/?url=<encoded-audio-url>

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return corsResponse('Method not allowed', 405);
    }

    const { searchParams } = new URL(request.url);
    const target = searchParams.get('url');

    if (!target) return corsResponse('Missing ?url= param', 400);

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return corsResponse('Invalid URL', 400);
    }

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return corsResponse('Only http/https URLs allowed', 403);
    }

    // Forward Range header so the client can seek while streaming
    const upstreamHeaders = {};
    const range = request.headers.get('Range');
    if (range) upstreamHeaders['Range'] = range;

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: upstreamHeaders,
        redirect: 'follow',
      });
    } catch (err) {
      return corsResponse('Upstream fetch failed: ' + err.message, 502);
    }

    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    // CDNs (including GitHub Releases) often serve audio as application/octet-stream.
    // Safari refuses to stream audio with that Content-Type, so override it from the URL extension.
    const ct = headers.get('Content-Type') || '';
    if (ct.includes('octet-stream')) {
      const ext = targetUrl.pathname.split('.').pop().toLowerCase();
      const mime = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg' }[ext];
      if (mime) headers.set('Content-Type', mime);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};

function corsResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
    },
  });
}
