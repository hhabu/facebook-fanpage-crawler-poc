export interface BlockDetectionResult {
  blocked: boolean;
  reason: string | null;
}

const BLOCK_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: "captcha", pattern: /captcha|recaptcha|hcaptcha|verify you are human/i },
  { reason: "access_denied", pattern: /access denied|forbidden|request blocked|blocked by/i },
  { reason: "robot_check", pattern: /robot check|unusual traffic|automated queries|bot detection/i },
  { reason: "login_required", pattern: /log in to continue|login required|sign in to continue|please log in/i },
  { reason: "rate_limited", pattern: /too many requests|rate limit|temporarily unavailable/i }
];

export function detectBlockPage(text: string, html = ""): BlockDetectionResult {
  const searchable = `${text}\n${html}`.slice(0, 250000);
  for (const item of BLOCK_PATTERNS) {
    if (item.pattern.test(searchable)) {
      return { blocked: true, reason: item.reason };
    }
  }

  return { blocked: false, reason: null };
}
