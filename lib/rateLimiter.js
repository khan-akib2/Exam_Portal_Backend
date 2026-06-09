const ipRequests = new Map();

// Periodically clean up stale rate-limiting entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of ipRequests.entries()) {
    const fresh = timestamps.filter(t => now - t < 60 * 1000);
    if (fresh.length === 0) {
      ipRequests.delete(key);
    } else {
      ipRequests.set(key, fresh);
    }
  }
}, 5 * 60 * 1000); // Run cleanup every 5 minutes

/**
 * Custom lightweight sliding-window rate limiting middleware to prevent brute-force attacks on sensitive endpoints.
 * @param {number} limit - Maximum requests allowed per IP in a rolling 60-second window.
 * @param {string} namespace - Optional namespace to scope the rate limit (prevents endpoints from sharing the same limits).
 */
export function rateLimiter(limit = 60, namespace = "global") {
  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local";
    const key = `${namespace}:${ip}`;
    const now = Date.now();
    
    if (!ipRequests.has(key)) {
      ipRequests.set(key, []);
    }
    
    const timestamps = ipRequests.get(key);
    // Filter timestamps to keep only those within the last 60 seconds
    const freshTimestamps = timestamps.filter(t => now - t < 60 * 1000);
    
    if (freshTimestamps.length >= limit) {
      return res.status(429).json({
        error: "TOO MANY REQUESTS: You have exceeded the rate limit. Please try again in 1 minute.",
      });
    }
    
    freshTimestamps.push(now);
    ipRequests.set(key, freshTimestamps);
    next();
  };
}
