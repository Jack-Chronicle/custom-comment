/*
ESBuild configuration

Imports Included:
- esbuild: For building the plugin
- builtin-modules: To exclude Node built-in modules from the bundle
- fs: For file system operations
- path: For path operations
- buildOptionsPartial: Additional build options from a separate file

Options explained:
- entryPoints: Entry file(s) for the build (src/main.ts and src/styles.css)
- bundle: Bundle all dependencies into the output
- external: Exclude these modules from the bundle (Obsidian, Electron, Node built-ins)
- format: Output format (CommonJS for Obsidian plugins)
- target: JavaScript version target (ES2020)
- outdir: Output directory (dist)
- sourcemap: Generate source maps for debugging
- logLevel: Logging verbosity (info)
- treeShaking: Remove unused code
- platform: Target platform (node)
- minify: Minify output for smaller files
- entryNames: Output filename for entry points ([name] = main or styles)
- assetNames: Output filename for assets ([name] = main or styles)
- watch: (dev only) Watch files and rebuild on changes
*/

import esbuild from "esbuild";
import builtins from "builtin-modules";
import buildOptionsPartial from "./build.options.mjs";

// Add __DEV__ global for dev/prod logging
const isDev = process.env.npm_lifecycle_event === "dev";

const defaultOptions = {
    outdir: "dist",
    bundle: true,
    external: ["obsidian"], // mutable array, no 'as const'
    target: "es2020",
    format: /** @type {'cjs'} */ ('cjs'), // JSDoc type annotation for compatibility
    platform: /** @type {'node'} */ ('node'), // JSDoc type annotation for compatibility
    logLevel: /** @type {'info'} */ ('info'), // JSDoc type annotation for compatibility
    sourcemap: true,
    treeShaking: true,
    minify: true,
    entryNames: "[name]",
    assetNames: "[name]",
    define: {
        __DEV__: JSON.stringify(isDev),
    },
};

const buildOptions = { ...defaultOptions, ...buildOptionsPartial };

let devCopy = 0;
let copyDevBuild = undefined;
try {
    ({ copyDevBuild } = await import("./.dev-copy.mjs"));
    devCopy = 1;
} catch (e) {
    devCopy = 0;
}

if (devCopy === 1) {
    esbuild.build(buildOptions).then(() => { if (copyDevBuild) copyDevBuild(); });
    if (process.env.npm_lifecycle_event === "dev") {
        (async () => {
            const ctx = await esbuild.context(buildOptions);
            await ctx.watch((error, result) => {
                if (copyDevBuild) copyDevBuild();
            });
            console.log("Watching for changes...");
        })();
    }
} else {
    esbuild.build(buildOptions);
    if (process.env.npm_lifecycle_event === "dev") {
        (async () => {
            const ctx = await esbuild.context(buildOptions);
            await ctx.watch();
            console.log("Watching for changes...");
        })();
    }
}