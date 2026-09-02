import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";

function hash(data) {
  return createHash("sha256").update(data).digest("hex");
}

function attributes(path, metadata) {
  if (process.platform !== "win32") return metadata.mode.toString(8);
  const literalPath = path.replaceAll("'", "''");
  return execFileSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `[int](Get-Item -Force -LiteralPath '${literalPath}').Attributes`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

function inventory(root, path, entries) {
  const metadata = lstatSync(path, { bigint: true });
  const relativePath = relative(root, path).replaceAll("\\", "/") || ".";
  const type = metadata.isDirectory()
    ? "directory"
    : metadata.isFile()
      ? "file"
      : metadata.isSymbolicLink()
        ? "symbolic-link"
        : "other";
  const content = metadata.isFile()
    ? readFileSync(path)
    : metadata.isSymbolicLink()
      ? Buffer.from(readlinkSync(path))
      : null;

  entries.push(Object.freeze({
    path: relativePath,
    type,
    size: metadata.isDirectory() ? null : metadata.size.toString(),
    sha256: content ? hash(content) : null,
    lastWriteTimeNanoseconds: metadata.mtimeNs.toString(),
    attributes: attributes(path, metadata),
  }));

  if (metadata.isDirectory()) {
    for (const name of readdirSync(path).sort((left, right) => left.localeCompare(right)))
      inventory(root, join(path, name), entries);
  }
}

export function snapshotAssetsTree(projectRoot) {
  const assetsRoot = resolve(projectRoot, "assets");
  const entries = [];
  inventory(assetsRoot, assetsRoot, entries);
  return Object.freeze(entries);
}

export function assertAssetsTreeUnchanged(before, after, command) {
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(`${command} changed the immutable assets tree`);
}

export function withAssetsTreeGuard(projectRoot, command, operation) {
  const before = snapshotAssetsTree(projectRoot);
  let result;
  let operationError;
  try {
    result = operation();
  } catch (error) {
    operationError = error;
  }

  const after = snapshotAssetsTree(projectRoot);
  assertAssetsTreeUnchanged(before, after, command);
  if (operationError) throw operationError;
  return result;
}
