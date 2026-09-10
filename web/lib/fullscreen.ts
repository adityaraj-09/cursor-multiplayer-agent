/** Browser Fullscreen API helpers with Safari webkit prefixes. */

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

export function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FullscreenElement;
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen);
}

export async function requestElementFullscreen(
  element: HTMLElement,
): Promise<void> {
  const target = element as FullscreenElement;
  if (typeof target.requestFullscreen === "function") {
    await target.requestFullscreen();
    return;
  }
  if (typeof target.webkitRequestFullscreen === "function") {
    await target.webkitRequestFullscreen();
  }
}

export async function exitElementFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  const doc = document as FullscreenDocument;
  if (typeof doc.exitFullscreen === "function" && doc.fullscreenElement) {
    await doc.exitFullscreen();
    return;
  }
  if (
    typeof doc.webkitExitFullscreen === "function" &&
    doc.webkitFullscreenElement
  ) {
    await doc.webkitExitFullscreen();
  }
}

export function fullscreenChangeEvents(): string[] {
  return ["fullscreenchange", "webkitfullscreenchange"];
}
