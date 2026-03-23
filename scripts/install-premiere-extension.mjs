import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const extensionId = "com.soragenie.panel";
const bundleDir = path.join(rootDir, "dist", "cep", extensionId);

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function enableCepDebugMode() {
  if (process.platform !== "win32") {
    return;
  }

  for (const csxsVersion of [8, 9, 10, 11, 12, 13]) {
    const key = `HKCU\\Software\\Adobe\\CSXS.${csxsVersion}`;

    try {
      execFileSync(
        "reg",
        ["add", key, "/v", "PlayerDebugMode", "/t", "REG_SZ", "/d", "1", "/f"],
        { stdio: "ignore" },
      );
    } catch (error) {
      console.warn(`Could not enable PlayerDebugMode for ${key}:`, error.message);
    }
  }
}

if (!(await pathExists(bundleDir))) {
  throw new Error(`CEP bundle not found at ${bundleDir}. Run "npm run build:cep" first.`);
}

if (process.platform !== "win32") {
  throw new Error("This installer currently supports Windows only.");
}

const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const extensionsRoot = path.join(appData, "Adobe", "CEP", "extensions");
const targetDir = path.join(extensionsRoot, extensionId);

enableCepDebugMode();

await mkdir(extensionsRoot, { recursive: true });
await rm(targetDir, { recursive: true, force: true });
await cp(bundleDir, targetDir, { recursive: true, force: true });

console.log(`Installed ${extensionId} to ${targetDir}`);
console.log("Restart Premiere Pro, then open Window > Extensions > Sora Genie.");
