export default async function handler(req, res) {
  // CORS first
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization, Origin, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, Accept-Ranges');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { stream, ext } = req.query;
  if (!stream) return res.status(400).send('Missing stream');

  // Decode base64 stream URL
  let targetUrl;
  try {
    targetUrl = Buffer.from(decodeURIComponent(stream), 'base64').toString('utf-8');
  } catch (e) {
    return res.status(400).send('Invalid stream');
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).send('Invalid URL');
  }

  try {
    const fetchHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': req.headers.accept || '*/*',
      'Referer': req.headers.referer || '',
    };
    if (req.headers.range) fetchHeaders['Range'] = req.headers.range;

    const fetchRes = await fetch(targetUrl, { method: 'GET', headers: fetchHeaders });

    // Forward length/range headers
    const cl = fetchRes.headers.get('content-length');
    const cr = fetchRes.headers.get('content-range');
    const ar = fetchRes.headers.get('accept-ranges');
    if (cl) res.setHeader('Content-Length', cl);
    if (cr) res.setHeader('Content-Range', cr);
    if (ar) res.setHeader('Accept-Ranges', ar);

    // Detect content type
    let contentType = fetchRes.headers.get('content-type');
    if (!contentType || contentType === 'application/octet-stream') {
      if (/\.m3u8($|\?)/i.test(targetUrl)) contentType = 'application/vnd.apple.mpegurl';
      else if (/\.ts($|\?)/i.test(targetUrl)) contentType = 'video/mp2t';
      else if (ext === '.m3u8') contentType = 'application/vnd.apple.mpegurl';
      else if (ext === '.ts') contentType = 'video/mp2t';
    }
    if (contentType) res.setHeader('Content-Type', contentType);

    // If it's a playlist, rewrite all links inside to also go through this proxy
    const isPlaylist = (contentType && /mpegurl|m3u8/i.test(contentType)) || /\.m3u8($|\?)/i.test(targetUrl);

    if (isPlaylist) {
      const text = await fetchRes.text();
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const proxyBase = `${protocol}://${host}/proxy.php`;
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

      const rewritten = text.split('\n').map(line => {
        const t = line.trim();

        // Rewrite URI="..." inside HLS tags (e.g. #EXT-X-KEY, #EXT-X-MEDIA)
        if (t.startsWith('#') && t.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/g, (_, uri) => {
            const abs = resolveUrl(uri, baseUrl);
            const uriExt = /\.m3u8($|\?)/i.test(abs) ? '.m3u8' : '.ts';
            const b64 = Buffer.from(abs).toString('base64');
            return `URI="${proxyBase}?stream=${encodeURIComponent(b64)}&ext=${uriExt}"`;
          });
        }

        // Pass through comments and empty lines
        if (!t || t.startsWith('#')) return line;

        // Rewrite segment / sub-playlist URLs
        const abs = resolveUrl(t, baseUrl);
        const urlExt = /\.m3u8($|\?)/i.test(abs) ? '.m3u8' : '.ts';
        const b64 = Buffer.from(abs).toString('base64');
        return `${proxyBase}?stream=${encodeURIComponent(b64)}&ext=${urlExt}`;
      });

      return res.status(fetchRes.status).send(rewritten.join('\n'));
    }

    // For .ts, .mp4, etc. — pipe binary
    const buf = await fetchRes.arrayBuffer();
    return res.status(fetchRes.status).send(Buffer.from(buf));

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(502).send('Proxy Error');
  }
}

function resolveUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return base + url;
  }
}
