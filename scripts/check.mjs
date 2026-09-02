import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  RUNTIME_STATE_DIMENSION,
  STATE_RUNTIME_FILES,
  STATE_SOURCE_FILES,
  STATE_SOURCE_HASHES,
  optimizeRuntimeStatePng,
} from "./state-assets.mjs";
import {
  NEW_GAME_RUNTIME_DIMENSION,
  NEW_GAME_RUNTIME_FILES,
  NEW_GAME_SOURCE_FILES,
  NEW_GAME_SOURCE_HASHES,
} from "./new-game-assets.mjs";
import {
  APPROVED_STORE_ASSETS,
  GAMEPLAY_BANNER_SOURCE,
  GAMEPLAY_BANNER_SOURCE_HASH,
  STORE_ASSET_SOURCES,
  assertApprovedStoreAssets,
} from "./assets.mjs";

const pluginName = "com.ulanzi.tictactoe.ulanziPlugin";
const pluginRoot = new URL(`../${pluginName}/`, import.meta.url);
const projectRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", pluginRoot), "utf8"));
const packageMetadata = JSON.parse(readFileSync(new URL("package.json", projectRoot), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("package-lock.json", projectRoot), "utf8"));
const store = JSON.parse(readFileSync(new URL("store.json", projectRoot), "utf8"));
const expectedUuid = "com.ulanzi.ulanzistudio.tictactoe";
const require = createRequire(import.meta.url);
const {
  CELL_STATE_FILES,
  NEW_GAME_IMAGE_FILES,
  createCellImage,
  createNewGameImage,
  imageFileForCell,
} = require("../src/plugin/image-renderer.js");
const stateFiles = STATE_RUNTIME_FILES;
const projectRootPath = fileURLToPath(projectRoot).replaceAll("\\", "/").replace(/\/$/, "");

assertApprovedStoreAssets(projectRootPath);

for (const field of ["Author", "Name", "Description", "Detail", "Icon", "Version", "CodePath", "Type", "UUID", "Actions"]) {
  if (!manifest[field]) throw new Error(`manifest.json is missing ${field}`);
}
if (manifest.Type !== "JavaScript" || manifest.CodePath !== "dist/main.js")
  throw new Error("Manifest must use the packaged JavaScript entry point");
if (manifest.Author !== "Santiago Pérez") throw new Error("Manifest author is invalid");
if (manifest.UUID !== expectedUuid) throw new Error("Manifest UUID is invalid");
if (manifest.Version !== packageMetadata.version || manifest.Version !== packageLock.version || manifest.Version !== packageLock.packages[""].version)
  throw new Error("Plugin version must match manifest, package, and lock metadata");
if (packageMetadata.author?.name !== manifest.Author || packageMetadata.license !== "MIT" || packageLock.packages[""].license !== "MIT")
  throw new Error("Public author and license metadata must be consistent");
if (packageMetadata.repository?.url !== "https://github.com/arkamax404-max/TicTacToePlugin.git")
  throw new Error("Public repository metadata is invalid");
if (!existsSync(new URL("LICENSE", projectRoot))) throw new Error("Root MIT license is missing");
if (!readFileSync(new URL("LICENSE", projectRoot)).equals(readFileSync(new URL("LICENSE", pluginRoot))))
  throw new Error("Runnable package must contain the root MIT license unchanged");
const gameplaySource = readFileSync(new URL(`assets/${GAMEPLAY_BANNER_SOURCE}`, projectRoot));
if (createHash("sha256").update(gameplaySource).digest("hex") !== GAMEPLAY_BANNER_SOURCE_HASH)
  throw new Error(`Authoritative gameplay screenshot changed: assets/${GAMEPLAY_BANNER_SOURCE}`);
if (pngDimensions(fileURLToPath(new URL(`assets/${GAMEPLAY_BANNER_SOURCE}`, projectRoot))).join("x") !== "1536x1024")
  throw new Error(`assets/${GAMEPLAY_BANNER_SOURCE} must be 1536x1024`);
if (existsSync(new URL(`assets/${GAMEPLAY_BANNER_SOURCE}`, pluginRoot)))
  throw new Error("Gameplay banner source must not be in the runnable package");
for (const [relativePath, expected] of Object.entries(STORE_ASSET_SOURCES)) {
  const sourcePath = new URL(relativePath, projectRoot);
  if (!existsSync(sourcePath)) throw new Error(`Store asset source is missing: ${relativePath}`);
  const source = readFileSync(sourcePath);
  if (createHash("sha256").update(source).digest("hex") !== expected.sha256)
    throw new Error(`Authoritative store source changed: ${relativePath}`);
  if (pngDimensions(fileURLToPath(sourcePath)).join("x") !== `${expected.width}x${expected.height}`)
    throw new Error(`${relativePath} must be ${expected.width}x${expected.height}`);
  if (expected.width * expected.outputHeight !== expected.height * expected.outputWidth)
    throw new Error(`${relativePath} does not match its output aspect ratio`);
  if (existsSync(new URL(relativePath, pluginRoot)))
    throw new Error(`Store asset source must not be in the runnable package: ${relativePath}`);
}
if (manifest.Software?.MinVersion !== "2.1.4" || "MinimumVersion" in (manifest.Software || {}))
  throw new Error("Manifest must declare Software.MinVersion");
if (!Array.isArray(manifest.Actions) || manifest.Actions.length !== 11)
  throw new Error("Plugin must expose exactly eleven actions");

const expectedActions = [
  ...Array.from({ length: 9 }, (_, index) => `${expectedUuid}.cell-${index + 1}`),
  `${expectedUuid}.new-game`,
  `${expectedUuid}.score`,
];
if (new Set(manifest.Actions.map((action) => action.UUID)).size !== 11)
  throw new Error("Action UUIDs must be unique");
for (const uuid of expectedActions) {
  const action = manifest.Actions.find((candidate) => candidate.UUID === uuid);
  if (!action) throw new Error(`Missing fixed action ${uuid}`);
  if (action.Devices?.length !== 1 || action.Devices[0] !== "D200")
    throw new Error(`${uuid} must target D200`);
  if (action.Controllers?.length !== 1 || action.Controllers[0] !== "Keypad")
    throw new Error(`${uuid} must target Keypad`);
  if (action.DisableAutomaticStates !== true || action.States?.length !== 1)
    throw new Error(`${uuid} must expose one plugin-controlled state`);
  const expectsInspector = uuid === `${expectedUuid}.new-game`;
  if (Boolean(action.PropertyInspectorPath) !== expectsInspector)
    throw new Error(`${uuid} has an invalid Property Inspector declaration`);
}

const referenced = new Set([
  manifest.Icon,
  manifest.CategoryIcon,
  ...(manifest.Banner || []),
  ...manifest.Actions.flatMap((action) => [action.Icon, ...action.States.map((state) => state.Image)]),
  ...manifest.Actions.flatMap((action) => action.PropertyInspectorPath ? [action.PropertyInspectorPath] : []),
]);
for (const asset of referenced) {
  if (!existsSync(new URL(asset, pluginRoot))) throw new Error(`Package asset is missing: ${asset}`);
}
for (const filename of Object.values(STATE_SOURCE_FILES)) {
  const sourcePath = new URL(`assets/${filename}`, projectRoot);
  if (!existsSync(sourcePath)) throw new Error(`Source artwork is missing: assets/${filename}`);
  const source = readFileSync(sourcePath);
  const hash = createHash("sha256").update(source).digest("hex");
  if (hash !== STATE_SOURCE_HASHES[filename])
    throw new Error(`Source artwork changed: assets/${filename}`);
  if (existsSync(new URL(`assets/${filename}`, pluginRoot)))
    throw new Error(`Source artwork must not be in the runnable package: assets/${filename}`);
}
for (const filename of Object.values(NEW_GAME_SOURCE_FILES)) {
  const sourcePath = new URL(`assets/${filename}`, projectRoot);
  if (!existsSync(sourcePath)) throw new Error(`Source artwork is missing: assets/${filename}`);
  const source = readFileSync(sourcePath);
  const hash = createHash("sha256").update(source).digest("hex");
  if (hash !== NEW_GAME_SOURCE_HASHES[filename])
    throw new Error(`Source artwork changed: assets/${filename}`);
  if (existsSync(new URL(`assets/${filename}`, pluginRoot)))
    throw new Error(`Source artwork must not be in the runnable package: assets/${filename}`);
}
for (const filename of Object.values(stateFiles)) {
  if (!existsSync(new URL(`assets/${filename}`, pluginRoot)))
    throw new Error(`Required runtime state derivative is missing: assets/${filename}`);
}
if (JSON.stringify(CELL_STATE_FILES) !== JSON.stringify(stateFiles))
  throw new Error("Runtime cell-state filename mapping is invalid");
if (JSON.stringify(NEW_GAME_IMAGE_FILES) !== JSON.stringify(NEW_GAME_RUNTIME_FILES))
  throw new Error("Runtime New Game filename mapping is invalid");
for (const [stateName, filename] of Object.entries(stateFiles)) {
  const mark = stateName === "empty" ? null : stateName;
  const state = { board: [mark], winningLine: mark ? [0] : [] };
  if (imageFileForCell(state, 0) !== filename)
    throw new Error(`${stateName} does not map to ${filename}`);
  const rendered = Buffer.from(createCellImage(state, 0).split(",", 2)[1], "base64");
  const derivative = readFileSync(new URL(`assets/${filename}`, pluginRoot));
  if (!rendered.equals(derivative))
    throw new Error(`${stateName} runtime image differs from assets/${filename}`);
  const sourceFilename = STATE_SOURCE_FILES[stateName];
  const generated = optimizeRuntimeStatePng(readFileSync(new URL(`assets/${sourceFilename}`, projectRoot)));
  if (!derivative.equals(generated))
    throw new Error(`${filename} is not the deterministic derivative of assets/${sourceFilename}`);
  const statePayload = Buffer.from(JSON.stringify({
    cmd: "state",
    uuid: expectedUuid,
    param: {
      statelist: [{
        uuid: "plugin",
        key: `cell-${stateName}`,
        actionid: `${expectedUuid}.cell-1`,
        type: 1,
        data: createCellImage(state, 0),
        textData: "",
        showtext: false,
      }],
    },
  }));
  if (statePayload.length >= 65_535)
    throw new Error(`${stateName} complete state JSON is ${statePayload.length} bytes`);
}
for (const [display, filename] of Object.entries(NEW_GAME_RUNTIME_FILES)) {
  const derivative = readFileSync(new URL(`assets/${filename}`, pluginRoot));
  const sourceFilename = NEW_GAME_SOURCE_FILES[display];
  const generated = optimizeRuntimeStatePng(readFileSync(new URL(`assets/${sourceFilename}`, projectRoot)));
  if (!derivative.equals(generated))
    throw new Error(`${filename} is not the deterministic derivative of assets/${sourceFilename}`);
  const rendered = createNewGameImage(display);
  if (!Buffer.from(rendered.split(",", 2)[1], "base64").equals(derivative))
    throw new Error(`${display} New Game runtime image differs from assets/${filename}`);
  const statePayload = Buffer.from(JSON.stringify({
    cmd: "state",
    uuid: expectedUuid,
    param: {
      statelist: [{
        uuid: "plugin",
        key: `new-game-${display}`,
        actionid: `${expectedUuid}.new-game`,
        type: 1,
        data: rendered,
        textData: "",
        showtext: false,
      }],
    },
  }));
  if (statePayload.length >= 65_535)
    throw new Error(`${display} complete New Game state JSON is ${statePayload.length} bytes`);
}

function pngDimensions(path) {
  const data = readFileSync(path);
  if (data.toString("ascii", 1, 4) !== "PNG") throw new Error(`${path} is not PNG`);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}
for (const asset of [
  "assets/plugin.png",
  ...Array.from({ length: 9 }, (_, index) => `assets/cell-${index + 1}.png`),
  "assets/new-game-runtime.png",
  "assets/victory-runtime.png",
  "assets/defeat-runtime.png",
  "assets/score.png",
]) {
  const dimensions = pngDimensions(fileURLToPath(new URL(asset, pluginRoot)));
  if (dimensions[0] !== 196 || dimensions[1] !== 196)
    throw new Error(`${asset} must be 196x196`);
}
for (const asset of Object.values(stateFiles)) {
  const dimensions = pngDimensions(fileURLToPath(new URL(`assets/${asset}`, pluginRoot)));
  if (dimensions[0] !== RUNTIME_STATE_DIMENSION || dimensions[1] !== RUNTIME_STATE_DIMENSION)
    throw new Error(`assets/${asset} must be ${RUNTIME_STATE_DIMENSION}x${RUNTIME_STATE_DIMENSION}`);
}
for (const asset of Object.values(NEW_GAME_RUNTIME_FILES)) {
  const dimensions = pngDimensions(fileURLToPath(new URL(`assets/${asset}`, pluginRoot)));
  if (dimensions[0] !== NEW_GAME_RUNTIME_DIMENSION || dimensions[1] !== NEW_GAME_RUNTIME_DIMENSION)
    throw new Error(`assets/${asset} must be ${NEW_GAME_RUNTIME_DIMENSION}x${NEW_GAME_RUNTIME_DIMENSION}`);
}
if (existsSync(new URL("assets/new-game.png", pluginRoot)))
  throw new Error("Obsolete generated replay-arrow asset must not remain in the runnable plugin");
const placementHashes = Array.from({ length: 9 }, (_, index) =>
  createHash("sha256")
    .update(readFileSync(new URL(`assets/cell-${index + 1}.png`, pluginRoot)))
    .digest("hex"),
);
if (new Set(placementHashes).size !== 9)
  throw new Error("Cell placement icons must have distinct image content");
const newGame = manifest.Actions.find((action) => action.UUID === `${expectedUuid}.new-game`);
const inspectorPath = new URL(newGame.PropertyInspectorPath, pluginRoot);
const inspectorHtml = readFileSync(inspectorPath, "utf8");
for (const relativePath of ["inspector.css", "inspector.js", "../lib/host-api.js"]) {
  if (!existsSync(new URL(relativePath, inspectorPath)))
    throw new Error(`Property Inspector dependency is missing: ${relativePath}`);
}
if ((inspectorHtml.match(/<option\b/g) || []).length !== 2)
  throw new Error("New Game Property Inspector must expose exactly two choices");
const cover = pngDimensions(fileURLToPath(new URL(store.cover, projectRoot)));
if (cover[0] / cover[1] !== 2) throw new Error("Store cover must use a 2:1 ratio");
const expectedStorePaths = Object.keys(APPROVED_STORE_ASSETS);
const declaredStorePaths = [store.cover, ...store.screenshots];
if (JSON.stringify(declaredStorePaths) !== JSON.stringify(expectedStorePaths))
  throw new Error("Store gallery must declare the approved cover and both gameplay banners in order");
for (const path of declaredStorePaths) {
  if (!/^resources\/store\/[a-z0-9-]+\.png$/.test(path))
    throw new Error(`Unsafe store artwork path: ${path}`);
}
for (const screenshot of store.screenshots) {
  const [width, height] = pngDimensions(fileURLToPath(new URL(screenshot, projectRoot)));
  if (width / height !== 1.5) throw new Error(`${screenshot} must use a 3:2 ratio`);
}
const expectedPackageBanners = ["assets/banner-1.png", "assets/banner-2.png"];
if (JSON.stringify(manifest.Banner) !== JSON.stringify(expectedPackageBanners))
  throw new Error("Manifest must declare both approved promotional banners");
for (const [index, packagePath] of expectedPackageBanners.entries()) {
  if (!/^assets\/banner-[12]\.png$/.test(packagePath))
    throw new Error(`Unsafe package banner path: ${packagePath}`);
  const storePath = store.screenshots[index];
  if (!readFileSync(new URL(packagePath, pluginRoot)).equals(readFileSync(new URL(storePath, projectRoot))))
    throw new Error(`${packagePath} must match ${storePath}`);
}

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? javascriptFiles(join(directory, entry.name))
      : entry.name.endsWith(".js") || entry.name.endsWith(".mjs")
        ? [join(directory, entry.name)]
        : [],
  );
}
for (const directory of [
  fileURLToPath(new URL("src/", projectRoot)),
  fileURLToPath(new URL("scripts/", projectRoot)),
  fileURLToPath(new URL("test/", projectRoot)),
]) {
  for (const file of javascriptFiles(directory))
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
for (const filename of readdirSync(fileURLToPath(new URL("src/plugin/", projectRoot)))) {
  if (!filename.endsWith(".js")) continue;
  const source = readFileSync(new URL(`src/plugin/${filename}`, projectRoot));
  const distribution = readFileSync(new URL(`dist/${filename}`, pluginRoot));
  if (!source.equals(distribution)) throw new Error(`Source/dist runtime drift: ${filename}`);
}
console.log(`Validated ${manifest.UUID}: preserved source PNGs, deterministic ${RUNTIME_STATE_DIMENSION}px runtime derivatives, sub-65,535-byte state JSON, source/dist identity, 11 D200 actions, unchanged placement setup, and JavaScript syntax.`);
