import config from "../../vite.config.mjs";

export default {
  ...config,
  cacheDir: "node_modules/.vite-hotkeys-probe",
  server: { ...config.server, port: 3075, strictPort: true, hmr: false },
};
