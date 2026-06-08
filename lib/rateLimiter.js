const ipRequests = new Map();

// Automatically clear the in-memory map of IP requests every 60 seconds
setInterval(() => {
  ipRequests.clear();
}, 60 * 1000);

/**
 * Custom lightweight rate limiting middleware to prevent brute-force attacks on sensitive endpoints.
 * @param {number} limit - Maximum requests allowed per IP in a 60-second window.
 */
export function rateLimiter(limit = 60) {
  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local";
    const now = Date.now();
    const current = ipRequests.get(ip) || { count: 0, firstRequest: now };

    // Reset count if the window has passed
    if (now - current.firstRequest > 60 * 1000) {
      current.count = 0;
      current.firstRequest = now;
    }

    if (current.count >= limit) {
      return res.status(429).json({
        error: "TOO MANY REQUESTS: You have exceeded the rate limit. Please try again in 1 minute.",
      });
    }

    current.count += 1;
    ipRequests.set(ip, current);
    next();
  };
}
