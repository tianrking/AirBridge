import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Copy } from "./i18n";

export function Dialog({
  title,
  eyebrow,
  icon,
  children,
  onClose,
  copy,
}: {
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  copy: Copy;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = dialog.current!;
    const previous = document.activeElement;
    node.showModal();
    return () => {
      node.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="app-dialog"
      aria-labelledby={heading}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter(
          (node) => node.getClientRects().length > 0 && node.tabIndex >= 0,
        );
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === last &&
          first
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          close.current();
      }}
    >
      <button
        type="button"
        className="icon-button dialog-close"
        onClick={onClose}
        aria-label={copy.close}
      >
        <X size={18} />
      </button>
      <header className="dialog-heading">
        {icon ? <span className="dialog-glyph">{icon}</span> : null}
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={heading}>{title}</h2>
      </header>
      {children}
    </dialog>
  );
}
