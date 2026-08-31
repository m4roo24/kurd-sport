import fetch from 'node-fetch'; // If using an older Node template, otherwise native fetch is fine

export default async function handler(req, res) {
    // Grab the incoming URL parameter
    const streamUrl = req.query.url || req.query.stream; // Handles both ?url= and ?stream=
    
    if (!streamUrl) {
        return res.status(400).send('Error: Missing stream URL parameter.');
    }

    try {
        const response = await fetch(streamUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                // Pass Range headers if the video player requests specific chunks
                'Range': req.headers.range || '' 
            }
        });

        // Forward the correct media headers back to the player
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/x-mpegURL');
        if (response.headers.get('content-range')) {
            res.setHeader('Content-Range', response.headers.get('content-range'));
        }
        
        // Dynamic streaming: Pipe the video chunks instantly without saving to memory
        const reader = response.body;
        if (reader && typeof reader.pipe === 'function') {
            reader.pipe(res);
        } else if (reader && typeof reader.getReader === 'function') {
            // Fallback for newer web-streams API environment
            const webReader = reader.getReader();
            while (true) {
                const { done, value } = await webReader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
        } else {
            // Ultimate fallback
            const buffer = await response.arrayBuffer();
            res.send(Buffer.from(buffer));
        }

    } catch (error) {
        console.error('Streaming error:', error);
        if (!res.headersSent) {
            res.status(500).send('Proxy Connection Failed');
        }
    }
}
