import { Session } from "@voice-line/core";

// Simple in-memory session store
export const sessionStore = new Map<string, Session>();
