// Vercel serverless proxy for media sources you own or are authorized to redistribute.
// Configure PROXY_ALLOWED_HOSTS in Vercel Environment Variables as a comma-separated
// list of exact hostnames (for example: media.example.com,cdn.example.com).
// This intentionally does not act as an unrestricted public proxy.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type, Accept-Ranges",
  "Vary": "Origin"
};

function allowedHosts() {
  return (process.env.PROXY_ALLOWED_HOSTS || "")
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

function parseAllowed(raw, hosts) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
  if (!hosts.includes(u.hostname.toLowerCase())) return null;
  return u;
}

function proxyUrl(req, target) {
  const base = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  base.pathname = "/api/proxy";
  base.search = "";
  base.searchParams.set("url", target);
  return base.toString();
}

function rewritePlaylist(text, baseUrl, req, hosts) {
  const rewrite = (raw) => {
    const u = parseAllowed(new URL(raw, baseUrl).href, hosts);
    return u ? proxyUrl(req, u.href) : raw;
  };
  return text.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${rewrite(uri)}"`);
    }
    return rewrite(trimmed);
  }).join("\n");
}

export default async function handler(req, res) {
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const hosts = allowedHosts();
  if (!hosts.length) {
    return res.status(503).json({
      error: "Proxy is not configured",
      details: "Set PROXY_ALLOWED_HOSTS in the Vercel project environment variables to hostnames you own or are authorized to proxy."
    });
  }

  const raw = typeof req.query.url === "string" ? req.query.url : "";
  let target = parseAllowed(raw, hosts);
  if (!target) return res.status(403).json({ error: "URL host is not allowed" });

  try {
    let upstream;
    // Manually follow redirects and re-check every destination against the allowlist.
    for (let i = 0; i <= 4; i++) {
      upstream = await fetch(target.href, {
        method: req.method,
        redirect: "manual",
        headers: {
          "User-Agent": "KurdSport-Media-Proxy/1.0",
          "Accept": req.headers.accept || "*/*",
          ...(req.headers.range ? { "Range": req.headers.range } : {})
        }
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location || i === 4) break;
      target = parseAllowed(new URL(location, target).href, hosts);
      if (!target) return res.status(403).json({ error: "Redirect host is not allowed" });
    }

    const contentType = upstream.headers.get("content-type") || "";
    const isPlaylist = /mpegurl|vnd\.apple\.mpegurl/i.test(contentType) || /\.m3u8?($|\?)/i.test(target.pathname);
    res.status(upstream.status);
    ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "last-modified", "etag"].forEach(name => {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    });

    if (req.method === "HEAD" || !upstream.body) return res.end();

    if (isPlaylist && upstream.ok) {
      const playlist = await upstream.text();
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      return res.send(rewritePlaylist(playlist, target.href, req, hosts));
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return res.send(body);
  } catch (error) {
    return res.status(502).json({ error: "Upstream request failed", details: error.message });
  }
}
