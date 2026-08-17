import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const stubNodeBuiltins = {
  name: "stub-node-builtins",
  setup(buildApi) {
    buildApi.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      namespace: "node-stub",
    }));
    buildApi.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({
      contents:
        "export function createRequire() { return () => ({}); }\nexport default {};\n",
      loader: "js",
    }));
  },
};

await build({
  absWorkingDir: root,
  entryPoints: [
    "lib/workers/encode-worker.ts",
    "lib/workers/decode-worker.ts",
  ],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outdir: "public/workers",
  sourcemap: true,
  logLevel: "info",
  plugins: [stubNodeBuiltins],
});
