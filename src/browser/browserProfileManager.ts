import fs from "node:fs";
import path from "node:path";
import type { Bot } from "../lib/botTypes";

export interface BrowserProfileRuntime {
  name: string;
  userDataDir: string;
  metadataPath: string;
  stealthMode: "basic";
  targetDomain: string;
}

export interface BrowserProfileSummary {
  name: string;
  sourceName: string;
  ownerBotId: number;
  targetDomain: string;
  stealthMode: string;
  createdAt: string;
  userDataDir: string;
  warmupAt?: string;
  sessionReady?: boolean;
}

function safeProfileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "default-profile";
}

export function getBrowserProfileRuntime(bot: Bot): BrowserProfileRuntime {
  const name = safeProfileName(bot.browserProfile);
  const userDataDir = path.resolve(process.cwd(), "data", "browser-profiles", name);
  const metadataPath = path.join(userDataDir, "profile.json");

  fs.mkdirSync(userDataDir, { recursive: true });

  if (!fs.existsSync(metadataPath)) {
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          name,
          sourceName: bot.browserProfile,
          ownerBotId: bot.id,
          targetDomain: bot.targetDomain,
          stealthMode: "basic",
          createdAt: new Date().toISOString()
        },
        null,
        2
      )
    );
  }

  return {
    name,
    userDataDir,
    metadataPath,
    stealthMode: "basic",
    targetDomain: bot.targetDomain
  };
}

export function listBrowserProfiles(): BrowserProfileSummary[] {
  const profilesDir = path.resolve(process.cwd(), "data", "browser-profiles");
  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  return fs
    .readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const userDataDir = path.join(profilesDir, entry.name);
      const metadataPath = path.join(userDataDir, "profile.json");
      const fallback = {
        name: entry.name,
        sourceName: entry.name,
        ownerBotId: 0,
        targetDomain: "unknown",
        stealthMode: "basic",
        createdAt: ""
      };

      if (!fs.existsSync(metadataPath)) {
        return { ...fallback, userDataDir };
      }

      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as Omit<BrowserProfileSummary, "userDataDir">;
        return { ...fallback, ...metadata, userDataDir };
      } catch {
        return { ...fallback, userDataDir };
      }
    });
}

export function markBrowserProfileWarmup(profile: BrowserProfileRuntime): void {
  const raw = fs.existsSync(profile.metadataPath) ? JSON.parse(fs.readFileSync(profile.metadataPath, "utf8")) : {};
  fs.writeFileSync(
    profile.metadataPath,
    JSON.stringify(
      {
        ...raw,
        warmupAt: new Date().toISOString(),
        sessionReady: true
      },
      null,
      2
    )
  );
}

export function testBrowserProfile(profile: BrowserProfileRuntime): {
  exists: boolean;
  metadataPath: string;
  userDataDir: string;
  sessionReady: boolean;
  cookiesLikelyPresent: boolean;
} {
  const cookiesPath = path.join(profile.userDataDir, "Default", "Cookies");
  const metadata = fs.existsSync(profile.metadataPath) ? JSON.parse(fs.readFileSync(profile.metadataPath, "utf8")) : {};

  return {
    exists: fs.existsSync(profile.userDataDir),
    metadataPath: profile.metadataPath,
    userDataDir: profile.userDataDir,
    sessionReady: Boolean(metadata.sessionReady),
    cookiesLikelyPresent: fs.existsSync(cookiesPath)
  };
}

export function clearBrowserProfile(profileName: string): void {
  const safeName = safeProfileName(profileName);
  const profilesDir = path.resolve(process.cwd(), "data", "browser-profiles");
  const target = path.resolve(profilesDir, safeName);

  if (!target.startsWith(profilesDir) || !fs.existsSync(target)) {
    return;
  }

  fs.rmSync(target, { recursive: true, force: true });
}
