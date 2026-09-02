const WINNING_LINES = Object.freeze([
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]);

function evaluateBoard(board) {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return {
        status: board[a] === "X" ? "x-won" : "o-won",
        winner: board[a],
        winningLine: [...line],
      };
    }
  }
  return board.every(Boolean)
    ? { status: "draw", winner: null, winningLine: [] }
    : { status: "playing", winner: null, winningLine: [] };
}

class TicTacToeGame {
  constructor({ random = Math.random, optimalRate = 0.75, humanMark = "X" } = {}) {
    this.random = random;
    this.optimalRate = optimalRate;
    this.humanMark = humanMark === "O" ? "O" : "X";
    this.machineMark = this.humanMark === "X" ? "O" : "X";
    this.round = 0;
    this.score = { X: 0, O: 0, draws: 0 };
    this.#resetBoard();
  }

  #resetBoard() {
    this.board = Array(9).fill(null);
    this.startingPlayer = "X";
    this.currentPlayer = this.startingPlayer;
    this.status = "playing";
    this.winner = null;
    this.winningLine = [];
  }

  newGame() {
    this.round += 1;
    this.#resetBoard();
    return this.snapshot();
  }

  setHumanMark(mark) {
    if ((mark !== "X" && mark !== "O") || mark === this.humanMark) return false;
    this.humanMark = mark;
    this.machineMark = mark === "X" ? "O" : "X";
    this.round += 1;
    this.#resetBoard();
    return true;
  }

  playHuman(index) {
    if (
      this.status !== "playing" ||
      this.currentPlayer !== this.humanMark ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > 8 ||
      this.board[index] !== null
    ) {
      return false;
    }
    this.board[index] = this.humanMark;
    this.#finishMove(this.machineMark);
    return true;
  }

  playMachine() {
    if (this.status !== "playing" || this.currentPlayer !== this.machineMark) return false;
    const { chooseMachineMove } = require("./ai.js");
    const move = chooseMachineMove(this.board, {
      random: this.random,
      optimalRate: this.optimalRate,
      machineMark: this.machineMark,
      humanMark: this.humanMark,
    });
    if (move === undefined) return false;
    this.board[move] = this.machineMark;
    this.#finishMove(this.humanMark);
    return true;
  }

  #finishMove(nextPlayer) {
    const result = evaluateBoard(this.board);
    this.status = result.status;
    this.winner = result.winner;
    this.winningLine = result.winningLine;
    if (result.status === "playing") {
      this.currentPlayer = nextPlayer;
      return;
    }
    this.currentPlayer = null;
    if (result.winner) this.score[result.winner] += 1;
    else this.score.draws += 1;
  }

  snapshot() {
    return {
      board: [...this.board],
      currentPlayer: this.currentPlayer,
      startingPlayer: this.startingPlayer,
      status: this.status,
      winner: this.winner,
      winningLine: [...this.winningLine],
      score: { ...this.score },
      humanMark: this.humanMark,
      machineMark: this.machineMark,
      inputLocked:
        this.status !== "playing" || this.currentPlayer !== this.humanMark,
      round: this.round,
    };
  }
}

module.exports = { TicTacToeGame, WINNING_LINES, evaluateBoard };
