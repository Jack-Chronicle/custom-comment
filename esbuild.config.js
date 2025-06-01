// esbuild.config.mjs
import esbuild from "esbuild";

esbuild.build({
  entryPoints: ["src/main.ts"],  // Your main entry
  outfile: "main.js",
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  sourcemap: false,
  minify: false
}).catch(() => process.exit(1));
