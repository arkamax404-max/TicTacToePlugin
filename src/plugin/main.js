const { TicTacToeGame } = require("./game-state.js");
const { HostClient } = require("./host-client.js");
const {
  createCellImage,
  createNewGameImage,
  createScoreImage,
} = require("./image-renderer.js");
const { presentGame } = require("./presentation.js");
const { normalizeSettings } = require("./settings.js");

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.tictactoe";
const NEW_GAME_ACTION = `${PLUGIN_UUID}.new-game`;
const SCORE_ACTION = `${PLUGIN_UUID}.score`;
const MACHINE_DELAY_MS = 350;
const OUTCOME_DISPLAY_MS = 2_000;

function actionFor(actionId) {
  const cell = actionId?.match(
    /^com\.ulanzi\.ulanzistudio\.tictactoe\.cell-([1-9])$/,
  );
  if (cell) return { kind: "cell", index: Number(cell[1]) - 1 };
  if (actionId === NEW_GAME_ACTION) return { kind: "new-game" };
  if (actionId === SCORE_ACTION) return { kind: "score" };
  return undefined;
}

function createController(
  host,
  {
    game = new TicTacToeGame(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = (timer) => clearTimeout(timer),
  } = {},
) {
  const contexts = new Map();
  let machineTimer;
  let machineGeneration = 0;
  let outcomeTimer;
  let outcomeGeneration = 0;
  let newGameDisplay = "default";

  function register(message) {
    const actionId = message.uuid || host.decodeContext(message.context).uuid;
    if (!actionFor(actionId)) return false;
    contexts.set(message.context, actionId);
    return true;
  }

  function broadcastNewGame() {
    const image = createNewGameImage(newGameDisplay);
    for (const [context, actionId] of contexts) {
      if (actionFor(actionId)?.kind === "new-game")
        host.setBaseDataIcon(context, image);
    }
  }

  function broadcast() {
    const state = game.snapshot();
    const view = presentGame(state);
    for (const [context, actionId] of contexts) {
      const action = actionFor(actionId);
      if (action.kind === "cell") {
        host.setBaseDataIcon(context, createCellImage(state, action.index));
      } else if (action.kind === "new-game") {
        host.setBaseDataIcon(context, createNewGameImage(newGameDisplay));
      } else {
        host.setBaseDataIcon(context, createScoreImage(view));
      }
    }
  }

  function cancelOutcome() {
    outcomeGeneration += 1;
    if (outcomeTimer !== undefined) cancel(outcomeTimer);
    outcomeTimer = undefined;
    newGameDisplay = "default";
  }

  function broadcastAfterMove() {
    const state = game.snapshot();
    if (state.status === "playing" || state.status === "draw") {
      if (state.status === "draw") cancelOutcome();
      broadcast();
      return;
    }
    cancelOutcome();
    newGameDisplay = state.winner === state.humanMark ? "victory" : "defeat";
    broadcast();
    const generation = outcomeGeneration;
    outcomeTimer = schedule(() => {
      if (generation !== outcomeGeneration) return;
      outcomeTimer = undefined;
      newGameDisplay = "default";
      broadcastNewGame();
    }, OUTCOME_DISPLAY_MS);
  }

  function scheduleMachine() {
    const state = game.snapshot();
    if (
      state.currentPlayer !== state.machineMark ||
      machineTimer !== undefined
    )
      return;
    const generation = machineGeneration;
    machineTimer = schedule(() => {
      if (generation !== machineGeneration) return;
      machineTimer = undefined;
      if (game.playMachine()) broadcastAfterMove();
    }, MACHINE_DELAY_MS);
  }

  function cancelMachine() {
    machineGeneration += 1;
    if (machineTimer !== undefined) cancel(machineTimer);
    machineTimer = undefined;
  }

  function applySettings(message) {
    if (!contexts.has(message.context) && !register(message)) return false;
    if (actionFor(contexts.get(message.context))?.kind !== "new-game") return false;
    const settings = normalizeSettings(message.param, {
      playerMark: game.snapshot().humanMark,
    });
    if (settings.playerMark !== game.snapshot().humanMark) {
      cancelMachine();
      cancelOutcome();
      game.setHumanMark(settings.playerMark);
    } else {
      cancelOutcome();
    }
    broadcast();
    scheduleMachine();
    return true;
  }

  function onAdd(message) {
    if (!register(message)) return;
    if (
      actionFor(contexts.get(message.context)).kind === "new-game" &&
      message.param?.playerMark
    ) {
      applySettings(message);
      return;
    }
    broadcast();
    scheduleMachine();
  }

  function onRun(message) {
    if (!contexts.has(message.context) && !register(message)) return;
    const action = actionFor(contexts.get(message.context));
    if (action.kind === "new-game") {
      cancelMachine();
      cancelOutcome();
      game.newGame();
      broadcast();
      scheduleMachine();
      return;
    }
    if (action.kind === "cell" && game.playHuman(action.index)) {
      broadcastAfterMove();
      scheduleMachine();
    }
  }

  function onClear(message) {
    cancelOutcome();
    for (const item of message.param || []) contexts.delete(item.context);
    broadcastNewGame();
  }

  return {
    broadcast,
    contexts,
    game,
    onAdd,
    onClear,
    onParam: applySettings,
    onRun,
  };
}

function start() {
  const host = new HostClient();
  const controller = createController(host);
  host.connect(PLUGIN_UUID);
  host.on("error", (error) => console.error(`[Ulanzi host] ${error.message}`));
  host.onAdd(controller.onAdd);
  host.onRun(controller.onRun);
  host.onClear(controller.onClear);
  host.onParamFromApp(controller.onParam);
  host.onParamFromPlugin(controller.onParam);
  host.onSetActive(() => controller.broadcast());
  process.once("SIGTERM", () => process.exit(0));
  process.once("SIGINT", () => process.exit(0));
}

if (require.main === module) start();

module.exports = {
  MACHINE_DELAY_MS,
  OUTCOME_DISPLAY_MS,
  PLUGIN_UUID,
  actionFor,
  createController,
  start,
};
