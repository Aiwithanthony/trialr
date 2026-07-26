import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createAuth, isHostedEnvironment } from "../server/auth.mjs";

function request(method, url, body, headers = {}) {
  const stream = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  stream.socket = { remoteAddress: "127.0.0.1" };
  return stream;
}

function response() {
  return {
    headers: {},
    statusCode: 0,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value = "") {
      this.body = value ? JSON.parse(value) : {};
    },
  };
}

test("auth is optional when no password is configured", async () => {
  const auth = createAuth({ password: "", deployed: false });
  const res = response();

  assert.equal(auth.required, false);
  assert.equal(auth.isAuthenticated(request("GET", "/api/experiments")), true);
  assert.equal(auth.guard(request("GET", "/api/experiments"), res), false);

  await auth.handle(request("GET", "/api/auth/status"), res);
  assert.deepEqual(res.body, { required: false, misconfigured: false, authenticated: true });
});

test("protected routes reject requests without a session", async () => {
  const auth = createAuth({ password: "correct horse", deployed: false });
  const res = response();

  assert.equal(auth.guard(request("POST", "/api/zernio/posts"), res), true);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "AUTH_REQUIRED");
});

test("login with the right password issues a working session cookie", async () => {
  const auth = createAuth({ password: "correct horse", deployed: false });
  const loginRes = response();

  await auth.handle(request("POST", "/api/auth/login", { password: "correct horse" }), loginRes);
  assert.equal(loginRes.statusCode, 200);
  assert.deepEqual(loginRes.body, { authenticated: true });

  const cookie = loginRes.headers["Set-Cookie"];
  assert.match(cookie, /^trialr_session=/);
  assert.match(cookie, /HttpOnly/);

  const sessionValue = cookie.split(";")[0];
  const guarded = response();
  assert.equal(auth.guard(request("GET", "/api/experiments", null, { cookie: sessionValue }), guarded), false);
});

test("login with the wrong password fails and never sets a cookie", async () => {
  const auth = createAuth({ password: "correct horse", deployed: false });
  const res = response();

  await auth.handle(request("POST", "/api/auth/login", { password: "wrong" }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["Set-Cookie"], undefined);
});

test("a tampered session token is rejected", () => {
  const auth = createAuth({ password: "correct horse", deployed: false });
  const forged = `${Date.now() + 60_000}.abcdef0123456789`;

  assert.equal(auth.isAuthenticated(request("GET", "/api/experiments", null, { cookie: `trialr_session=${forged}` })), false);
});

test("deployed without a password locks the API instead of running open", async () => {
  const auth = createAuth({ password: "", deployed: true });
  const res = response();

  assert.equal(auth.required, true);
  assert.equal(auth.misconfigured, true);
  assert.equal(auth.guard(request("GET", "/api/experiments"), res), true);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "AUTH_NOT_CONFIGURED");
});

test("any RAILWAY_* variable marks the environment as hosted", () => {
  assert.equal(isHostedEnvironment({ PATH: "/usr/bin" }), false);
  // Railway does not inject a plain RAILWAY_ENVIRONMENT on every plan, so the
  // named and id variants have to count too.
  assert.equal(isHostedEnvironment({ RAILWAY_ENVIRONMENT_NAME: "production" }), true);
  assert.equal(isHostedEnvironment({ RAILWAY_ENVIRONMENT_ID: "0655c80f" }), true);
  assert.equal(isHostedEnvironment({ RAILWAY_SERVICE_ID: "ea4fee5f" }), true);
});

test("repeated failed logins are rate limited", async () => {
  const auth = createAuth({ password: "correct horse", deployed: false });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await auth.handle(request("POST", "/api/auth/login", { password: "wrong" }), response());
  }

  const limited = response();
  await auth.handle(request("POST", "/api/auth/login", { password: "correct horse" }), limited);
  assert.equal(limited.statusCode, 429);
});
