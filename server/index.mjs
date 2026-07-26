import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth } from "./auth.mjs";
import { handleExperimentApi } from "./experiment-api.mjs";
import { handleZernioApi } from "./zernio-api.mjs";

const root = fileURLToPath(new URL("../dist/client", import.meta.url));
const port = Number(process.env.PORT || 4173);
const apiKey = process.env.ZERNIO_API_KEY || "";
const auth = createAuth();
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function serveFile(response, path) {
  response.statusCode = 200;
  response.setHeader("Content-Type", contentTypes[extname(path)] || "application/octet-stream");
  createReadStream(path).pipe(response);
}

createServer(async (request, response) => {
  if (await auth.handle(request, response)) return;
  if (request.url.startsWith("/api/") && auth.guard(request, response)) return;
  if (await handleExperimentApi(request, response, apiKey)) return;
  if (await handleZernioApi(request, response, apiKey)) return;

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(root, requested === "/" ? "index.html" : requested);

  if (filePath.startsWith(root) && existsSync(filePath) && statSync(filePath).isFile()) {
    serveFile(response, filePath);
    return;
  }

  const indexPath = join(root, "index.html");
  if (existsSync(indexPath)) {
    serveFile(response, indexPath);
    return;
  }

  response.statusCode = 503;
  response.end("Build Trialr first with npm run build.");
}).listen(port, "0.0.0.0", () => {
  console.log(`Trialr is running on http://localhost:${port}`);
});
