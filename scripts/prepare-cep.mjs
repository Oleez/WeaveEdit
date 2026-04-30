import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncCepBundleToUser } from "./cep-sync-to-user.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const extensionId = "com.soragenie.panel";
const webBuildDir = path.join(rootDir, "dist", "web");
const templateDir = path.join(rootDir, "cep", extensionId);
const outputDir = path.join(rootDir, "dist", "cep", extensionId);

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

if (!(await pathExists(webBuildDir))) {
  throw new Error(`Web build not found at ${webBuildDir}. Run "vite build" first.`);
}

if (!(await pathExists(templateDir))) {
  throw new Error(`CEP template not found at ${templateDir}.`);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(webBuildDir, outputDir, { recursive: true });
await cp(templateDir, outputDir, { recursive: true, force: true });

console.log(`Prepared CEP bundle at ${outputDir}`);

const userInstall = await syncCepBundleToUser(outputDir);
if (userInstall.installed) {
  console.log(userInstall.message);
  console.log("Restart Premiere Pro if it is open, then Window > Extensions > Weave Edit.");
} else {
  console.warn(userInstall.message);
}
