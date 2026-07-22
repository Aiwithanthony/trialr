import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requestZernio } from "./zernio-api.mjs";

const DEFAULT_FILE = fileURLToPath(new URL("../data/experiments.json", import.meta.url));
const METRICS = [
  "views",
  "reach",
  "impressions",
  "likes",
  "comments",
  "shares",
  "saves",
  "engagementRate",
  "igReelsAvgWatchTime",
  "igReelsVideoViewTotalTime",
];

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
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeAnalytics(data) {
  const instagram = data.platformAnalytics?.find((entry) => entry.platform === "instagram") || data.platformAnalytics?.[0] || {};
  const source = instagram.analytics || data.analytics || {};
  const analytics = {};
  for (const metric of METRICS) analytics[metric] = Number(source[metric] || 0);

  return {
    analytics,
    status: instagram.status || data.status || "published",
    platformPostId: instagram.platformPostId || null,
    platformPostUrl: instagram.platformPostUrl || data.platformPostUrl || null,
    publishedAt: data.publishedAt || null,
    syncStatus: instagram.syncStatus || data.syncStatus || "pending",
    analyticsUpdatedAt: source.lastUpdated || new Date().toISOString(),
  };
}

export function createExperimentApi({ filePath = DEFAULT_FILE } = {}) {
  let updateQueue = Promise.resolve();

  async function readData() {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      return { version: 1, experiments: Array.isArray(parsed.experiments) ? parsed.experiments : [] };
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, experiments: [] };
      throw error;
    }
  }

  async function writeData(data) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  }

  function updateData(updater) {
    const operation = updateQueue.then(async () => {
      const data = await readData();
      const result = await updater(data);
      await writeData(data);
      return result;
    });
    updateQueue = operation.catch(() => {});
    return operation;
  }

  async function handle(request, response, apiKey) {
    const url = new URL(request.url, "http://trialr.local");
    if (!url.pathname.startsWith("/api/experiments")) return false;

    try {
      if (url.pathname === "/api/experiments" && request.method === "GET") {
        const data = await readData();
        const experiments = [...data.experiments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        sendJson(response, 200, { experiments });
        return true;
      }

      if (url.pathname === "/api/experiments" && request.method === "POST") {
        const body = await readJson(request);
        const name = cleanText(body.name, 100);
        if (!name) {
          sendJson(response, 400, { error: "Experiment name is required." });
          return true;
        }

        const experiment = {
          id: crypto.randomUUID(),
          name,
          hypothesis: cleanText(body.hypothesis, 240),
          primaryMetric: METRICS.includes(body.primaryMetric) ? body.primaryMetric : "views",
          status: "active",
          createdAt: new Date().toISOString(),
          variants: [],
        };
        await updateData((data) => data.experiments.push(experiment));
        sendJson(response, 201, { experiment });
        return true;
      }

      const variantMatch = url.pathname.match(/^\/api\/experiments\/([^/]+)\/variants$/);
      if (variantMatch && request.method === "POST") {
        const body = await readJson(request);
        const label = cleanText(body.label, 120);
        if (!label || !body.zernioPostId) {
          sendJson(response, 400, { error: "label and zernioPostId are required." });
          return true;
        }

        const variant = {
          id: crypto.randomUUID(),
          label,
          originalFilename: cleanText(body.originalFilename, 240),
          zernioPostId: cleanText(body.zernioPostId, 160),
          platformPostId: cleanText(body.platformPostId, 160) || null,
          platformPostUrl: cleanText(body.platformPostUrl, 1000) || null,
          mediaUrl: cleanText(body.mediaUrl, 2000) || null,
          thumbnail: cleanText(body.thumbnail, 500_000) || null,
          status: cleanText(body.status, 40) || "processing",
          publishedAt: body.publishedAt || new Date().toISOString(),
          createdAt: new Date().toISOString(),
          analytics: null,
          syncStatus: "pending",
          analyticsUpdatedAt: null,
          analyticsSnapshots: [],
        };

        const result = await updateData((data) => {
          const experiment = data.experiments.find((entry) => entry.id === variantMatch[1]);
          if (!experiment) return null;
          experiment.variants.push(variant);
          return experiment;
        });
        if (!result) {
          sendJson(response, 404, { error: "Experiment not found." });
          return true;
        }
        sendJson(response, 201, { variant, experiment: result });
        return true;
      }

      const refreshMatch = url.pathname.match(/^\/api\/experiments\/([^/]+)\/refresh$/);
      if (refreshMatch && request.method === "POST") {
        if (!apiKey) {
          sendJson(response, 503, { error: "Zernio is not configured." });
          return true;
        }
        const current = await readData();
        const experiment = current.experiments.find((entry) => entry.id === refreshMatch[1]);
        if (!experiment) {
          sendJson(response, 404, { error: "Experiment not found." });
          return true;
        }

        const refreshed = [];
        const failures = [];
        for (const variant of experiment.variants) {
          try {
            const analyticsData = await requestZernio(apiKey, `/analytics?postId=${encodeURIComponent(variant.zernioPostId)}`);
            refreshed.push({ variantId: variant.id, ...normalizeAnalytics(analyticsData) });
          } catch (error) {
            failures.push({ variantId: variant.id, error: error.message });
          }
        }

        const updated = await updateData((data) => {
          const target = data.experiments.find((entry) => entry.id === refreshMatch[1]);
          if (!target) return null;
          for (const result of refreshed) {
            const variant = target.variants.find((entry) => entry.id === result.variantId);
            if (!variant) continue;
            const capturedAt = new Date().toISOString();
            Object.assign(variant, result, { lastRefreshedAt: capturedAt });
            delete variant.variantId;
            variant.analyticsSnapshots = [...(variant.analyticsSnapshots || []), { capturedAt, analytics: result.analytics }].slice(-20);
          }
          return target;
        });
        sendJson(response, failures.length && !refreshed.length ? 424 : 200, { experiment: updated, failures });
        return true;
      }

      sendJson(response, 404, { error: "Experiment API route not found." });
      return true;
    } catch (error) {
      sendJson(response, 500, { error: error.message || "Experiment request failed." });
      return true;
    }
  }

  return { handle, readData };
}

export const experimentApi = createExperimentApi();

export function handleExperimentApi(request, response, apiKey) {
  return experimentApi.handle(request, response, apiKey);
}
