// Bundles the test pages' scripts (and the webview script) from src with the
// repo's webpack and ts-loader, into browser-tests/.build.
import { fileURLToPath } from "node:url";
import webpack from "webpack";

const root = fileURLToPath(new URL("..", import.meta.url));

export default function globalSetup(): Promise<void> {
  return new Promise((resolve, reject) => {
    webpack(
      {
        mode: "development",
        devtool: false,
        target: "web",
        context: root,
        entry: {
          cm6: "./browser-tests/fixtures/cm6.ts",
          richText: "./browser-tests/fixtures/richText.ts",
          preview: "./browser-tests/fixtures/preview.ts",
          checkboxRendererBrowser: "./src/checkboxRendererBrowser.ts",
        },
        output: { path: root + "browser-tests/.build", filename: "[name].js" },
        resolve: {
          extensions: [".ts", ".js"],
          extensionAlias: { ".js": [".ts", ".js"] },
        },
        module: {
          rules: [
            {
              test: /\.ts$/,
              loader: "ts-loader",
              options: {
                transpileOnly: true,
                configFile: root + "tsconfig.json",
              },
            },
          ],
        },
      },
      (error, stats) => {
        if (error || !stats || stats.hasErrors()) {
          reject(error || new Error(stats?.toString("errors-only")));
        } else {
          resolve();
        }
      },
    );
  });
}
