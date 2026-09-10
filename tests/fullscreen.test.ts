import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitElementFullscreen,
  fullscreenChangeEvents,
  getFullscreenElement,
  isFullscreenSupported,
  requestElementFullscreen,
} from "../web/lib/fullscreen.ts";

describe("fullscreen helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports supported events", () => {
    expect(fullscreenChangeEvents()).toEqual([
      "fullscreenchange",
      "webkitfullscreenchange",
    ]);
  });

  it("detects support from requestFullscreen", () => {
    const requestFullscreen = vi.fn();
    vi.stubGlobal("document", {
      documentElement: { requestFullscreen },
    });
    expect(isFullscreenSupported()).toBe(true);
  });

  it("detects support from webkitRequestFullscreen", () => {
    vi.stubGlobal("document", {
      documentElement: { webkitRequestFullscreen: vi.fn() },
    });
    expect(isFullscreenSupported()).toBe(true);
  });

  it("reads standard and webkit fullscreen elements", () => {
    const el = { id: "shell" };
    vi.stubGlobal("document", {
      fullscreenElement: el,
      webkitFullscreenElement: null,
      documentElement: {},
    });
    expect(getFullscreenElement()).toBe(el);

    vi.stubGlobal("document", {
      fullscreenElement: null,
      webkitFullscreenElement: el,
      documentElement: {},
    });
    expect(getFullscreenElement()).toBe(el);
  });

  it("requests fullscreen with standard and webkit APIs", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    await requestElementFullscreen({
      requestFullscreen,
    } as unknown as HTMLElement);
    expect(requestFullscreen).toHaveBeenCalledOnce();

    const webkitRequestFullscreen = vi.fn().mockResolvedValue(undefined);
    await requestElementFullscreen({
      webkitRequestFullscreen,
    } as unknown as HTMLElement);
    expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
  });

  it("exits fullscreen with standard and webkit APIs", async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("document", {
      fullscreenElement: {},
      exitFullscreen,
      documentElement: {},
    });
    await exitElementFullscreen();
    expect(exitFullscreen).toHaveBeenCalledOnce();

    const webkitExitFullscreen = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("document", {
      fullscreenElement: null,
      webkitFullscreenElement: {},
      webkitExitFullscreen,
      documentElement: {},
    });
    await exitElementFullscreen();
    expect(webkitExitFullscreen).toHaveBeenCalledOnce();
  });
});
