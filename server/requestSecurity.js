export function requestSecurity(req, res, next) {
  // Express routes are case-insensitive by default. Security checks must cover
  // every spelling that the router accepts, including /API and /Api.
  const apiRequest = /^\/api(?:\/|$)/i.test(req.path);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (apiRequest) res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  if (apiRequest && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const fetchSite = req.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin")
      return res.status(403).json({ error: "Ungültiger Ursprung." });
    const origin = req.get("origin");
    if (origin) {
      try {
        const parsed = new URL(origin);
        const expectedProtocol =
          process.env.NODE_ENV === "production" ? "https:" : "http:";
        if (
          parsed.host !== req.get("host") ||
          parsed.protocol !== expectedProtocol
        )
          return res.status(403).json({ error: "Ungültiger Ursprung." });
      } catch {
        return res.status(403).json({ error: "Ungültiger Ursprung." });
      }
    }
    // Already-open tabs may still run the previous bundle without our custom
    // header. Browsers set Sec-Fetch-Site for same-origin requests themselves.
    if (req.get("x-minimail-request") !== "1" && fetchSite !== "same-origin")
      return res.status(403).json({ error: "Ungültiger Ursprung." });
  }
  next();
}
