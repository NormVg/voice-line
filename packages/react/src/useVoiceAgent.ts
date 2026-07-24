import { VoiceLineClient } from "@voice-line/client";
import type { ClientState, Message, Transport } from "@voice-line/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseVoiceAgentOptions {
  session:
    | { transport: Transport; sessionId?: string }
    | (() => Promise<{ transport: Transport; sessionId: string }>);
  sampleRate?: number;
  autoMic?: boolean;
}

export interface UseVoiceAgentReturn {
  state: ClientState;
  messages: Message[];
  error: (Error & { code?: string }) | null;
  isConnected: boolean;
  isBotSpeaking: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMic: (enabled?: boolean) => Promise<void>;
  sendText: (text: string) => void;
  clearError: () => void;
}

/**
 * React hook wrapping VoiceLineClient.
 * Reactivity only — no domain logic here.
 */
export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const [state, setState] = useState<ClientState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<(Error & { code?: string }) | null>(null);
  const clientRef = useRef<VoiceLineClient | null>(null);
  const activeSessionId = useRef<string | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(async () => {
    setError(null);
    try {
      if (!clientRef.current) {
        setState("connecting");
        const opts = optionsRef.current;
        const s = typeof opts.session === "function" ? await opts.session() : opts.session;

        activeSessionId.current = s.sessionId;

        const clientOptions: ConstructorParameters<typeof VoiceLineClient>[0] = {
          transport: s.transport,
        };
        if (opts.sampleRate !== undefined) clientOptions.sampleRate = opts.sampleRate;
        if (opts.autoMic !== undefined) clientOptions.autoMic = opts.autoMic;

        const c = new VoiceLineClient(clientOptions);
        c.on("state", setState);
        c.on("message", (m) => setMessages((prev) => [...prev, m]));
        c.on("error", setError);

        clientRef.current = c;
      }

      await clientRef.current.connect(activeSessionId.current);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setState("idle");
    }
  }, []);

  const disconnect = useCallback(async () => {
    await clientRef.current?.disconnect();
    clientRef.current = null;
    setState("idle");
  }, []);

  const toggleMic = useCallback(async (enabled?: boolean) => {
    await clientRef.current?.toggleMic(enabled);
  }, []);

  const sendText = useCallback((text: string) => {
    clientRef.current?.sendText(text);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      void clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  const isConnected = state !== "idle" && state !== "connecting";
  const isBotSpeaking = state === "speaking";

  return useMemo(
    () => ({
      state,
      messages,
      error,
      isConnected,
      isBotSpeaking,
      connect,
      disconnect,
      toggleMic,
      sendText,
      clearError,
    }),
    [
      state,
      messages,
      error,
      isConnected,
      isBotSpeaking,
      connect,
      disconnect,
      toggleMic,
      sendText,
      clearError,
    ],
  );
}
