const PLAYER_MARKS = Object.freeze(["X", "O"]);
const DEFAULT_SETTINGS = Object.freeze({ playerMark: "X" });

function normalizeSettings(value = {}, fallback = DEFAULT_SETTINGS) {
  return {
    playerMark: PLAYER_MARKS.includes(value.playerMark)
      ? value.playerMark
      : fallback.playerMark,
  };
}

module.exports = { DEFAULT_SETTINGS, PLAYER_MARKS, normalizeSettings };
