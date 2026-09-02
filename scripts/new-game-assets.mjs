import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { optimizeRuntimeStatePng, RUNTIME_STATE_DIMENSION } from "./state-assets.mjs";

export const NEW_GAME_SOURCE_FILES = Object.freeze({
  default: "new-game-source.png",
  victory: "victory-source.png",
  defeat: "defeat-source.png",
  draw: "draw-source.png",
});

export const NEW_GAME_RUNTIME_FILES = Object.freeze({
  default: "new-game-runtime.png",
  victory: "victory-runtime.png",
  defeat: "defeat-runtime.png",
  draw: "draw-runtime.png",
});

export const NEW_GAME_SOURCE_HASHES = Object.freeze({
  "new-game-source.png": "46b70a1ea44c5345fda1ffe87e0b616e6852a537354bade63bdb35c7138859b3",
  "victory-source.png": "e0eed7d9e693c867127b61109ef607bad482ef7644af0569d7beeef31811d59c",
  "defeat-source.png": "5d7bfba13d86167566c0533337fb59dd5c50323bffb08b958fad5d68ce03f1fe",
  "draw-source.png": "86fc56a275168a98fde6ccaf51f2edce24bd2aa5b79a798e8f889462a24ea17f",
});

export const NEW_GAME_RUNTIME_DIMENSION = RUNTIME_STATE_DIMENSION;

export function assertNewGameSourceAssets(root) {
  for (const filename of Object.values(NEW_GAME_SOURCE_FILES)) {
    const source = readFileSync(`${root}/assets/${filename}`);
    const hash = createHash("sha256").update(source).digest("hex");
    if (hash !== NEW_GAME_SOURCE_HASHES[filename])
      throw new Error(`User-supplied source artwork changed: assets/${filename}`);
  }
}

export function generateNewGameAssets(root) {
  assertNewGameSourceAssets(root);
  const pluginAssets = `${root}/com.ulanzi.tictactoe.ulanziPlugin/assets`;
  rmSync(`${pluginAssets}/new-game.png`, { force: true });
  for (const [display, filename] of Object.entries(NEW_GAME_SOURCE_FILES)) {
    const outputPath = `${pluginAssets}/${NEW_GAME_RUNTIME_FILES[display]}`;
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      optimizeRuntimeStatePng(readFileSync(`${root}/assets/${filename}`)),
    );
  }
  assertNewGameSourceAssets(root);
}
