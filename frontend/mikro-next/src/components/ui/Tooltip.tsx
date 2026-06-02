"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

export interface TooltipProps {
  /** The content shown on hover */
  content: ReactNode;
  /** The element that triggers the tooltip */
  children: ReactNode;
  /** Preferred placement */
  position?: "top" | "bottom" | "left" | "right";
  /** Delay in ms before showing (default 300) */
  delay?: number;
  /** Max width in px (default 240) */
  maxWidth?: number;
  /** Additional className on the wrapper */
  className?: string;
}

export function Tooltip({
  content,
  children,
  position = "top",
  delay = 300,
  maxWidth = 240,
  className = "",
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [actualPosition, setActualPosition] = useState(position);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setCoords(null);
  };

  useEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;
    let pos = position;

    // Calculate position, flip if off-screen
    const calc = (p: typeof position) => {
      switch (p) {
        case "top":
          top = triggerRect.top - tooltipRect.height - gap;
          left =
            triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
          break;
        case "bottom":
          top = triggerRect.bottom + gap;
          left =
            triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
          break;
        case "left":
          top =
            triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
          left = triggerRect.left - tooltipRect.width - gap;
          break;
        case "right":
          top =
            triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
          left = triggerRect.right + gap;
          break;
      }
    };

    calc(pos);

    // Flip if out of viewport
    if (pos === "top" && top < 0) {
      pos = "bottom";
      calc(pos);
    } else if (
      pos === "bottom" &&
      top + tooltipRect.height > window.innerHeight
    ) {
      pos = "top";
      calc(pos);
    } else if (pos === "left" && left < 0) {
      pos = "right";
      calc(pos);
    } else if (
      pos === "right" &&
      left + tooltipRect.width > window.innerWidth
    ) {
      pos = "left";
      calc(pos);
    }

    // Clamp horizontal to viewport
    left = Math.max(
      8,
      Math.min(left, window.innerWidth - tooltipRect.width - 8),
    );

    setActualPosition(pos);
    setCoords({ top, left });
  }, [visible, position]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!content) return <>{children}</>;

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className={`inline-flex ${className}`}
      style={{ position: "relative" }}
    >
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: "fixed",
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            maxWidth,
            zIndex: 9999,
            opacity: coords ? 1 : 0,
            pointerEvents: "none",
          }}
          className={`rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-gray-100 dark:text-gray-900
            ${actualPosition === "top" ? "animate-in fade-in slide-in-from-bottom-1" : ""}
            ${actualPosition === "bottom" ? "animate-in fade-in slide-in-from-top-1" : ""}
            ${actualPosition === "left" ? "animate-in fade-in slide-in-from-right-1" : ""}
            ${actualPosition === "right" ? "animate-in fade-in slide-in-from-left-1" : ""}
          `}
        >
          {content}
        </div>
      )}
    </span>
  );
}
