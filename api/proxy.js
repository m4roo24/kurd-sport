export default async function handler(req, res) {
    // 1. Enable CORS so video players can connect safely
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    // 2. Accept either ?stream= or ?url= from your vercel.json rewrite
    let targetUrl = req.query.stream || req.query.url;
    
    if (!targetUrl) {
        return res.status(400).send('Error: No stream specified.');
    }

    // 3. AUTO-DECODE: If the link is scrambled (Base64), fix it automatically
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        try {
            targetUrl = Buffer.from(targetUrl, 'base64').toString('utf-8');
        } catch (e) {
            return res.status(400).send('Error: Invalid encoded stream format.');
        }
    }

    try {
        // 4. Fetch the real IPTV network video chunk
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Range': req.headers.range || ''
            }
        });

        if (!response.ok) return res.status(response.status).send('Streaming source offline.');

        // 5. Forward live streaming headers to your user's browser
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/x-mpegURL');
        if (response.headers.get('content-range')) {
            res.setHeader('Content-Range', response.headers.get('content-range'));
        }

        // 6. Dynamic data streaming pipeline
        const reader = response.body;
        if (reader && typeof reader.pipe === 'function') {
            reader.pipe(res);
        } else if (reader && typeof reader.getReader === 'function') {
            const webReader = reader.getReader();
            while (true) {
                const { done, value } = await webReader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
        } else {
            const buffer = await response.arrayBuffer();
            res.send(Buffer.from(buffer));
        }

    } catch (error) {
        if (!res.headersSent) res.status(500).send('Proxy Connection Failed.');
    }
}
