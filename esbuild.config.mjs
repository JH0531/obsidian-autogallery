import esbuild from "esbuild";

const production = process.argv[2] === "production";

await esbuild.build({
  entryPoints: ["plugin.js"],
  bundle: true,
  external: ["obsidian", "@codemirror/state", "@codemirror/view"],
  format: "cjs",
  target: "es2018",
  platform: "browser",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info"
});
