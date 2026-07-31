"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Delay in ms before the reveal animation starts once visible. */
  delay?: number;
  /** Animation variant — matches CSS classes defined in globals.css. */
  variant?: "up" | "left" | "right" | "scale";
  as?: "div" | "li" | "span";
};

/**
 * Wraps children in an IntersectionObserver-driven reveal so sections
 * animate in as the visitor scrolls, instead of all firing on mount.
 * Falls back to fully visible immediately if IO is unavailable or the
 * visitor prefers reduced motion.
 */
export default function Reveal({
  children,
  className = "",
  delay = 0,
  variant = "up",
  as = "div",
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion || typeof IntersectionObserver === "undefined") {
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Tag = as;
  return (
    <Tag
      ref={ref as never}
      className={`landing-reveal landing-reveal-${variant} ${visible ? "is-visible" : ""} ${className}`}
      style={visible && delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
