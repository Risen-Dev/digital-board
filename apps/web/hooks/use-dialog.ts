"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour for a dialog panel: focus moves in on open (unless a child
 * already took it with autoFocus), Tab stays inside, Escape closes, and focus goes
 * back to whatever opened it. Spread the result on the panel element.
 * Not the native <dialog>: showModal() makes everything outside it inert, which
 * would break the portalled pickers that open from inside these dialogs.
 */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => {
      // The opener may have re-rendered away (a card moved column); only restore if it is still there.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // A picker inside (mentions, a column editor) stops Escape first when it is open.
    if (e.key === "Escape") {
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return { ref, onKeyDown, tabIndex: -1, role: "dialog" as const, "aria-modal": true as const };
}
