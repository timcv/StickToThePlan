/**
 * Small ⓘ info button with a tooltip / popover. Click-to-toggle so it works on
 * touch as well as desktop (hover-only fails on phones). Closes on outside
 * click or Escape. The bubble is associated with the trigger via aria.
 */
import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  /** Explanation text shown in the bubble. */
  text: string;
  /** Accessible label for the trigger, e.g. the field name. */
  label: string;
}

export function InfoTip({ text, label }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="infotip" ref={ref}>
      <button
        type="button"
        className="infotip-trigger"
        aria-label={`Förklaring: ${label}`}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ⓘ
      </button>
      {open && (
        <span className="infotip-bubble" id={bubbleId} role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
