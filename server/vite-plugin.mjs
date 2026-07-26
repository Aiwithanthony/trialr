import { loadEnv } from "vite";
import { createAuth } from "./auth.mjs";
import { handleExperimentApi } from "./experiment-api.mjs";
import { handleZernioApi } from "./zernio-api.mjs";

export function trialrApiPlugin() {
  let apiKey = process.env.ZERNIO_API_KEY || "";
  let auth = createAuth();

  return {
    name: "trialr-zernio-api",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      apiKey = process.env.ZERNIO_API_KEY || env.ZERNIO_API_KEY || "";
      auth = createAuth({ password: process.env.TRIALR_PASSWORD || env.TRIALR_PASSWORD || "" });
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (await auth.handle(request, response)) return;
        if (request.url.startsWith("/api/") && auth.guard(request, response)) return;
        if (await handleExperimentApi(request, response, apiKey)) return;
        const handled = await handleZernioApi(request, response, apiKey);
        if (!handled) next();
      });
    },
  };
}
