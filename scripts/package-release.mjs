import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withAssetsTreeGuard } from "./assets-tree-guard.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this package orchestrator through npm run package");

withAssetsTreeGuard(root, "package", () => {
  for (const args of [
    ["run", "build"],
    ["run", "check"],
    ["test"],
  ]) execFileSync(process.execPath, [npmCli, ...args], { cwd: root, stdio: "inherit" });

  execFileSync(process.execPath, ["scripts/package.mjs"], { cwd: root, stdio: "inherit" });
});
