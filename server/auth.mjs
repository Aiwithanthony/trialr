import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "trialr_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_DELAY_MS = 400;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 10_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function safeEqual(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers?.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    cookies[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return cookies;
}

function isSecureRequest(request) {
  return request.headers?.["x-forwarded-proto"] === "https" || Boolean(request.socket?.encrypted);
}

export function createAuth({
  password = process.env.TRIALR_PASSWORD || "",
  deployed = Boolean(process.env.RAILWAY_ENVIRONMENT),
} = {}) {
  const required = Boolean(password) || deployed;
  const misconfigured = deployed && !password;
  const tokenKey = createHash("sha256").update(`trialr-auth::${password}`).digest();
  const failures = new Map();

  function sign(expiry) {
    return createHmac("sha256", tokenKey).update(String(expiry)).digest("hex");
  }

  function createToken() {
    const expiry = Date.now() + SESSION_MS;
    return `${expiry}.${sign(expiry)}`;
  }

  function isValidToken(token) {
    const [rawExpiry, signature] = String(token || "").split(".");
    const expiry = Number(rawExpiry);
    if (!Number.isFinite(expiry) || expiry < Date.now() || !signature) return false;
    return safeEqual(signature, sign(expiry));
  }

  function sessionCookie(request, value, maxAgeSeconds) {
    const flags = [`${COOKIE_NAME}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
    if (isSecureRequest(request)) flags.push("Secure");
    return flags.join("; ");
  }

  function failureCount(ip) {
    const entry = failures.get(ip);
    if (!entry || Date.now() - entry.startedAt > FAILURE_WINDOW_MS) return 0;
    return entry.count;
  }

  function recordFailure(ip) {
    const entry = failures.get(ip);
    if (!entry || Date.now() - entry.startedAt > FAILURE_WINDOW_MS) {
      failures.set(ip, { startedAt: Date.now(), count: 1 });
      return;
    }
    entry.count += 1;
  }

  function isAuthenticated(request) {
    if (!required) return true;
    if (misconfigured) return false;
    return isValidToken(parseCookies(request)[COOKIE_NAME]);
  }

  function guard(request, response) {
    if (!required || isAuthenticated(request)) return false;
    if (misconfigured) {
      sendJson(response, 503, {
        error: "Trialr is deployed without a password. Set TRIALR_PASSWORD in the environment and redeploy.",
        code: "AUTH_NOT_CONFIGURED",
      });
      return true;
    }
    sendJson(response, 401, { error: "Sign in to use Trialr.", code: "AUTH_REQUIRED" });
    return true;
  }

  async function handle(request, response) {
    const url = new URL(request.url, "http://trialr.local");
    if (!url.pathname.startsWith("/api/auth/")) return false;

    if (url.pathname === "/api/auth/status" && request.method === "GET") {
      sendJson(response, 200, { required, misconfigured, authenticated: isAuthenticated(request) });
      return true;
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (misconfigured || !required) {
        sendJson(response, misconfigured ? 503 : 200, misconfigured
          ? { error: "Set TRIALR_PASSWORD in the environment first.", code: "AUTH_NOT_CONFIGURED" }
          : { authenticated: true });
        return true;
      }

      const ip = request.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket?.remoteAddress || "unknown";
      if (failureCount(ip) >= MAX_FAILURES) {
        sendJson(response, 429, { error: "Too many attempts. Try again in a few minutes." });
        return true;
      }

      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "Send the password as JSON." });
        return true;
      }

      if (!safeEqual(String(body.password || ""), password)) {
        recordFailure(ip);
        await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
        sendJson(response, 401, { error: "That password is not correct." });
        return true;
      }

      failures.delete(ip);
      response.setHeader("Set-Cookie", sessionCookie(request, createToken(), Math.floor(SESSION_MS / 1000)));
      sendJson(response, 200, { authenticated: true });
      return true;
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      response.setHeader("Set-Cookie", sessionCookie(request, "", 0));
      sendJson(response, 200, { authenticated: false });
      return true;
    }

    sendJson(response, 404, { error: "Auth route not found." });
    return true;
  }

  return { required, misconfigured, isAuthenticated, guard, handle };
}
