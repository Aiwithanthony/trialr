import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { handleZernioApi } from "../server/zernio-api.mjs";

function request(method, url, body) {
  const stream = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  stream.method = method;
  stream.url = url;
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

test("reports whether the server has a Zernio key", async () => {
  const res = response();
  const handled = await handleZernioApi(request("GET", "/api/zernio/status"), res, "");

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { configured: false });
});

test("creates one manual Instagram Trial Reel post", async (context) => {
  const originalFetch = global.fetch;
  let captured;
  context.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ post: { _id: "post_123", status: "publishing" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  const res = response();
  await handleZernioApi(request("POST", "/api/zernio/posts", {
    accountId: "account_123",
    mediaUrl: "https://media.zernio.com/video.mp4",
    caption: "Same caption on every video",
    requestId: "request_123",
    metadata: { experimentId: "experiment_123", variantLabel: "Pink text hook" },
  }), res, "sk_test");

  assert.equal(res.statusCode, 201);
  assert.equal(captured.url, "https://zernio.com/api/v1/posts");
  assert.equal(captured.options.headers.Authorization, "Bearer sk_test");
  assert.equal(captured.options.headers["x-request-id"], "request_123");

  const payload = JSON.parse(captured.options.body);
  assert.equal(payload.publishNow, true);
  assert.deepEqual(payload.metadata, { experimentId: "experiment_123", variantLabel: "Pink text hook" });
  assert.deepEqual(payload.mediaItems, [{ type: "video", url: "https://media.zernio.com/video.mp4" }]);
  assert.deepEqual(payload.platforms, [{
    platform: "instagram",
    accountId: "account_123",
    platformSpecificData: {
      contentType: "reels",
      trialParams: { graduationStrategy: "MANUAL" },
    },
  }]);
});

test("rejects a post without an Instagram account or uploaded video", async () => {
  const res = response();
  await handleZernioApi(request("POST", "/api/zernio/posts", { caption: "Caption" }), res, "sk_test");

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "accountId and mediaUrl are required.");
});
