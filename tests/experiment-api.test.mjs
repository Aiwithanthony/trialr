import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createExperimentApi } from "../server/experiment-api.mjs";

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

test("persists experiments and published variants", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "trialr-experiments-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const api = createExperimentApi({ filePath: join(directory, "experiments.json") });

  const createResponse = response();
  await api.handle(request("POST", "/api/experiments", {
    name: "Pink vs red text",
    hypothesis: "Pink text holds attention longer",
    primaryMetric: "igReelsAvgWatchTime",
  }), createResponse, "");

  assert.equal(createResponse.statusCode, 201);
  assert.equal(createResponse.body.experiment.name, "Pink vs red text");
  const experimentId = createResponse.body.experiment.id;

  const variantResponse = response();
  await api.handle(request("POST", `/api/experiments/${experimentId}/variants`, {
    label: "Pink text hook",
    originalFilename: "IMG_1024.mp4",
    zernioPostId: "post_123",
    platformPostUrl: "https://instagram.com/reel/example",
    thumbnail: "data:image/jpeg;base64,dGVzdA==",
    status: "published",
  }), variantResponse, "");

  assert.equal(variantResponse.statusCode, 201);
  assert.equal(variantResponse.body.variant.label, "Pink text hook");

  const listResponse = response();
  await api.handle(request("GET", "/api/experiments"), listResponse, "");
  assert.equal(listResponse.body.experiments[0].variants.length, 1);
  assert.equal(listResponse.body.experiments[0].variants[0].zernioPostId, "post_123");
  assert.equal(listResponse.body.experiments[0].variants[0].thumbnail, "data:image/jpeg;base64,dGVzdA==");
});

test("refreshes and stores analytics for every variant", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "trialr-analytics-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const api = createExperimentApi({ filePath: join(directory, "experiments.json") });
  const originalFetch = global.fetch;
  context.after(() => {
    global.fetch = originalFetch;
  });

  const createResponse = response();
  await api.handle(request("POST", "/api/experiments", { name: "Hook test" }), createResponse, "");
  const experimentId = createResponse.body.experiment.id;
  await api.handle(request("POST", `/api/experiments/${experimentId}/variants`, {
    label: "Question hook",
    zernioPostId: "post_analytics",
  }), response(), "");

  global.fetch = async () => new Response(JSON.stringify({
    status: "published",
    publishedAt: "2026-07-22T12:00:00.000Z",
    analytics: { views: 1200, reach: 980, saves: 44 },
    platformAnalytics: [{
      platform: "instagram",
      platformPostId: "ig_123",
      platformPostUrl: "https://instagram.com/reel/ig_123",
      syncStatus: "synced",
      analytics: { views: 1200, reach: 980, saves: 44, igReelsAvgWatchTime: 6200 },
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  const refreshResponse = response();
  await api.handle(request("POST", `/api/experiments/${experimentId}/refresh`), refreshResponse, "sk_test");

  assert.equal(refreshResponse.statusCode, 200);
  const variant = refreshResponse.body.experiment.variants[0];
  assert.equal(variant.platformPostId, "ig_123");
  assert.equal(variant.analytics.views, 1200);
  assert.equal(variant.analytics.igReelsAvgWatchTime, 6200);
  assert.equal(variant.analyticsSnapshots.length, 1);
});

test("deletes a test and leaves the others untouched", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "trialr-experiments-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "experiments.json");
  const api = createExperimentApi({ filePath });

  const keptResponse = response();
  await api.handle(request("POST", "/api/experiments", { name: "Keep me" }), keptResponse, "");
  const doomedResponse = response();
  await api.handle(request("POST", "/api/experiments", { name: "Delete me" }), doomedResponse, "");
  const doomedId = doomedResponse.body.experiment.id;

  const variantResponse = response();
  await api.handle(request("POST", `/api/experiments/${doomedId}/variants`, {
    label: "Variant A",
    zernioPostId: "post_123",
  }), variantResponse, "");
  assert.equal(variantResponse.statusCode, 201);

  const deleteResponse = response();
  await api.handle(request("DELETE", `/api/experiments/${doomedId}`), deleteResponse, "");

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deleteResponse.body.deletedId, doomedId);
  assert.equal(deleteResponse.body.variantCount, 1);

  // The delete has to survive a reload, not just disappear from memory.
  const reloaded = await createExperimentApi({ filePath }).readData();
  assert.deepEqual(reloaded.experiments.map((entry) => entry.name), ["Keep me"]);
});

test("deleting a test that does not exist reports 404", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "trialr-experiments-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const api = createExperimentApi({ filePath: join(directory, "experiments.json") });

  const res = response();
  await api.handle(request("DELETE", "/api/experiments/does-not-exist"), res, "");

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "Experiment not found.");
});
