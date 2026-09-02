import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginUuid = "com.ulanzi.ulanzistudio.tictactoe";
const require = createRequire(import.meta.url);
const { TicTacToeGame } = require("../src/plugin/game-state.js");
const { createController } = require("../src/plugin/main.js");
const runtimeFiles = {
  blank: "blank-runtime.png",
  cross: "cross-runtime.png",
  circle: "circle-runtime.png",
  newGame: "new-game-runtime.png",
  victory: "victory-runtime.png",
  defeat: "defeat-runtime.png",
};
const expectedImages = Object.fromEntries(Object.entries(runtimeFiles).map(([name, filename]) => [
  name,
   `data:image/png;base64,${readFileSync(new URL(`../com.ulanzi.tictactoe.ulanziPlugin/assets/${filename}`, import.meta.url)).toString("base64")}`,
]));

function serverFrame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  if (payload.length < 126) return Buffer.concat([Buffer.from([129, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header.set([129, 126]);
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function consumeClientFrames(buffer, messages) {
  while (buffer.length >= 2) {
    const marker = buffer[1] & 0x7f;
    const headerLength = marker < 126 ? 2 : marker === 126 ? 4 : 10;
    if (buffer.length < headerLength + 4) break;
    const length = marker < 126
      ? marker
      : marker === 126 ? buffer.readUInt16BE(2) : Number(buffer.readBigUInt64BE(2));
    if (buffer.length < headerLength + 4 + length) break;
    const mask = buffer.subarray(headerLength, headerLength + 4);
    const encoded = buffer.subarray(headerLength + 4, headerLength + 4 + length);
    const payload = Buffer.from(encoded.map((byte, index) => byte ^ mask[index % 4]));
    messages.push({ data: JSON.parse(payload), length, marker });
    buffer = buffer.subarray(headerLength + 4 + length);
  }
  return buffer;
}

function waitFor(predicate, description, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const result = predicate();
      if (result) {
        clearInterval(timer);
        resolve(result);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${description}`));
      }
    }, 10);
  });
}

const messages = [];
let peer;
let frameBuffer = Buffer.alloc(0);
let handshakeBuffer = Buffer.alloc(0);
const server = createServer((socket) => {
  peer = socket;
  let handshaking = true;
  socket.on("data", (chunk) => {
    if (handshaking) {
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      const end = handshakeBuffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const request = handshakeBuffer.subarray(0, end + 4).toString();
      const key = request.match(/Sec-WebSocket-Key: (.+)\r\n/i)?.[1];
      assert.ok(key);
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      frameBuffer = handshakeBuffer.subarray(end + 4);
      handshaking = false;
    } else {
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
    }
    frameBuffer = consumeClientFrames(frameBuffer, messages);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const child = spawn(process.execPath, [
  fileURLToPath(new URL("../src/plugin/main.js", import.meta.url)),
  "127.0.0.1",
  String(port),
], { stdio: ["ignore", "pipe", "pipe"] });
let childError = "";
child.stderr.on("data", (chunk) => { childError += chunk; });

try {
  await waitFor(() => messages.find((message) => message.data.cmd === "connected"), "plugin connection");
  for (let index = 0; index < 9; index += 1) {
    peer.write(serverFrame({
      cmd: "add",
      cmdType: "REQUEST",
      uuid: `${pluginUuid}.cell-${index + 1}`,
      key: `cell-${index + 1}`,
      actionid: `instance-cell-${index + 1}`,
    }));
  }
  await waitFor(
    () => messages.filter((message) => message.data.cmd === "state").length >= 45,
    "initial blank broadcasts",
  );
  const initialStates = messages.filter((message) => message.data.cmd === "state");
  assert.equal(initialStates.every((message) => message.data.param.statelist[0].data === expectedImages.blank), true);

  messages.length = 0;
  peer.write(serverFrame({
    cmd: "run",
    cmdType: "REQUEST",
    uuid: `${pluginUuid}.cell-1`,
    key: "cell-1",
    actionid: "instance-cell-1",
  }));
  await waitFor(
    () => messages.some((message) => message.data.cmd === "state" && message.data.param.statelist[0].data === expectedImages.cross),
    "cross broadcast after run",
  );
  await waitFor(
    () => messages.some((message) => message.data.cmd === "state" && message.data.param.statelist[0].data === expectedImages.circle),
    "circle broadcast after machine move",
  );

  const stateMessages = messages.filter((message) => message.data.cmd === "state");
  assert.equal(stateMessages.every((message) => message.length < 65_535), true);
  assert.equal(stateMessages.every((message) => message.marker === 126), true);
  assert.equal(messages.some((message) => message.data.cmd === "run" && message.data.code === 0), true);
  const observed = Object.fromEntries(["blank", "cross", "circle"].map((name) => {
    const data = expectedImages[name];
    const message = [...initialStates, ...stateMessages].find((candidate) => candidate.data.param?.statelist?.[0]?.data === data);
    return [name, { payloadBytes: message.length, frameLengthMarker: message.marker }];
  }));
  console.log(JSON.stringify({
    scenario: "WebSocket add nine flattened cell actions, then run cell 1",
    initialBlank: true,
    crossAfterRun: true,
    circleAfterMachineMove: true,
    optimizedStates: observed,
  }, null, 2));
} finally {
  child.kill("SIGTERM");
  peer?.destroy();
  await new Promise((resolve) => server.close(resolve));
}
if (childError) throw new Error(childError);

function runOutcomeScenario({ humanMark, board, currentPlayer, expectedOutcome, machineMoves }) {
  const broadcasts = [];
  const timers = [];
  const game = new TicTacToeGame({ humanMark, random: () => 0 });
  game.board = [...board];
  game.currentPlayer = currentPlayer;
  const controller = createController({
    decodeContext: (context) => ({ uuid: context.split("___")[0] }),
    setBaseDataIcon: (context, data) => broadcasts.push({ context, data }),
  }, {
    game,
    schedule: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length - 1;
    },
    cancel: () => {},
  });
  const cell = `${pluginUuid}.cell-3___cell-3___mock-cell-3`;
  const starts = [1, 2].map((index) =>
    `${pluginUuid}.new-game___new-game-${index}___mock-new-game-${index}`,
  );
  controller.onAdd({ context: cell, uuid: `${pluginUuid}.cell-3` });
  for (const context of starts)
    controller.onAdd({ context, uuid: `${pluginUuid}.new-game` });
  broadcasts.length = 0;

  if (machineMoves) timers[0].callback();
  else controller.onRun({ context: cell });
  const outcomeTimer = timers.find((timer) => timer.delay === 2_000);
  assert.ok(outcomeTimer);
  const outcomeBroadcasts = broadcasts.filter((item) => starts.includes(item.context));
  assert.deepEqual(outcomeBroadcasts.map((item) => item.data), [
    expectedImages[expectedOutcome],
    expectedImages[expectedOutcome],
  ]);
  outcomeTimer.callback();
  const restored = broadcasts.filter((item) => starts.includes(item.context)).slice(-2);
  assert.deepEqual(restored.map((item) => item.data), [expectedImages.newGame, expectedImages.newGame]);
  return {
    outcome: expectedOutcome,
    perspective: `human ${humanMark}`,
    temporaryBroadcasts: outcomeBroadcasts.length,
    visibilityMs: outcomeTimer.delay,
    restoreBroadcasts: restored.length,
  };
}

const outcomeScenarios = [
  runOutcomeScenario({
    humanMark: "X",
    board: ["X", "X", null, "O", "O", null, null, null, null],
    currentPlayer: "X",
    expectedOutcome: "victory",
    machineMoves: false,
  }),
  runOutcomeScenario({
    humanMark: "O",
    board: ["X", "X", null, "O", "O", null, null, null, null],
    currentPlayer: "X",
    expectedOutcome: "defeat",
    machineMoves: true,
  }),
];
console.log(JSON.stringify({ outcomeScenarios }, null, 2));
