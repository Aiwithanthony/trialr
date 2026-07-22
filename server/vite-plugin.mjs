import { loadEnv } from "vite";
import { handleExperimentApi } from "./experiment-api.mjs";
import { handleZernioApi } from "./zernio-api.mjs";

export function trialrApiPlugin() {
  let apiKey = process.env.ZERNIO_API_KEY || "";

  return {
    name: "trialr-zernio-api",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      apiKey = process.env.ZERNIO_API_KEY || env.ZERNIO_API_KEY || "";
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (await handleExperimentApi(request, response, apiKey)) return;
        const handled = await handleZernioApi(request, response, apiKey);
        if (!handled) next();
      });
    },
  };
}
