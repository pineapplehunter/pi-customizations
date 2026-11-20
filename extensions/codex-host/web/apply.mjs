// Patch only the exact reviewed npm artifact, in an explicitly supplied prefix.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const version = "0.48.0";
const original = "825dff2ba25684d767d54285ac71ed0838490d8f84862527377476741dd9363f";
const patched = "043a5f6cb8e0231464716cf96a6ea08e429d2f12c81b844c4864bcedf8773c5b";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

try {
  if (process.argv.length !== 3) throw new Error("Usage: node apply.mjs /path/to/installed/pi-web-access");
  const dir = process.argv[2];
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (manifest.name !== "pi-web-access" || manifest.version !== version) throw new Error(`Expected pi-web-access ${version}.`);
  const bundle = join(dir, "dist", "index.js");
  const digest = hash(readFileSync(bundle));
  if (digest === patched) console.log("pi-web-access already patched.");
  else {
    if (digest !== original) throw new Error("Unrecognized pi-web-access bundle; refusing to patch.");
    const diff = fileURLToPath(new URL(`./pi-web-access-${version}.patch`, import.meta.url));
    const result = spawnSync("patch", ["--batch", "--fuzz=0", "--silent", "--output=-", bundle, diff], { maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0 || hash(result.stdout) !== patched) throw new Error("Could not apply verified patch (GNU patch required).");
    const temp = `${bundle}.${randomUUID()}`;
    try {
      writeFileSync(temp, result.stdout, { mode: statSync(bundle).mode & 0o777, flag: "wx" });
      renameSync(temp, bundle);
    } finally { rmSync(temp, { force: true }); }
    console.log(`Patched pi-web-access ${version} for host Codex search.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
