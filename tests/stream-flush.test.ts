import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STREAM_EMIT_MS,
  STREAM_PERSIST_CHARS,
  createAssistantStreamSink,
} from "../server/streamFlush.js";

describe("createAssistantStreamSink", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not persist or emit every token", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const emit = vi.fn();
    const sink = createAssistantStreamSink({ persist, emit });

    sink.update("a", "streaming");
    sink.update("ab", "streaming");
    sink.update("abc", "streaming");
    expect(persist).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STREAM_EMIT_MS);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("abc");
    expect(emit.mock.calls[0][1]).toBe("streaming");
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists after 400 new characters", () => {
    const persist = vi.fn();
    const emit = vi.fn();
    const sink = createAssistantStreamSink({ persist, emit });
    const text = "x".repeat(STREAM_PERSIST_CHARS);
    sink.update(text, "streaming");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]).toEqual([text, "streaming"]);
  });

  it("flushes persist and emit on a terminal status", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const emit = vi.fn();
    const sink = createAssistantStreamSink({ persist, emit });
    sink.update("hello", "streaming");
    sink.update("hello world", "done");
    expect(persist).toHaveBeenCalledWith("hello world", "done");
    expect(emit).toHaveBeenCalled();
    const last = emit.mock.calls.at(-1);
    expect(last?.[0]).toBe("hello world");
    expect(last?.[1]).toBe("done");
  });

  it("emits incremental append chunks when content grows", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const emit = vi.fn();
    const sink = createAssistantStreamSink({ persist, emit });
    sink.update("hel", "streaming");
    vi.advanceTimersByTime(STREAM_EMIT_MS);
    sink.update("hello", "streaming");
    vi.advanceTimersByTime(STREAM_EMIT_MS);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][2]).toBe(true);
    expect(emit.mock.calls[1][3]).toBe("lo");
  });
});
