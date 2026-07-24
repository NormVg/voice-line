import { VoiceLineClient } from "@voice-line/client";
import type { ClientState, Message, Transport } from "@voice-line/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseVoiceAgentOptions {
  transport: Transport;
  sessionId?: string;
  sampleRate?: number;
  autoMic?: boolean;
}

export interface UseVoiceAgentReturn {
  state: ClientState;
  messages: Message[];
  isConnected: boolean;
  isBotSpeaking: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMic: (enabled?: boolean) => Promise<void>;
  sendText: (text: string) => void;
}

/**
 * React hook wrapping VoiceLineClient.
 * Reactivity only — no domain logic here.
 */
export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const [state, setState] = useState<ClientState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const clientRef = useRef<VoiceLineClient | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const ensureClient = useCallback((): VoiceLineClient => {
    if (clientRef.current) return clientRef.current;
    const opts = optionsRef.current;
    const clientOptions: ConstructorParameters<typeof VoiceLineClient>[0] = {
      transport: opts.transport,
    };
    if (opts.sampleRate !== undefined) clientOptions.sampleRate = opts.sampleRate;
    if (opts.autoMic !== undefined) clientOptions.autoMic = opts.autoMic;
    const c = new VoiceLineClient(clientOptions);
    c.on("state", setState);
    c.on("message", (m) => {
      setMessages((prev) => [...prev, m]);
    });
    clientRef.current = c;
    return c;
  }, []);

  const connect = useCallback(async () => {
    const c = ensureClient();
    await c.connect(optionsRef.current.sessionId);
  }, [ensureClient]);

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
      isConnected,
      isBotSpeaking,
      connect,
      disconnect,
      toggleMic,
      sendText,
    }),
    [state, messages, isConnected, isBotSpeaking, connect, disconnect, toggleMic, sendText],
  );
}
