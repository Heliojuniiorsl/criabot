import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(root, ".criabot");
const pidFile = path.join(runtimeDir, "panel.pid");
const logFile = path.join(runtimeDir, "panel.log");
const port = process.env.PORT || "3000";
const panelUrl = `http://localhost:${port}`;

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

async function waitForPanel(timeoutMs = 45_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(panelUrl, { cache: "no-store" });
      if (response.ok) return true;
    } catch {
      // O servidor ainda está subindo.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function wakeBots() {
  try {
    const response = await fetch(`${panelUrl}/api/telegram/local-polling/start`, {
      method: "POST",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.log("⚠️ Painel ativo, mas não consegui acordar os bots locais.");
      return;
    }
    console.log(`🤖 ${payload?.message ?? "Bots locais verificados."}`);
  } catch {
    console.log("⚠️ Painel ativo, mas os bots locais não foram acordados.");
  }
}

await mkdir(runtimeDir, { recursive: true });

const currentPid = await readPid();
if (currentPid && isRunning(currentPid)) {
  console.log(`✅ CriaBot já está ligado em ${panelUrl}`);
  await wakeBots();
  process.exit(0);
}

if (await waitForPanel(2_500)) {
  console.log(`✅ CriaBot já está respondendo em ${panelUrl}`);
  console.log("ℹ️ Esse processo não foi iniciado por npm run on; npm run off só desliga processos iniciados por ele.");
  await wakeBots();
  process.exit(0);
}

await appendFile(logFile, `\n\n[${new Date().toISOString()}] npm run on\n`);

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev"], {
  cwd: root,
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    PORT: port,
  },
});

await writeFile(pidFile, String(child.pid), "utf8");
child.unref();

console.log("🚀 Ligando CriaBot...");
const ready = await waitForPanel();

if (!ready) {
  console.log(`⚠️ O processo foi iniciado, mas o painel ainda não respondeu.`);
  console.log(`   Veja o log em: ${logFile}`);
  process.exit(0);
}

console.log(`✅ Painel ligado: ${panelUrl}`);
await wakeBots();
console.log(`📄 Log: ${logFile}`);
