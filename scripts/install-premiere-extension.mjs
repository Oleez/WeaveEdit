import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncCepBundleToUser } from "./cep-sync-to-user.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const extensionId = "com.soragenie.panel";
const bundleDir = path.join(rootDir, "dist", "cep", extensionId);

const result = await syncCepBundleToUser(bundleDir);

if (result.installed) {
  console.log(result.message);
  console.log("Restart Premiere Pro if it is open, then Window > Extensions > Weave Edit.");
} else {
  console.warn(result.message);
}
