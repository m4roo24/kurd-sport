// 1. Tell dotenv to look one directory up (in the root folder) for the .env file
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }); 

const express = require('express');
const axios = require('axios');
const app = express();

// 2. Load configurations from your .env file
const PORT = process.env.PORT || 3000;
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0';
const SECRET_KEY = process.env.PROXY_SECRET_KEY;

// 3. Enable CORS so video players can load your streams across domains
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

/**
 * Helper function to turn relative paths inside .m3u8 files into absolute URLs
 */
function absoluteUrl(base, relative) {
    try { 
        return new URL(relative, base).href; 
    } catch (e) { 
        return relative; 
    }
}

/**
 * Core Proxy Endpoint
 * Usage: http://localhost:3000/proxy?key=YOUR_SECRET&url=ENCODED_M3U8_URL
 */
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const clientKey = req.query.key;

    if (!targetUrl) {
        return res.status(400).send('Missing "url" query parameter.');
    }

    // 4. SECURITY CHECK: Verify the secret token if one is set in the .env file
    if (SECRET_KEY && clientKey !== SECRET_KEY) {
        return res.status(403).send('Forbidden: Invalid or missing proxy key.');
    }

    try {
        const isM3U8 = targetUrl.includes('.m3u8');
        const isTS = targetUrl.includes('.ts');

        // Fetch data from the origin server
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: isTS ? 'stream' : 'text', // Stream binary TS data, parse manifest as text
            timeout: 15000,
            headers: { 'User-Agent': USER_AGENT }
        });

        // --- HANDLE M3U8 MANIFEST REWRITING ---
        if (isM3U8) {
            res.setHeader('Content-Type', 'application/x-mpegURL');
            const lines = response.data.split(/\r?\n/);
            
            const rewrittenLines = lines.map(line => {
                // Leave metadata tags and empty lines alone
                if (!line.trim() || line.startsWith('#')) {
                    // Quick fix for DRM or encryption keys (EXT-X-KEY) if present
                    if (line.includes('URI=')) {
                        return line.replace(/URI="([^"]+)"/, (match, p1) => {
                            const absKeyUrl = absoluteUrl(targetUrl, p1);
                            const keyParam = SECRET_KEY ? `&key=${SECRET_KEY}` : '';
                            return `URI="${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absKeyUrl)}${keyParam}"`;
                        });
                    }
                    return line;
                }

                // If it's a video segment (.ts) or sub-playlist path, rewrite it through our proxy
                const absoluteSegmentUrl = absoluteUrl(targetUrl, line.trim());
                const keyParam = SECRET_KEY ? `&key=${SECRET_KEY}` : '';
                return `${req.protocol}://${req.get('host')}/proxy?url=${encodeURIComponent(absoluteSegmentUrl)}${keyParam}`;
            });

            return res.send(rewrittenLines.join('\n'));
        }

        // --- HANDLE BINARY TS SEGMENTS ---
        if (isTS) {
            res.setHeader('Content-Type', 'video/MP2T');
            // Stream chunks directly from origin to the user to keep memory usage low
            return response.data.pipe(res);
        }

        // Fallback for any other asset types (subtitles, images, etc.)
        return typeof response.data.pipe === 'function' ? response.data.pipe(res) : res.send(response.data);

    } catch (error) {
        console.error(`Proxy error for ${targetUrl}:`, error.message);
        return res.status(500).send('Proxy error encountered.');
    }
});

app.listen(PORT, () => console.log(`HLS Proxy API running on port ${PORT}`));
