export const SARVAM_BASE_URL = "https://api.sarvam.ai";

export interface SarvamCredentials {
  /** API subscription key. Falls back to `SARVAM_API_KEY` env. */
  apiKey?: string;
  baseUrl?: string;
}

export function resolveApiKey(explicit?: string): string {
  const key = explicit ?? (typeof process !== "undefined" ? process.env.SARVAM_API_KEY : undefined);
  if (!key) {
    throw new Error("Sarvam API key missing. Pass apiKey or set SARVAM_API_KEY.");
  }
  return key;
}

export function authHeaders(apiKey: string): Record<string, string> {
  return {
    "api-subscription-key": apiKey,
  };
}
