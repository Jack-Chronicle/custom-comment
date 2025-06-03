// esbuild.config.mjs
import esbuild from "esbuild";

// Add __DEV__ global for dev/prod logging
const isDev = process.env.npm_lifecycle_event === "dev";

const buildOptions = {
    entryPoints: ["src/main.ts"],
    outdir: "dist",
    bundle: true,
    external: ["obsidian"],
    format: "cjs",
    platform: "node",
    logLevel: "info",
    sourcemap: true,
    treeShaking: true,
    minify: true,
    entryNames: "[name]",
    assetNames: "[name]",
    define: {
        __DEV__: JSON.stringify(isDev),
    },
};

esbuild.build(buildOptions);

// Only run dev build if explicitly in dev mode
if (process.env.npm_lifecycle_event === "dev") {
    (async () => {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log("Watching for changes...");
    })();
}
