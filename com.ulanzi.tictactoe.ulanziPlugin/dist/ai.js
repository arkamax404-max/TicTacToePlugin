const { evaluateBoard } = require("./game-state.js");

function legalMoves(board) {
  return board.flatMap((cell, index) => (cell === null ? [index] : []));
}

function chooseMachineMove(
  board,
  {
    random = Math.random,
    optimalRate = 0.75,
    machineMark = "O",
    humanMark = machineMark === "X" ? "O" : "X",
  } = {},
) {
  const moves = legalMoves(board);
  if (!moves.length) return undefined;
  if (random() >= optimalRate) {
    return moves[Math.min(moves.length - 1, Math.floor(random() * moves.length))];
  }

  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    board[move] = machineMark;
    const score = minimax(board, 0, false, machineMark, humanMark);
    board[move] = null;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function minimax(board, depth, maximizing, machineMark, humanMark) {
  const result = evaluateBoard(board);
  if (result.winner === machineMark) return 10 - depth;
  if (result.winner === humanMark) return depth - 10;
  if (result.status === "draw") return 0;

  let score = maximizing ? -Infinity : Infinity;
  for (const move of legalMoves(board)) {
    board[move] = maximizing ? machineMark : humanMark;
    const candidate = minimax(
      board,
      depth + 1,
      !maximizing,
      machineMark,
      humanMark,
    );
    board[move] = null;
    score = maximizing ? Math.max(score, candidate) : Math.min(score, candidate);
  }
  return score;
}

module.exports = { chooseMachineMove, legalMoves };
