import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

interface TruncatedTextProps {
  text: string | null | undefined;
  className?: string;
  as?: 'p' | 'span' | 'div' | 'h2';
}

/**
 * Texte tronqué avec infobulle au survol : si le texte déborde de son
 * conteneur, une bulle affichant le contenu complet apparaît au survol.
 * Si le texte tient entièrement, aucune bulle n'est affichée.
 */
export function TruncatedText({ text, className, as: Tag = 'p' }: TruncatedTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [tooltip, setTooltip] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const el = ref.current;
    // N'affiche la bulle que si le texte est réellement coupé
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const rect = el.getBoundingClientRect();
    const maxWidth = 420;
    setTooltip({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - maxWidth - 8)),
    });
  };

  return (
    <>
      <Tag
        ref={ref as never}
        className={clsx('truncate', className)}
        onMouseEnter={show}
        onMouseLeave={() => setTooltip(null)}
      >
        {text}
      </Tag>
      {tooltip && text
        ? createPortal(
            <div
              className="fixed z-[9999] max-w-[420px] rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-xl whitespace-pre-wrap break-words pointer-events-none"
              style={{ top: tooltip.top, left: tooltip.left }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
