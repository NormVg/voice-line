import type { ServerToClientEvent, VoiceLineEvent } from "@voice-line/core";
import { isServerEvent } from "@voice-line/core";

export type ServerEventHandler = (event: ServerToClientEvent) => void;

/**
 * Typed dispatcher for server → client protocol events.
 */
export class EventDispatcher {
  private handlers = new Map<ServerToClientEvent["type"], Set<ServerEventHandler>>();
  private anyHandlers = new Set<ServerEventHandler>();

  on(type: ServerToClientEvent["type"] | "*", handler: ServerEventHandler): () => void {
    if (type === "*") {
      this.anyHandlers.add(handler);
      return () => {
        this.anyHandlers.delete(handler);
      };
    }
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  dispatch(event: VoiceLineEvent): void {
    if (!isServerEvent(event)) return;
    for (const h of this.anyHandlers) h(event);
    const set = this.handlers.get(event.type);
    if (set) {
      for (const h of set) h(event);
    }
  }
}
