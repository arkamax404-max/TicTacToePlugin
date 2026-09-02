import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TicTacToeGame } = require("../src/plugin/game-state.js");
const { PLUGIN_UUID, createController } = require("../src/plugin/main.js");

const callbacks = [];
const cancelled = [];
const updates = [];
const host = {
  decodeContext: (context) => ({ uuid: context.split("___")[0] }),
  setBaseDataIcon: (context) => updates.push(context),
};
const game = new TicTacToeGame({ random: () => 0 });
const controller = createController(host, {
  game,
  schedule: (callback) => {
    callbacks.push(callback);
    return callbacks.length - 1;
  },
  cancel: (timer) => cancelled.push(timer),
});
const cell = `${PLUGIN_UUID}.cell-5___cell___instance-cell-5`;
const start = `${PLUGIN_UUID}.new-game___start___instance-new-game`;
const score = `${PLUGIN_UUID}.score___score___instance-score`;
controller.onAdd({ context: cell, uuid: `${PLUGIN_UUID}.cell-5`, actionid: "instance-cell-5" });
controller.onAdd({ context: start, uuid: `${PLUGIN_UUID}.new-game`, actionid: "instance-new-game", param: { playerMark: "X" } });
controller.onAdd({ context: score, uuid: `${PLUGIN_UUID}.score`, actionid: "instance-score" });

assert.equal(game.snapshot().humanMark, "X");
assert.equal(game.snapshot().currentPlayer, "X");
controller.onRun({ context: cell });
assert.equal(game.snapshot().board[4], "X");
const staleMove = callbacks[0];

controller.onParam({
  context: start,
  uuid: `${PLUGIN_UUID}.new-game`,
  actionid: "instance-new-game",
  param: { playerMark: "O" },
});
assert.deepEqual(cancelled, [0]);
assert.equal(game.snapshot().humanMark, "O");
assert.equal(game.snapshot().currentPlayer, "X");
assert.deepEqual(game.snapshot().board, Array(9).fill(null));

staleMove();
assert.deepEqual(game.snapshot().board, Array(9).fill(null));
callbacks[1]();
assert.equal(game.snapshot().board.filter((mark) => mark === "X").length, 1);
assert.equal(game.snapshot().currentPlayer, "O");

console.log("X mode: human starts and move is broadcast.");
console.log("O mode: machine X starts after the scheduled delay.");
console.log("Symbol change: previous timer cancelled; stale callback made no move.");
console.log(`Broadcasts observed across cell/start/score contexts: ${updates.length}.`);
