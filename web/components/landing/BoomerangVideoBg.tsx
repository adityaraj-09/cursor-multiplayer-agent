"use client";

import { useEffect, useRef } from "react";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260715_090628_7052d8a6-a094-4341-a4a2-ad58493a67a9.mp4";

const MAX_CAPTURE_WIDTH = 960;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Full-bleed background that plays the source once while capturing frames,
 * then ping-pongs those frames on a canvas (boomerang loop).
 */
export default function BoomerangVideoBg({
  src = VIDEO_SRC,
}: {
  src?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const video = videoRef.current as VideoWithFrameCallback | null;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let cancelled = false;
    let capturing = false;
    let frameHandle: number | null = null;
    let rafHandle = 0;
    let lastCapturedTime = -1;
    const frames: ImageBitmap[] = [];
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const clearFrames = () => {
      for (const f of frames) f.close();
      frames.length = 0;
    };

    const sizeCanvas = (vw: number, vh: number) => {
      const scale = Math.min(1, MAX_CAPTURE_WIDTH / Math.max(vw, 1));
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return { w, h };
    };

    const captureFrame = async (mediaTime: number) => {
      if (cancelled || !capturing) return;
      if (mediaTime <= lastCapturedTime) return;
      if (!video.videoWidth || !video.videoHeight) return;

      lastCapturedTime = mediaTime;
      const { w, h } = sizeCanvas(video.videoWidth, video.videoHeight);

      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext("2d", { alpha: false });
      if (!offCtx) return;
      offCtx.drawImage(video, 0, 0, w, h);

      try {
        const bitmap = await createImageBitmap(offscreen);
        if (cancelled) {
          bitmap.close();
          return;
        }
        frames.push(bitmap);
      } catch {
        // createImageBitmap can fail on tainted canvas — fall back below
      }
    };

    const scheduleCapture = () => {
      if (cancelled || !capturing) return;

      if (typeof video.requestVideoFrameCallback === "function") {
        frameHandle = video.requestVideoFrameCallback((_now, meta) => {
          void captureFrame(meta.mediaTime).then(() => {
            if (capturing && !cancelled) scheduleCapture();
          });
        });
        return;
      }

      rafHandle = requestAnimationFrame(() => {
        void captureFrame(video.currentTime).then(() => {
          if (capturing && !cancelled) scheduleCapture();
        });
      });
    };

    const playBoomerang = () => {
      if (cancelled || frames.length === 0) return;

      let index = 0;
      let direction: 1 | -1 = 1;
      let lastTs = 0;
      const frameMs = 1000 / 30;

      const tick = (ts: number) => {
        if (cancelled) return;
        if (!lastTs) lastTs = ts;
        if (ts - lastTs >= frameMs) {
          lastTs = ts;
          const frame = frames[index];
          if (frame) {
            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
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

      video.style.opacity = "0";
      canvas.style.opacity = "1";
      rafHandle = requestAnimationFrame(tick);
    };

    const startNativeLoopFallback = () => {
      video.loop = true;
      video.style.opacity = "1";
      canvas.style.opacity = "0";
      void video.play().catch(() => {});
    };

    const onLoaded = () => {
      if (cancelled) return;
      capturing = true;
      lastCapturedTime = -1;
      clearFrames();
      video.loop = false;
      video.currentTime = 0;
      void video.play().catch(() => {
        startNativeLoopFallback();
      });
      scheduleCapture();
    };

    const onEnded = () => {
      capturing = false;
      if (frameHandle != null && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(frameHandle);
        frameHandle = null;
      }
      if (frames.length >= 2) {
        playBoomerang();
      } else {
        startNativeLoopFallback();
      }
    };

    const onError = () => {
      capturing = false;
      startNativeLoopFallback();
    };

    video.addEventListener("loadeddata", onLoaded);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);

    if (video.readyState >= 2) onLoaded();

    return () => {
      cancelled = true;
      capturing = false;
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      if (frameHandle != null && video.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(frameHandle);
      }
      cancelAnimationFrame(rafHandle);
      video.pause();
      clearFrames();
    };
  }, [src]);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <div className="absolute inset-0 scale-[1.15] origin-top overflow-hidden">
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full opacity-0"
        />
      </div>
      {/* Soft scrim so hero type stays readable without hiding the film */}
      <div className="absolute inset-0 bg-gradient-to-t from-white via-white/55 to-white/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-white/70 via-white/25 to-transparent" />
    </div>
  );
}
