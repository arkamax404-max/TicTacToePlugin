const ACTION_UUID = "com.ulanzi.ulanzistudio.tictactoe.new-game";
const form = document.querySelector("#settings");
const status = document.querySelector("#status");
let settings = { playerMark: "X" };

$UD.on("connected", () => {
  status.textContent = "The symbol is stored with this key.";
});
for (const event of ["add", "paramfromapp", "didReceiveSettings"]) {
  $UD.on(event, (message) => {
    const incoming = message.param || message.settings;
    if (!incoming || (incoming.playerMark !== "X" && incoming.playerMark !== "O"))
      return;
    settings = { ...settings, playerMark: incoming.playerMark };
    form.elements.playerMark.value = settings.playerMark;
  });
}
form.addEventListener("change", () => {
  settings = { playerMark: form.elements.playerMark.value };
  $UD.sendParamFromPlugin(settings);
  status.textContent = "Saved. A fresh round has started.";
});

$UD.connect(ACTION_UUID);
