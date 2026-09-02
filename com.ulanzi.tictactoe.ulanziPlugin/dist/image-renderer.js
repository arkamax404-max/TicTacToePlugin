const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const CELL_STATE_FILES = Object.freeze({
  empty: "blank-runtime.png",
  X: "cross-runtime.png",
  O: "circle-runtime.png",
});
const NEW_GAME_IMAGE_FILES = Object.freeze({
  default: "new-game-runtime.png",
  victory: "victory-runtime.png",
  defeat: "defeat-runtime.png",
  draw: "draw-runtime.png",
});
const pngImageCache = new Map();

function dataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function shell(content, background = "#101820", border = "#263746") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196"><rect width="196" height="196" rx="18" fill="${background}"/><rect x="7" y="7" width="182" height="182" rx="14" fill="none" stroke="${border}" stroke-width="6"/>${content}</svg>`;
}

function runtimeAssetPath(filename) {
  const candidates = [
    join(__dirname, "../assets", filename),
    join(__dirname, "../../com.ulanzi.tictactoe.ulanziPlugin/assets", filename),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`Missing runtime artwork: ${filename}`);
  return path;
}

function imageFileForCell(state, index) {
  return CELL_STATE_FILES[state.board[index] || "empty"];
}

function createCellImage(state, index) {
  const filename = imageFileForCell(state, index);
  return createPngImage(filename);
}

function createPngImage(filename) {
  if (!pngImageCache.has(filename)) {
    pngImageCache.set(
      filename,
      `data:image/png;base64,${readFileSync(runtimeAssetPath(filename)).toString("base64")}`,
    );
  }
  return pngImageCache.get(filename);
}

function createNewGameImage(display = "default") {
  const filename = NEW_GAME_IMAGE_FILES[display];
  if (!filename) throw new Error(`Unsupported New Game display: ${display}`);
  return createPngImage(filename);
}

function createScoreImage(view) {
  const content = `<text x="98" y="35" fill="#ffffff" font-family="Arial, sans-serif" font-size="21" font-weight="700" text-anchor="middle">SESSION</text><text x="98" y="82" fill="#64e6ff" font-family="Arial, sans-serif" font-size="31" font-weight="700" text-anchor="middle">X ${view.score.X}</text><text x="98" y="124" fill="#ffb347" font-family="Arial, sans-serif" font-size="31" font-weight="700" text-anchor="middle">O ${view.score.O}</text><text x="98" y="165" fill="#d4dce2" font-family="Arial, sans-serif" font-size="23" font-weight="700" text-anchor="middle">DRAW ${view.score.draws}</text>`;
  return dataUri(shell(content));
}

module.exports = {
  CELL_STATE_FILES,
  NEW_GAME_IMAGE_FILES,
  createCellImage,
  createNewGameImage,
  createScoreImage,
  imageFileForCell,
};
