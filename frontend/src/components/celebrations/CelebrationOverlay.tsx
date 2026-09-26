/**
 * Étape 2 — Affichage des célébrations.
 *
 * - Toasts 🎉 en haut à droite quand une nouvelle victoire est détectée (commission
 *   validée, objectif atteint) ; disparaissent tout seuls.
 * - Une cloche 🔔 avec pastille « non lu » et un panneau listant les nouveautés.
 *
 * Toute la logique « qu'est-ce qui est nouveau ? » s'appuie sur localStorage
 * (voir utils/celebrations.ts) — aucun appel réseau, aucune base de données.
 */
import { useEffect, useRef, useState } from 'react';
import type { Win } from '../../utils/celebrations';
import { formatWinAmount, loadSeenWinIds, saveSeenWinIds } from '../../utils/celebrations';

const TOAST_DURATION_MS = 6000;

// Une victoire enrichie de son état de lecture (session courante).
type WinWithRead = Win & { unread: boolean };

function winEmoji(kind: Win['kind']): string {
  return kind === 'objective' ? '🎯' : '🎉';
}

function winHeadline(win: Win): string {
  return win.kind === 'objective' ? 'Objectif atteint !' : 'Commission validée !';
}

// ─── Un toast individuel (gère sa propre disparition) ─────────────────────────
function CelebrationToast({ win, onDismiss }: { win: Win; onDismiss: () => void }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Frame suivante : déclenche la transition d'entrée.
    const enter = requestAnimationFrame(() => setShown(true));
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS);
    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(timer);
    };
  }, [onDismiss]);

  const amount = formatWinAmount(win.amount);

  return (
    <div
      className={`pointer-events-auto w-80 rounded-2xl border border-green-200 bg-white shadow-xl shadow-green-900/10 p-4 flex items-start gap-3 transition-all duration-300 ${
        shown ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'
      }`}
      role="status"
    >
      <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0 text-xl">
        {winEmoji(win.kind)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-gray-900">{winHeadline(win)}</p>
        <p className="text-xs text-gray-500 truncate">{win.title}</p>
        {amount && <p className="text-sm font-bold text-green-600 mt-0.5">+{amount}</p>}
      </div>
      <button
        onClick={onDismiss}
        className="text-gray-300 hover:text-gray-500 flex-shrink-0"
        aria-label="Fermer"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Cloche + panneau d'historique ────────────────────────────────────────────
function WinsBell({ items, onOpen }: { items: WinWithRead[]; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const unread = items.filter((w) => w.unread).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) onOpen(); // marque comme lu à l'ouverture
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors"
        title="Mes bonnes nouvelles"
        aria-label="Mes bonnes nouvelles"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Voile de fermeture au clic extérieur */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl z-50">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">Mes bonnes nouvelles</p>
            </div>
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400">
                <p className="text-2xl mb-1">🎉</p>
                <p className="text-sm">Vos prochaines commissions validées et objectifs atteints s'afficheront ici.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {items.map((win) => {
                  const amount = formatWinAmount(win.amount);
                  return (
                    <li key={win.id} className={`px-4 py-3 flex items-start gap-3 ${win.unread ? 'bg-green-50/40' : ''}`}>
                      <span className="text-lg flex-shrink-0">{winEmoji(win.kind)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800">{winHeadline(win)}</p>
                        <p className="text-xs text-gray-500 truncate">{win.title}</p>
                      </div>
                      {amount && <span className="text-sm font-bold text-green-600 flex-shrink-0">+{amount}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Point d'entrée. Reçoit l'utilisateur et la liste courante des victoires détectées.
 * Détermine les nouveautés (vs localStorage), déclenche les toasts, alimente la cloche.
 */
export function CelebrationOverlay({ userId, wins }: { userId: string; wins: Win[] }) {
  const [toasts, setToasts] = useState<Win[]>([]);
  const [history, setHistory] = useState<WinWithRead[]>([]);
  // Ids déjà traités durant CETTE session (évite de re-fêter au re-render / reload).
  const processedRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!userId) return;

    // Initialisation à la première exécution de la session.
    if (processedRef.current === null) {
      const seen = loadSeenWinIds(userId);
      if (seen === null) {
        // Toute première visite : on ensemence en silence, aucune fête.
        processedRef.current = new Set(wins.map((w) => w.id));
        saveSeenWinIds(userId, wins.map((w) => w.id));
        // On alimente quand même l'historique (tout marqué « lu »).
        setHistory(wins.map((w) => ({ ...w, unread: false })));
        return;
      }
      processedRef.current = new Set(seen);
    }

    const fresh = wins.filter((w) => !processedRef.current!.has(w.id));
    if (fresh.length > 0) {
      fresh.forEach((w) => processedRef.current!.add(w.id));
      saveSeenWinIds(userId, Array.from(processedRef.current!));
      setToasts((prev) => [...prev, ...fresh]);
      setHistory((prev) => [
        ...fresh.map((w) => ({ ...w, unread: true })),
        ...prev.filter((h) => !fresh.some((f) => f.id === h.id)),
      ]);
    } else if (history.length === 0) {
      // Pas de nouveauté mais on veut un historique récent dans la cloche.
      setHistory(wins.map((w) => ({ ...w, unread: false })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wins, userId]);

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const markAllRead = () => setHistory((prev) => prev.map((h) => ({ ...h, unread: false })));

  return (
    <>
      <WinsBell items={history} onOpen={markAllRead} />

      {/* Pile de toasts, ancrée en haut à droite de l'écran */}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-3 pointer-events-none">
        {toasts.slice(-4).map((win) => (
          <CelebrationToast key={win.id} win={win} onDismiss={() => dismissToast(win.id)} />
        ))}
      </div>
    </>
  );
}
