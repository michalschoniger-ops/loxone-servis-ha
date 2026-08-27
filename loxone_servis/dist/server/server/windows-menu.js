import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
export const CURRENT_WINDOWS_MENU_VERSION = "3.0.32";
export const WINDOWS_MENU_PACKAGE_URL = "/api/integrations/worklog/v1/windows-menu/package";
function packagePath() {
    const configured = process.env.EVORA_WINDOWS_MENU_PACKAGE_PATH?.trim();
    const candidates = [
        configured || "",
        resolve(process.cwd(), "dist/client/downloads/EvoraSmartMenu-Windows.zip"),
        resolve(process.cwd(), "src/client/public/downloads/EvoraSmartMenu-Windows.zip"),
    ].filter(Boolean);
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
export function windowsMenuPackage() {
    const path = packagePath();
    return path ? readFileSync(path) : null;
}
export function windowsMenuUpdateManifest(workLogToken, packageContent = windowsMenuPackage()) {
    if (!packageContent || !workLogToken.startsWith("esh_worklog_") || workLogToken.length < 44)
        return null;
    const sha256 = createHash("sha256").update(packageContent).digest("hex");
    const canonical = `${CURRENT_WINDOWS_MENU_VERSION}\n${WINDOWS_MENU_PACKAGE_URL}\n${sha256}`;
    return {
        version: CURRENT_WINDOWS_MENU_VERSION,
        url: WINDOWS_MENU_PACKAGE_URL,
        sha256,
        signature: createHmac("sha256", workLogToken).update(canonical, "utf8").digest("hex"),
        signatureAlgorithm: "hmac-sha256-worklog-token-v1",
    };
}
