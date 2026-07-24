import type { Message } from "../types.js";
import { createId } from "../utils/id.js";

/**
 * Conversation history for a single session.
 * Append-only with support for partial (interrupted) assistant messages.
 */
export class MessageHistory {
  private messages: Message[] = [];

  get all(): readonly Message[] {
    return this.messages;
  }

  get length(): number {
    return this.messages.length;
  }

  addUser(content: string, id?: string): Message {
    const msg: Message = {
      id: id ?? createId("msg"),
      role: "user",
      content,
      timestamp: Date.now(),
      partial: false,
    };
    this.messages.push(msg);
    return msg;
  }

  addAssistant(content: string, options?: { id?: string; partial?: boolean }): Message {
    const msg: Message = {
      id: options?.id ?? createId("msg"),
      role: "assistant",
      content,
      timestamp: Date.now(),
      partial: options?.partial ?? false,
    };
    this.messages.push(msg);
    return msg;
  }

  /** Update the last assistant message (streaming accumulation). */
  updateLastAssistant(content: string, partial = false): Message | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m?.role === "assistant") {
        const updated: Message = { ...m, content, partial, timestamp: Date.now() };
        this.messages[i] = updated;
        return updated;
      }
    }
    return null;
  }

  clear(): void {
    this.messages = [];
  }

  toJSON(): Message[] {
    return [...this.messages];
  }
}
