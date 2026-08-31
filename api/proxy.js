export default async function handler(req, res) {
    // 1. Enable CORS so your web player can read the stream safely
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. Grab the live video link passed in the URL
    const streamUrl = req.query.url;
    if (!streamUrl) {
        return res.status(400).send('Error: Missing stream "url" parameter.');
    }

    try {
        // 3. Fetch the video chunk from the source server
        const response = await fetch(streamUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });

        if (!response.ok) {
            return res.status(response.status).send('Streaming server error');
        }

        // 4. Pass the streaming headers back to your user's player
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/x-mpegURL');

        // 5. Pipe the video file chunks seamlessly
        const arrayBuffer = await response.arrayBuffer();
        return res.status(200).send(Buffer.from(arrayBuffer));

    } catch (error) {
        return res.status(500).send('Proxy Connection Failed');
    }
}
