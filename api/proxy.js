// api/proxy.js
export default async function handler(req, res) {
  // CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { stream, url, ext } = req.query;
  let targetUrl = '';

  // 1. Decode stream URL (Base64 or Raw URL)
  if (stream) {
    try {
      targetUrl = Buffer.from(stream, 'base64').toString('utf-8');
      if (!targetUrl.startsWith('http')) {
        targetUrl = stream;
      }
    } catch (e) {
      targetUrl = stream;
    }
  } else if (url) {
    targetUrl = url;
  }

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).send('Invalid or missing stream URL parameter.');
  }

  try {
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (req.headers.range) {
      fetchHeaders['Range'] = req.headers.range;
    }

    const response = await fetch(targetUrl, { headers: fetchHeaders });

    if (!response.ok) {
      return res.status(response.status).send(`Upstream request failed with status: ${response.status}`);
    }

    // 2. Identify media format (.m3u8 playlist vs .ts chunk)
    const isM3U8 = (ext && ext.includes('m3u8')) || targetUrl.includes('.m3u8');
    const isTS = (ext && ext.includes('ts')) || targetUrl.includes('.ts');

    // Handle .m3u8 Playlists
    if (isM3U8) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      const manifestText = await response.text();

      // Get base directory path for relative TS segments
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

      // Rewrite segment URLs inside manifest to route through proxy.php with ext=.ts
      const rewrittenManifest = manifestText
        .split('\n')
        .map(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            let segmentUrl = trimmed;
            if (!segmentUrl.startsWith('http')) {
              segmentUrl = baseUrl + segmentUrl;
            }
            const encodedSegment = Buffer.from(segmentUrl).toString('base64');
            return `proxy.php?stream=${encodedSegment}&ext=.ts`;
          }
          return line;
        })
        .join('\n');

      return res.status(200).send(rewrittenManifest);
    }

    // Handle .ts Transport Stream Video Chunks
    if (isTS) {
      res.setHeader('Content-Type', 'video/mp2t');
    } else {
      const contentType = response.headers.get('content-type');
      if (contentType) res.setHeader('Content-Type', contentType);
    }

    // Return binary video stream payload
    const arrayBuffer = await response.arrayBuffer();
    return res.status(200).send(Buffer.from(arrayBuffer));

  } catch (err) {
    return res.status(500).send('Proxy Execution Error: ' + err.message);
  }
}
