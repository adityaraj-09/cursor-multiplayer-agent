"use client";

import { useEffect, useRef, useState } from "react";

export const HERO_VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260715_090628_7052d8a6-a094-4341-a4a2-ad58493a67a9.mp4";

const MAX_CAPTURE_WIDTH_DESKTOP = 720;
const MAX_CAPTURE_WIDTH_MOBILE = 480;
const MAX_FRAMES = 72;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Absolute full-bleed hero background.
 * Desktop: plays once while capturing frames, then ping-pongs on canvas.
 * Mobile / reduced-motion: native muted loop (or still frame) — no frame buffer.
 */
export default function BoomerangVideoBg({
  src = HERO_VIDEO_SRC,
}: {
  src?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current as VideoWithFrameCallback | null;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let cancelled = false;
    let capturing = false;
    let rvfcHandle: number | null = null;
    let rafHandle = 0;
    let lastCapturedTime = -1;
    const frames: HTMLCanvasElement[] = [];
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const lightMode =
      reduceMotion ||
      window.matchMedia("(max-width: 768px)").matches ||
      window.matchMedia("(pointer: coarse)").matches;
    const maxWidth = lightMode
      ? MAX_CAPTURE_WIDTH_MOBILE
      : MAX_CAPTURE_WIDTH_DESKTOP;

    const stopRvfc = () => {
      if (rvfcHandle != null && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(rvfcHandle);
        rvfcHandle = null;
      }
    };

    const captureSize = () => {
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      const scale = Math.min(1, maxWidth / Math.max(vw, 1));
      return {
        w: Math.max(1, Math.round(vw * scale)),
        h: Math.max(1, Math.round(vh * scale)),
      };
    };

    const ensureDisplayCanvas = (w: number, h: number) => {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    const startNativeLoopFallback = () => {
      if (cancelled) return;
      video.loop = true;
      video.style.opacity = "1";
      canvas.style.opacity = "0";
      markReady();
      void video.play().catch(() => {});
    };

    const captureFrame = (mediaTime: number) => {
      if (cancelled || !capturing) return;
      if (!(mediaTime > lastCapturedTime)) return;
      if (!video.videoWidth || !video.videoHeight) return;
      if (frames.length >= MAX_FRAMES) {
        capturing = false;
        stopRvfc();
        video.pause();
        playBoomerang();
        return;
      }

      lastCapturedTime = mediaTime;
      const { w, h } = captureSize();
      ensureDisplayCanvas(w, h);

      const frame = document.createElement("canvas");
      frame.width = w;
      frame.height = h;
      const frameCtx = frame.getContext("2d", { alpha: false });
      if (!frameCtx) return;

      try {
        frameCtx.drawImage(video, 0, 0, w, h);
        ctx.drawImage(frame, 0, 0, w, h);
        frames.push(frame);
        markReady();
      } catch {
        capturing = false;
        stopRvfc();
        startNativeLoopFallback();
      }
    };

    const scheduleCapture = () => {
      if (cancelled || !capturing) return;

      if (typeof video.requestVideoFrameCallback === "function") {
        rvfcHandle = video.requestVideoFrameCallback((_now, meta) => {
          captureFrame(meta.mediaTime);
          if (capturing && !cancelled) scheduleCapture();
        });
        return;
      }

      rafHandle = requestAnimationFrame(() => {
        captureFrame(video.currentTime);
        if (capturing && !cancelled) scheduleCapture();
      });
    };

    const playBoomerang = () => {
      if (cancelled || frames.length < 2) {
        startNativeLoopFallback();
        return;
      }

      let index = 0;
      let direction: 1 | -1 = 1;
      let lastTs = 0;
      const frameMs = 1000 / 24;

      video.style.opacity = "0";
      canvas.style.opacity = "1";
      markReady();

      const tick = (ts: number) => {
        if (cancelled) return;
        if (!lastTs) lastTs = ts;
        if (ts - lastTs >= frameMs) {
          lastTs = ts;
          const frame = frames[index];
          if (frame) {
            ensureDisplayCanvas(frame.width, frame.height);
            ctx.drawImage(frame, 0, 0);
          }
          index += direction;
          if (index >= frames.length - 1) {
            index = frames.length - 1;
            direction = -1;
          } else if (index <= 0) {
            index = 0;
            direction = 1;
          }
        }
        rafHandle = requestAnimationFrame(tick);
      };

      rafHandle = requestAnimationFrame(tick);
    };

    const onLoaded = () => {
      if (cancelled) return;

      if (reduceMotion) {
        video.pause();
        try {
          video.currentTime = Math.min(0.1, video.duration || 0.1);
        } catch {
          // ignore
        }
        video.style.opacity = "1";
        canvas.style.opacity = "0";
        markReady();
        return;
      }

      if (lightMode) {
        startNativeLoopFallback();
        return;
      }

      capturing = true;
      lastCapturedTime = -1;
      frames.length = 0;
      video.loop = false;
      video.muted = true;
      video.style.opacity = "0";
      canvas.style.opacity = "1";

      const start = () => {
        if (cancelled) return;
        void video
          .play()
          .then(() => {
            if (!cancelled) scheduleCapture();
          })
          .catch(() => {
            startNativeLoopFallback();
          });
      };

      try {
        video.currentTime = 0;
      } catch {
        // ignore
      }
      start();
    };

    const onEnded = () => {
      capturing = false;
      stopRvfc();
      cancelAnimationFrame(rafHandle);
      playBoomerang();
    };

    const onError = () => {
      capturing = false;
      stopRvfc();
      startNativeLoopFallback();
    };

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);

    if (video.readyState >= 2) onLoaded();
    else void video.load();

    return () => {
      cancelled = true;
      capturing = false;
      stopRvfc();
      cancelAnimationFrame(rafHandle);
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      video.pause();
      frames.length = 0;
    };
  }, [src]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {/* Static gradient poster while video boots */}
      <div
        className={`absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,#e8e6e1_0%,#f7f5f0_45%,#ffffff_100%)] transition-opacity duration-500 ${
          ready ? "opacity-0" : "opacity-100"
        }`}
      />
      <div className="absolute inset-0 scale-[1.15] origin-top overflow-hidden">
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          className="w-full h-full object-cover object-top"
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover object-top opacity-0"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-white via-white/50 to-white/15 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-white/75 via-white/30 to-transparent pointer-events-none" />
    </div>
  );
}
