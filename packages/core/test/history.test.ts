import { describe, expect, it } from "vitest";
import { MessageHistory } from "../src/session/history.js";

describe("MessageHistory", () => {
  it("records user and assistant messages", () => {
    const h = new MessageHistory();
    const u = h.addUser("hello");
    const a = h.addAssistant("hi there");
    expect(h.length).toBe(2);
    expect(u.role).toBe("user");
    expect(a.partial).toBe(false);
  });

  it("marks interrupted assistant messages as partial", () => {
    const h = new MessageHistory();
    h.addUser("book a flight");
    h.addAssistant("Sure, let me", { partial: true });
    expect(h.all[1]?.partial).toBe(true);
  });
});
