const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const test = require("node:test");

const { chooseMachineMove } = require("../src/plugin/ai.js");
const { TicTacToeGame, evaluateBoard } = require("../src/plugin/game-state.js");
const {
  CELL_STATE_FILES,
  NEW_GAME_IMAGE_FILES,
  createCellImage,
  createNewGameImage,
  createScoreImage,
  imageFileForCell,
} = require("../src/plugin/image-renderer.js");
const { HostClient } = require("../src/plugin/host-client.js");
const {
  PLUGIN_UUID,
  OUTCOME_DISPLAY_MS,
  actionFor,
  createController,
} = require("../src/plugin/main.js");
const { presentGame } = require("../src/plugin/presentation.js");
const { normalizeSettings } = require("../src/plugin/settings.js");

test("detects wins and draws with the winning line", () => {
  assert.deepEqual(evaluateBoard(["X", "X", "X", null, "O", null, "O", null, null]), {
    status: "x-won",
    winner: "X",
    winningLine: [0, 1, 2],
  });
  assert.equal(evaluateBoard(["X", "O", "X", "X", "O", "O", "O", "X", "X"]).status, "draw");
});

test("X player starts every fresh round and keeps the session score", () => {
  const game = new TicTacToeGame({ random: () => 0 });
  assert.equal(game.snapshot().humanMark, "X");
  assert.equal(game.snapshot().machineMark, "O");
  assert.equal(game.snapshot().startingPlayer, "X");
  game.score.X = 2;
  game.newGame();
  assert.equal(game.snapshot().startingPlayer, "X");
  assert.equal(game.snapshot().currentPlayer, "X");
  assert.equal(game.snapshot().score.X, 2);
});

test("O player gets a machine-X opening move and then the human turn", () => {
  const game = new TicTacToeGame({ humanMark: "O", random: () => 0 });
  assert.equal(game.snapshot().currentPlayer, "X");
  assert.equal(game.snapshot().machineMark, "X");
  assert.equal(game.playHuman(4), false);
  assert.equal(game.playMachine(), true);
  assert.equal(game.snapshot().board.filter((cell) => cell === "X").length, 1);
  assert.equal(game.snapshot().currentPlayer, "O");
  assert.equal(game.playHuman(4), true);
});

test("changing symbol starts a fresh round without resetting score", () => {
  const game = new TicTacToeGame({ random: () => 0 });
  game.score = { X: 2, O: 3, draws: 4 };
  game.playHuman(0);
  assert.equal(game.setHumanMark("O"), true);
  assert.deepEqual(game.snapshot().board, Array(9).fill(null));
  assert.deepEqual(game.snapshot().score, { X: 2, O: 3, draws: 4 });
  assert.equal(game.snapshot().currentPlayer, "X");
  assert.equal(game.setHumanMark("O"), false);
});

test("ignores invalid, occupied, locked, and post-game human moves", () => {
  const game = new TicTacToeGame({ random: () => 0 });
  assert.equal(game.playHuman(-1), false);
  assert.equal(game.playHuman(0), true);
  assert.equal(game.playHuman(1), false);
  assert.equal(game.playMachine(), true);
  assert.equal(game.playHuman(0), false);

  const finished = new TicTacToeGame({ random: () => 0 });
  finished.board = ["X", "X", null, "O", "O", null, null, null, null];
  finished.currentPlayer = "X";
  assert.equal(finished.playHuman(2), true);
  assert.equal(finished.snapshot().status, "x-won");
  assert.equal(finished.snapshot().score.X, 1);
  assert.equal(finished.playHuman(8), false);
});

test("optimal AI takes a win and blocks an immediate loss", () => {
  assert.equal(chooseMachineMove(["O", "O", null, "X", "X", null, null, null, null], { random: () => 0 }), 2);
  assert.equal(chooseMachineMove(["X", "X", null, null, "O", null, null, null, null], { random: () => 0 }), 2);
});

test("machine-X minimax takes wins, blocks losses, and returns legal moves", () => {
  assert.equal(
    chooseMachineMove(["X", "X", null, "O", "O", null, null, null, null], {
      random: () => 0,
      machineMark: "X",
      humanMark: "O",
    }),
    2,
  );
  assert.equal(
    chooseMachineMove(["O", "O", null, null, "X", null, null, null, null], {
      random: () => 0,
      machineMark: "X",
      humanMark: "O",
    }),
    2,
  );
  const board = ["O", "X", "O", "X", null, null, null, "O", "X"];
  assert.ok([4, 5, 6].includes(chooseMachineMove(board, {
    random: () => 0,
    machineMark: "X",
    humanMark: "O",
  })));
});

test("AI uses the random legal branch when the probability falls outside 75 percent", () => {
  const values = [0.9, 0.6];
  const move = chooseMachineMove(["X", null, "O", null, null, null, null, null, null], {
    random: () => values.shift(),
  });
  assert.equal(move, 6);
});

function pngDimensions(data) {
  assert.equal(data.toString("ascii", 1, 4), "PNG");
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test("maps every New Game display to its optimized supplied PNG", () => {
  const pluginAssets = resolve(__dirname, "../com.ulanzi.tictactoe.ulanziPlugin/assets");
  assert.deepEqual(NEW_GAME_IMAGE_FILES, {
    default: "new-game-runtime.png",
    victory: "victory-runtime.png",
    defeat: "defeat-runtime.png",
    draw: "draw-runtime.png",
  });
  for (const [display, filename] of Object.entries(NEW_GAME_IMAGE_FILES)) {
    const derivative = readFileSync(join(pluginAssets, filename));
    assert.deepEqual(pngDimensions(derivative), [196, 196]);
    assert.equal(
      createHash("sha256").update(Buffer.from(createNewGameImage(display).split(",", 2)[1], "base64")).digest("hex"),
      createHash("sha256").update(derivative).digest("hex"),
    );
  }
  assert.equal(existsSync(join(pluginAssets, "new-game.png")), false);
});

function decodeClientFrame(frame) {
  const size = frame[1] & 0x7f;
  const headerLength = size < 126 ? 2 : size === 126 ? 4 : 10;
  const payloadLength = size < 126
    ? size
    : size === 126 ? frame.readUInt16BE(2) : Number(frame.readBigUInt64BE(2));
  const mask = frame.subarray(headerLength, headerLength + 4);
  const encoded = frame.subarray(headerLength + 4);
  assert.equal(encoded.length, payloadLength);
  return Buffer.from(encoded.map((byte, index) => byte ^ mask[index % 4]));
}

test("preserves the user-supplied source artwork outside the runnable package", () => {
  const sourceRoot = resolve(__dirname, "../assets");
  const pluginAssets = resolve(__dirname, "../com.ulanzi.tictactoe.ulanziPlugin/assets");
  const expected = {
    "blank.png": "23461db6ccef6f1add01b6ad56a5333b766ced4df72a67896ea40901d7d1206d",
    "cross.png": "9b5140fa6b828ab3f8a9af3caab9382d677af531e7e9cb96e9a008855b0e81f8",
    "circle.png": "9bfed5e2817f77744c2f8921c234edbab05effa2bba46432cb6d80575a9193d7",
    "new-game-source.png": "46b70a1ea44c5345fda1ffe87e0b616e6852a537354bade63bdb35c7138859b3",
    "victory-source.png": "e0eed7d9e693c867127b61109ef607bad482ef7644af0569d7beeef31811d59c",
    "defeat-source.png": "5d7bfba13d86167566c0533337fb59dd5c50323bffb08b958fad5d68ce03f1fe",
    "draw-source.png": "86fc56a275168a98fde6ccaf51f2edce24bd2aa5b79a798e8f889462a24ea17f",
  };
  for (const [filename, hash] of Object.entries(expected)) {
    const source = readFileSync(join(sourceRoot, filename));
    assert.deepEqual(pngDimensions(source), [1254, 1254]);
    assert.equal(createHash("sha256").update(source).digest("hex"), hash);
    assert.equal(existsSync(join(pluginAssets, filename)), false);
  }
});

test("maps empty, X, and O cells to optimized runtime derivatives, including wins", () => {
  const game = new TicTacToeGame({ random: () => 0 });
  game.board = ["X", "X", null, "O", "O", null, null, null, null];
  game.currentPlayer = "X";
  game.playHuman(2);
  const state = game.snapshot();
  assert.deepEqual(state.board.slice(0, 3), ["X", "X", "X"]);
  assert.deepEqual(state.winningLine, [0, 1, 2]);
  const pluginAssets = resolve(__dirname, "../com.ulanzi.tictactoe.ulanziPlugin/assets");
  const cases = [
    { mark: null, filename: "blank-runtime.png" },
    { mark: "X", filename: "cross-runtime.png" },
    { mark: "O", filename: "circle-runtime.png" },
  ];
  assert.deepEqual(CELL_STATE_FILES, {
    empty: "blank-runtime.png",
    X: "cross-runtime.png",
    O: "circle-runtime.png",
  });
  for (const { mark, filename } of cases) {
    const cellState = { ...state, board: [mark], winningLine: mark ? [0] : [] };
    assert.equal(imageFileForCell(cellState, 0), filename);
    const rendered = Buffer.from(createCellImage(cellState, 0).split(",", 2)[1], "base64");
    const derivative = readFileSync(join(pluginAssets, filename));
    assert.deepEqual(pngDimensions(derivative), [196, 196]);
    assert.equal(createHash("sha256").update(rendered).digest("hex"), createHash("sha256").update(derivative).digest("hex"));
  }
  assert.equal(createCellImage(state, 1), createCellImage({ ...state, winningLine: [] }, 1));
});

test("renders cells and New Game as PNG data URIs and score as SVG", () => {
  const state = new TicTacToeGame().snapshot();
  const view = presentGame(state);
  assert.match(createCellImage(state, 0), /^data:image\/png;base64,/);
  assert.match(createNewGameImage(), /^data:image\/png;base64,/);
  assert.match(createScoreImage(view), /^data:image\/svg\+xml;base64,/);
});

test("accepts flattened direct nonnumeric cell suffixes and rejects nested numeric identities", () => {
  assert.deepEqual(actionFor(`${PLUGIN_UUID}.cell-9`), { kind: "cell", index: 8 });
  assert.deepEqual(actionFor(`${PLUGIN_UUID}.new-game`), { kind: "new-game" });
  assert.deepEqual(actionFor(`${PLUGIN_UUID}.score`), { kind: "score" });
  assert.equal(actionFor(`${PLUGIN_UUID}.cell.0`), undefined);
  assert.equal(actionFor(`${PLUGIN_UUID}.cell-0`), undefined);
  assert.equal(actionFor(`${PLUGIN_UUID}.cell-10`), undefined);
});

test("dispatches all nine flattened cell actions to complete row-major board indices", () => {
  for (let position = 1; position <= 9; position += 1) {
    assert.deepEqual(actionFor(`${PLUGIN_UUID}.cell-${position}`), {
      kind: "cell",
      index: position - 1,
    });
  }
});

test("frames short messages and all runtime PNG states with short or 16-bit lengths", () => {
  const frames = [];
  const host = new HostClient();
  host.uuid = PLUGIN_UUID;
  host.socket = { writable: true, write: (frame) => frames.push(frame) };
  host.send("ok", { code: 0 });
  assert.equal((frames[0][1] & 0x7f) < 126, true);
  for (const mark of [null, "X", "O"]) {
    const state = { ...new TicTacToeGame().snapshot(), board: [mark] };
    host.setBaseDataIcon(`${PLUGIN_UUID}.cell-1___cell___instance-cell-1`, createCellImage(state, 0));
    const frame = frames.at(-1);
    assert.equal(frame[1] & 0x7f, 126);
    const payload = decodeClientFrame(frame);
    assert.equal(payload.length < 65_535, true);
    assert.equal(JSON.parse(payload).cmd, "state");
  }
  for (const display of ["default", "victory", "defeat", "draw"]) {
    host.setBaseDataIcon(`${PLUGIN_UUID}.new-game___new-game___instance-new-game`, createNewGameImage(display));
    const frame = frames.at(-1);
    assert.equal(frame[1] & 0x7f, 126);
    const payload = decodeClientFrame(frame);
    assert.equal(payload.length < 65_535, true);
    assert.equal(JSON.parse(payload).cmd, "state");
  }
});

test("retains 64-bit WebSocket framing for non-runtime oversized messages", () => {
  const frames = [];
  const host = new HostClient();
  host.uuid = PLUGIN_UUID;
  host.socket = { writable: true, write: (frame) => frames.push(frame) };
  host.send("synthetic", { data: "x".repeat(65_536) });
  assert.equal(frames[0][1] & 0x7f, 127);
  assert.equal(Number(frames[0].readBigUInt64BE(2)), decodeClientFrame(frames[0]).length);
});

test("normalizes only supported player settings", () => {
  assert.deepEqual(normalizeSettings({ playerMark: "O" }), { playerMark: "O" });
  assert.deepEqual(normalizeSettings({ playerMark: "circle" }), { playerMark: "X" });
  assert.deepEqual(
    normalizeSettings({}, { playerMark: "O" }),
    { playerMark: "O" },
  );
});

test("broadcasts one game state to every registered context and delays O", () => {
  const images = [];
  const callbacks = [];
  const host = {
    decodeContext: (context) => ({ uuid: context.split("___")[0] }),
    setBaseDataIcon: (context, data) => images.push({ context, data }),
  };
  const game = new TicTacToeGame({ random: () => 0 });
  const controller = createController(host, {
    game,
    schedule: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel: () => {},
  });
  const cell = `${PLUGIN_UUID}.cell-1___key-1___instance-cell-1`;
  const score = `${PLUGIN_UUID}.score___key-2___instance-score`;
  controller.onAdd({ context: cell, uuid: `${PLUGIN_UUID}.cell-1`, actionid: "instance-cell-1" });
  controller.onAdd({ context: score, uuid: `${PLUGIN_UUID}.score`, actionid: "instance-score" });
  images.length = 0;
  controller.onRun({ context: cell });
  assert.equal(game.snapshot().currentPlayer, "O");
  assert.equal(game.playHuman(1), false);
  assert.equal(images.length, 2);
  callbacks.shift()();
  assert.equal(game.snapshot().currentPlayer, "X");
  assert.equal(images.length, 4);
});

test("parameter changes broadcast globally, preserve score, and cancel stale moves", () => {
  const images = [];
  const callbacks = [];
  const cancelled = [];
  const host = {
    decodeContext: (context) => ({ uuid: context.split("___")[0] }),
    setBaseDataIcon: (context, data) => images.push({ context, data }),
  };
  const game = new TicTacToeGame({ random: () => 0 });
  game.score = { X: 2, O: 1, draws: 3 };
  const controller = createController(host, {
    game,
    schedule: (callback) => {
      callbacks.push(callback);
      return callbacks.length - 1;
    },
    cancel: (timer) => cancelled.push(timer),
  });
  const cell = `${PLUGIN_UUID}.cell-1___key-1___instance-cell-1`;
  const start = `${PLUGIN_UUID}.new-game___key-2___instance-new-game`;
  const score = `${PLUGIN_UUID}.score___key-3___instance-score`;
  controller.onAdd({ context: cell, uuid: `${PLUGIN_UUID}.cell-1`, actionid: "instance-cell-1" });
  controller.onAdd({ context: start, uuid: `${PLUGIN_UUID}.new-game`, actionid: "instance-new-game" });
  controller.onAdd({ context: score, uuid: `${PLUGIN_UUID}.score`, actionid: "instance-score" });

  controller.onRun({ context: cell });
  const staleMachineMove = callbacks[0];
  images.length = 0;
  assert.equal(
    controller.onParam({
      context: start,
      uuid: `${PLUGIN_UUID}.new-game`,
      actionid: "instance-new-game",
      param: { playerMark: "O" },
    }),
    true,
  );
  assert.deepEqual(cancelled, [0]);
  assert.equal(images.length, 3);
  assert.deepEqual(game.snapshot().score, { X: 2, O: 1, draws: 3 });
  assert.deepEqual(game.snapshot().board, Array(9).fill(null));
  assert.equal(game.snapshot().humanMark, "O");

  staleMachineMove();
  assert.deepEqual(game.snapshot().board, Array(9).fill(null));
  callbacks[1]();
  assert.equal(game.snapshot().board.filter((mark) => mark === "X").length, 1);
  assert.equal(images.length, 6);

  images.length = 0;
  controller.onRun({ context: start });
  assert.equal(game.snapshot().humanMark, "O");
  assert.equal(game.snapshot().currentPlayer, "X");
  assert.deepEqual(game.snapshot().score, { X: 2, O: 1, draws: 3 });
  assert.equal(images.length, 3);
});

function outcomeHarness({ humanMark = "X", board, currentPlayer = humanMark } = {}) {
  const images = [];
  const timers = [];
  const cancelled = [];
  let now = 0;
  const host = {
    decodeContext: (context) => ({ uuid: context.split("___")[0] }),
    setBaseDataIcon: (context, data) => images.push({ context, data }),
  };
  const game = new TicTacToeGame({ humanMark, random: () => 0 });
  if (board) game.board = [...board];
  game.currentPlayer = currentPlayer;
  const controller = createController(host, {
    game,
    schedule: (callback, delay) => {
      timers.push({ callback, delay, due: now + delay, cancelled: false, fired: false });
      return timers.length - 1;
    },
    cancel: (timer) => {
      timers[timer].cancelled = true;
      cancelled.push(timer);
    },
  });
  const cell = `${PLUGIN_UUID}.cell-3___cell-3___instance-cell-3`;
  const starts = [1, 2].map((index) =>
    `${PLUGIN_UUID}.new-game___start-${index}___instance-new-game-${index}`,
  );
  controller.onAdd({ context: cell, uuid: `${PLUGIN_UUID}.cell-3` });
  for (const context of starts)
    controller.onAdd({ context, uuid: `${PLUGIN_UUID}.new-game` });
  images.length = 0;
  function advanceBy(milliseconds) {
    now += milliseconds;
    for (const timer of timers) {
      if (!timer.cancelled && !timer.fired && timer.due <= now) {
        timer.fired = true;
        timer.callback();
      }
    }
  }
  return { advanceBy, cancelled, cell, controller, game, images, starts, timers };
}

function imagesForContexts(images, contexts) {
  return images.filter((item) => contexts.includes(item.context)).map((item) => item.data);
}

test("shows human victory on every New Game context for exactly 5,000 ms", () => {
  const harness = outcomeHarness({
    board: ["X", "X", null, "O", "O", null, null, null, null],
  });
  harness.controller.onRun({ context: harness.cell });
  assert.equal(harness.game.snapshot().status, "x-won");
  assert.equal(harness.game.snapshot().score.X, 1);
  assert.deepEqual(
    imagesForContexts(harness.images, harness.starts),
    [createNewGameImage("victory"), createNewGameImage("victory")],
  );
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].delay, OUTCOME_DISPLAY_MS);
  assert.equal(OUTCOME_DISPLAY_MS, 5_000);

  harness.advanceBy(4_999);
  assert.deepEqual(
    imagesForContexts(harness.images, harness.starts).slice(-2),
    [createNewGameImage("victory"), createNewGameImage("victory")],
  );
  harness.advanceBy(1);
  assert.deepEqual(
    imagesForContexts(harness.images, harness.starts).slice(-2),
    [createNewGameImage(), createNewGameImage()],
  );
  assert.equal(harness.game.snapshot().status, "x-won");
  assert.equal(harness.game.playHuman(8), false);
});

test("maps human O victory to Victory and machine X victory to Defeat", () => {
  const humanWin = outcomeHarness({
    humanMark: "O",
    board: ["O", "O", null, "X", "X", null, null, null, null],
    currentPlayer: "O",
  });
  humanWin.controller.onRun({ context: humanWin.cell });
  assert.equal(humanWin.game.snapshot().winner, "O");
  assert.deepEqual(
    imagesForContexts(humanWin.images, humanWin.starts),
    [createNewGameImage("victory"), createNewGameImage("victory")],
  );

  const machineWin = outcomeHarness({
    humanMark: "O",
    board: ["X", "X", null, "O", "O", null, null, null, null],
    currentPlayer: "X",
  });
  assert.equal(machineWin.timers[0].delay, 350);
  machineWin.timers[0].callback();
  assert.equal(machineWin.game.snapshot().winner, "X");
  assert.equal(machineWin.game.snapshot().score.X, 1);
  assert.deepEqual(
    imagesForContexts(machineWin.images, machineWin.starts),
    [createNewGameImage("defeat"), createNewGameImage("defeat")],
  );
  assert.equal(machineWin.timers[1].delay, OUTCOME_DISPLAY_MS);
});

test("shows Draw on every New Game context for exactly 5,000 ms", () => {
  const harness = outcomeHarness({
    board: ["X", "O", "X", "X", "O", "O", "O", "X", null],
  });
  const finalCell = `${PLUGIN_UUID}.cell-9___cell-9___instance-cell-9`;
  harness.controller.onAdd({ context: finalCell, uuid: `${PLUGIN_UUID}.cell-9` });
  harness.images.length = 0;
  harness.controller.onRun({ context: finalCell });
  assert.equal(harness.game.snapshot().status, "draw");
  assert.equal(harness.game.snapshot().score.draws, 1);
  assert.deepEqual(
    imagesForContexts(harness.images, harness.starts),
    [createNewGameImage("draw"), createNewGameImage("draw")],
  );
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0].delay, OUTCOME_DISPLAY_MS);
  harness.advanceBy(4_999);
  assert.deepEqual(
    imagesForContexts(harness.images, harness.starts).slice(-2),
    [createNewGameImage("draw"), createNewGameImage("draw")],
  );
  harness.advanceBy(1);
  assert.deepEqual(
    imagesForContexts(harness.images, harness.starts).slice(-2),
    [createNewGameImage(), createNewGameImage()],
  );
  assert.equal(harness.game.snapshot().status, "draw");
});

test("New Game, settings, and clear cancel stale outcome restorations", async (t) => {
  async function verifyCancellation(trigger, expectedRemainingContexts = 2) {
    const harness = outcomeHarness({
      board: ["X", "X", null, "O", "O", null, null, null, null],
    });
    harness.controller.onRun({ context: harness.cell });
    const staleRestore = harness.timers[0].callback;
    harness.images.length = 0;
    trigger(harness);
    const countAfterCancellation = harness.images.length;
    assert.equal(harness.cancelled.includes(0), true);
    assert.deepEqual(
      imagesForContexts(harness.images, harness.starts).slice(-expectedRemainingContexts),
      Array(expectedRemainingContexts).fill(createNewGameImage()),
    );
    staleRestore();
    assert.equal(harness.images.length, countAfterCancellation);
  }

  await t.test("New Game", () => verifyCancellation((harness) => {
    harness.controller.onRun({ context: harness.starts[0] });
    assert.equal(harness.game.snapshot().status, "playing");
    assert.deepEqual(harness.game.snapshot().board, Array(9).fill(null));
  }));
  await t.test("settings", () => verifyCancellation((harness) => {
    harness.controller.onParam({
      context: harness.starts[0],
      param: { playerMark: "O" },
    });
  }));
  await t.test("clear", () => verifyCancellation((harness) => {
    harness.controller.onClear({ param: [{ context: harness.starts[0] }] });
  }, 1));
});

test("manifest exposes valid distinct icons and a two-choice New Game inspector", () => {
  const pluginRoot = resolve(__dirname, "../com.ulanzi.tictactoe.ulanziPlugin");
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "manifest.json"), "utf8"));
  const cells = manifest.Actions.slice(0, 9);
  assert.deepEqual(
    cells.map((action) => action.UUID),
    Array.from({ length: 9 }, (_, index) => `${PLUGIN_UUID}.cell-${index + 1}`),
  );
  assert.equal(new Set(cells.map((action) => action.Icon)).size, 9);
  cells.forEach((action, index) =>
    assert.equal(action.Icon, `assets/cell-${index + 1}.png`),
  );
  const newGame = manifest.Actions.find((action) => action.UUID === `${PLUGIN_UUID}.new-game`);
  const inspector = join(pluginRoot, newGame.PropertyInspectorPath);
  assert.equal(existsSync(inspector), true);
  const html = readFileSync(inspector, "utf8");
  assert.equal((html.match(/<option\b/g) || []).length, 2);
  assert.match(html, /value="X">X \/ crosses/);
  assert.match(html, /value="O">O \/ circles/);
  for (const dependency of ["inspector.css", "inspector.js", "../lib/host-api.js"])
    assert.equal(existsSync(resolve(dirname(inspector), dependency)), true);
});

test("clear unregisters contexts", () => {
  const host = {
    decodeContext: () => ({ uuid: `${PLUGIN_UUID}.score` }),
    setBaseDataIcon: () => {},
  };
  const controller = createController(host);
  controller.onAdd({ context: "score", uuid: `${PLUGIN_UUID}.score`, actionid: "instance-score" });
  controller.onClear({ param: [{ context: "score" }] });
  assert.equal(controller.contexts.size, 0);
});
