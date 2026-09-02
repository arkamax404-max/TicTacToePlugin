import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pluginName = "com.ulanzi.tictactoe.ulanziPlugin";
const pluginPath = fileURLToPath(new URL(`../${pluginName}/`, import.meta.url));
const zipPath = fileURLToPath(new URL(`../${pluginName}/package/${pluginName}.zip`, import.meta.url));
const installPath = process.argv[2];

function collect(directory, root = directory) {
  const files = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (root === pluginPath && entry.name === "package") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, data] of collect(path, root)) files.set(name, data);
    } else {
      files.set(relative(root, path).replaceAll("\\", "/"), readFileSync(path));
    }
  }
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readStoredZip(path) {
  const archive = readFileSync(path);
  const files = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compression = archive.readUInt16LE(offset + 8);
    if (compression !== 0) throw new Error("Delivery verifier expects deterministic stored ZIP entries");
    const expectedCrc = archive.readUInt32LE(offset + 14);
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = archive.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const data = archive.subarray(dataStart, dataStart + size);
    if (data.length !== size || crc32(data) !== expectedCrc)
      throw new Error(`ZIP CRC mismatch: ${name}`);
    if (files.has(name)) throw new Error(`ZIP contains duplicate entry: ${name}`);
    files.set(name, data);
    offset = dataStart + size;
  }
  return files;
}

function assertIdentity(expected, actual, label) {
  if (expected.size !== actual.size)
    throw new Error(`${label} file count differs: ${expected.size} versus ${actual.size}`);
  for (const [name, data] of expected) {
    const candidate = actual.get(name);
    if (!candidate?.equals(data)) throw new Error(`${label} differs at ${name}`);
  }
}

const workspace = collect(pluginPath);
const archiveWithRoot = readStoredZip(zipPath);
if ([...archiveWithRoot.keys()].some((name) => !name.startsWith(`${pluginName}/`)))
  throw new Error("ZIP contains an entry outside the plugin root");
if ([...archiveWithRoot.keys()].some((name) => name.includes("/package/")))
  throw new Error("ZIP recursively contains package output");
const archive = new Map([...archiveWithRoot].map(([name, data]) => [name.slice(pluginName.length + 1), data]));
assertIdentity(workspace, archive, "Workspace/ZIP");

if (installPath) {
  if (!existsSync(installPath)) throw new Error(`Install path is missing: ${installPath}`);
  assertIdentity(workspace, collect(installPath), "Workspace/install");
}

const hash = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
console.log(JSON.stringify({
  archiveRoot: pluginName,
  files: workspace.size,
  packageBytes: readFileSync(zipPath).length,
  packageSha256: hash,
  crcVerified: true,
  recursivePackageContent: false,
  workspaceZipIdentity: true,
  workspaceInstallIdentity: Boolean(installPath),
}, null, 2));
