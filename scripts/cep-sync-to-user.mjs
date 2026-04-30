/**
 * Copies a built CEP bundle into the per-user Adobe CEP extensions folder
 * so Premiere Pro loads it after restart (Window > Extensions).
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const extensionId = "com.soragenie.panel";

const requiredBundleFiles = (bundleDir) => [
  path.join(bundleDir, "CSXS", "manifest.xml"),
  path.join(bundleDir, "index.html"),
  path.join(bundleDir, "host", "premiereHost.jsx"),
];

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getAdobeCepExtensionsRoot() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Adobe", "CEP", "extensions");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions");
  }
  return null;
}

function enableCepDebugModeWindows() {
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

/**
 * @param {string} bundleDir Absolute path to dist/cep/com.soragenie.panel
 * @returns {Promise<{ installed: boolean; targetDir?: string; message: string }>}
 */
export async function syncCepBundleToUser(bundleDir) {
  const extensionsRoot = getAdobeCepExtensionsRoot();
  if (!extensionsRoot) {
    return {
      installed: false,
      message: `Skipping CEP install: no standard Adobe extensions path on ${process.platform}. Bundle is at ${bundleDir}.`,
    };
  }

  if (!(await pathExists(bundleDir))) {
    throw new Error(`CEP bundle not found at ${bundleDir}.`);
  }

  for (const requiredFile of requiredBundleFiles(bundleDir)) {
    if (!(await pathExists(requiredFile))) {
      throw new Error(`CEP bundle is missing required file: ${requiredFile}`);
    }
  }

  if (process.platform === "win32") {
    enableCepDebugModeWindows();
  }

  const targetDir = path.join(extensionsRoot, extensionId);
  await mkdir(extensionsRoot, { recursive: true });
  await rm(targetDir, { recursive: true, force: true });
  await cp(bundleDir, targetDir, { recursive: true, force: true });

  return {
    installed: true,
    targetDir,
    message: `Installed ${extensionId} for Premiere: ${targetDir}`,
  };
}
