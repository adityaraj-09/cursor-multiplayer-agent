import type { ChatStatus } from "../shared/events.js";

export const STREAM_EMIT_MS = 40;
export const STREAM_PERSIST_CHARS = 400;

export interface StreamFlushHandlers {
  persist: (content: string, status: ChatStatus) => void;
  emit: (content: string, status: ChatStatus, append: boolean, chunk: string) => void;
}

/**
 * Coalesce assistant token updates: emit at most every 40ms (incremental
 * when possible) and persist every 400 new characters or on a terminal status.
 */
export function createAssistantStreamSink(handlers: StreamFlushHandlers): {
  update: (content: string, status: ChatStatus) => void;
  flush: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingContent = "";
  let pendingStatus: ChatStatus = "streaming";
  let lastPersisted = "";
  let lastEmitted = "";
  let lastEmittedStatus: ChatStatus | null = null;

  const runPersist = (): void => {
    if (pendingContent === lastPersisted && pendingStatus === "streaming") return;
    lastPersisted = pendingContent;
    handlers.persist(pendingContent, pendingStatus);
  };

  const runEmit = (): void => {
    if (
      pendingContent === lastEmitted &&
      pendingStatus === lastEmittedStatus
    ) {
      return;
    }
    const append =
      lastEmitted.length > 0 && pendingContent.startsWith(lastEmitted);
    const chunk = append
      ? pendingContent.slice(lastEmitted.length)
      : pendingContent;
    lastEmitted = pendingContent;
    lastEmittedStatus = pendingStatus;
    handlers.emit(pendingContent, pendingStatus, append, chunk);
  };

  const clearTimer = (): void => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    update(content, status) {
      pendingContent = content;
      pendingStatus = status;
      const persistDue =
        status !== "streaming" ||
        content.length - lastPersisted.length >= STREAM_PERSIST_CHARS;
      if (persistDue) runPersist();
      if (status !== "streaming") {
        clearTimer();
        runEmit();
        return;
      }
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          runEmit();
        }, STREAM_EMIT_MS);
      }
    },
    flush() {
      clearTimer();
      runPersist();
      runEmit();
    },
  };
}
