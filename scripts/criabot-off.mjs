import { rm, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(root, ".criabot");
const pidFile = path.join(runtimeDir, "panel.pid");

function isRunning(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid() {
  try {
    return Number((await readFile(pidFile, "utf8")).trim());
  } catch {
    return null;
  }
}

const pid = await readPid();

if (!pid || !isRunning(pid)) {
  await rm(pidFile, { force: true });
  console.log("ℹ️ CriaBot já está desligado ou não foi iniciado por npm run on.");
  process.exit(0);
}

console.log("🛑 Desligando CriaBot...");

if (process.platform === "win32") {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
  });
} else {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Processo já finalizado.
    }
  }
}

await rm(pidFile, { force: true });
console.log("✅ Painel e bots locais desligados.");
