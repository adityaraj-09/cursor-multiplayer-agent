"use client";

import { useEffect, useState } from "react";
import type { ChatStatus } from "../../shared/events";

type StreamEntry = { content: string; status: ChatStatus };
type Listener = (entry: StreamEntry) => void;

const latest = new Map<string, StreamEntry>();
const listeners = new Map<string, Set<Listener>>();

export function applyChatDelta(
  id: string,
  chunk: string,
  status: ChatStatus | undefined,
  append?: boolean,
): StreamEntry {
  const prev = latest.get(id);
  const next: StreamEntry = {
    content: append && prev ? prev.content + chunk : chunk,
    status: status ?? prev?.status ?? "streaming",
  };
  latest.set(id, next);
  const subs = listeners.get(id);
  if (subs) {
    for (const fn of subs) fn(next);
  }
  if (next.status !== "streaming") {
    latest.delete(id);
    listeners.delete(id);
  }
  return next;
}

export function peekStreamContent(id: string): StreamEntry | undefined {
  return latest.get(id);
}

export function subscribeStreamContent(
  id: string,
  fn: Listener,
): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) listeners.delete(id);
  };
}

export function resetStreamContents(): void {
  latest.clear();
  listeners.clear();
}

export function useStreamContent(
  id: string,
  fallbackContent: string,
  fallbackStatus?: ChatStatus,
): { content: string; status: ChatStatus | undefined } {
  const [entry, setEntry] = useState(() => peekStreamContent(id));
  useEffect(() => {
    setEntry(peekStreamContent(id));
    return subscribeStreamContent(id, setEntry);
  }, [id]);
  return {
    content: entry?.content ?? fallbackContent,
    status: entry?.status ?? fallbackStatus,
  };
}
