import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateAssets } from "./assets.mjs";
import { assertSourceStateAssets } from "./state-assets.mjs";
import { assertNewGameSourceAssets } from "./new-game-assets.mjs";
import { withAssetsTreeGuard } from "./assets-tree-guard.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const source = new URL("../src/plugin/", import.meta.url);
const output = new URL("../com.ulanzi.tictactoe.ulanziPlugin/dist/", import.meta.url);
withAssetsTreeGuard(root, "build", () => {
  assertSourceStateAssets(root);
  assertNewGameSourceAssets(root);
  generateAssets(root);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(source, output, { recursive: true });
  assertSourceStateAssets(root);
  assertNewGameSourceAssets(root);
});
console.log("Generated deterministic runtime artwork derivatives, preserved source artwork, and copied runtime to package dist/.");
