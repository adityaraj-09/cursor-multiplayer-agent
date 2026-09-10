"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  exitElementFullscreen,
  fullscreenChangeEvents,
  getFullscreenElement,
  isFullscreenSupported,
  requestElementFullscreen,
} from "../lib/fullscreen";

export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(isFullscreenSupported());
    const sync = () => {
      const current = targetRef.current;
      const fs = getFullscreenElement();
      setActive(Boolean(current && fs === current));
    };
    sync();
    const events = fullscreenChangeEvents();
    for (const name of events) {
      document.addEventListener(name, sync);
    }
    return () => {
      for (const name of events) {
        document.removeEventListener(name, sync);
      }
    };
  }, [targetRef]);

  const toggle = useCallback(async () => {
    const el = targetRef.current;
    if (!el || !isFullscreenSupported()) return;
    try {
      if (getFullscreenElement() === el) {
        await exitElementFullscreen();
      } else {
        await requestElementFullscreen(el);
      }
    } catch (err) {
      console.error("Fullscreen toggle failed", err);
    }
  }, [targetRef]);

  return { active, supported, toggle };
}
