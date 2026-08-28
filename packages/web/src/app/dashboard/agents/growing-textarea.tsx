"use client";

import { forwardRef, useCallback, useLayoutEffect, useRef } from "react";

export const GrowingTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function GrowingTextarea({ className = "", onChange, ...props }, forwardedRef) {
    const localRef = useRef<HTMLTextAreaElement | null>(null);

    const setRef = useCallback((node: HTMLTextAreaElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }, [forwardedRef]);

    const resize = useCallback(() => {
      const element = localRef.current;
      if (!element) return;
      const maximum = Math.max(320, Math.round(window.innerHeight * 0.6));
      element.style.height = "auto";
      const nextHeight = Math.min(element.scrollHeight, maximum);
      element.style.height = `${nextHeight}px`;
      element.style.overflowY = element.scrollHeight > maximum ? "auto" : "hidden";
    }, []);

    useLayoutEffect(() => {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, [resize]);

    useLayoutEffect(() => {
      resize();
    }, [props.value, resize]);

    return (
      <textarea
        {...props}
        ref={setRef}
        className={`${className} resize-y`}
        onChange={(event) => {
          onChange?.(event);
          requestAnimationFrame(resize);
        }}
      />
    );
  },
);
