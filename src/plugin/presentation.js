function presentGame(state) {
  return {
    score: {
      X: state.score.X,
      O: state.score.O,
      draws: state.score.draws,
    },
  };
}

module.exports = { presentGame };
