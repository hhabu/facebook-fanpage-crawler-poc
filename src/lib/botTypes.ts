export type BotType = "article" | "product" | "social" | "custom";
export type BotStatus = "active" | "paused" | "error";
export type BrowserEngineName = "auto" | "fetch" | "playwright" | "cloak";

export interface Bot {
  id: number;
  name: string;
  type: BotType;
  targetUrl: string;
  targetDomain: string;
  browserProfile: string;
  browserEngine: BrowserEngineName;
  proxyUrl: string | null;
  userAgent: string | null;
  viewportJson: string | null;
  retryLimit: number;
  cooldownSeconds: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  scheduleCron: string | null;
  status: BotStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBotInput {
  name: string;
  type: BotType;
  targetUrl: string;
  targetDomain?: string;
  browserProfile: string;
  browserEngine?: BrowserEngineName;
  proxyUrl?: string | null;
  userAgent?: string | null;
  viewportJson?: string | null;
  retryLimit?: number;
  cooldownSeconds?: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  scheduleCron?: string | null;
  status?: BotStatus;
}

export type UpdateBotInput = Partial<CreateBotInput>;

export function inferTargetDomain(targetUrl: string): string {
  try {
    return new URL(targetUrl).hostname;
  } catch {
    return targetUrl.replace(/^https?:\/\//, "").split("/")[0] || "unknown";
  }
}
