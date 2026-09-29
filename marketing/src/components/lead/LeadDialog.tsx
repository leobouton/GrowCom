/**
 * Bouton « Recevoir ce calcul en PDF + le modèle de grille » et sa fenêtre (<dialog> natif :
 * focus piégé, touche Échap, fond assombri). Le formulaire n'est monté qu'à l'ouverture.
 */
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import type { AgencySaleSimulationResult } from '@shared/commission-engine';
import type { SimulatorState } from '../../simulator/state';

// Formulaire chargé seulement à l'ouverture de la fenêtre : rien ne pèse sur l'affichage du simulateur
const LeadForm = lazy(() => import('./LeadForm'));

interface Props {
  simulation: { state: SimulatorState; result: AgencySaleSimulationResult } | null;
}

export function LeadDialog({ simulation }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // Simulation figée à l'ouverture : le PDF correspond à ce que la personne a vu
  const [snapshot, setSnapshot] = useState(simulation);
  const titleId = useId();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const onClose = () => setOpen(false);
    node.addEventListener('close', onClose);
    return () => node.removeEventListener('close', onClose);
  }, []);

  const show = () => {
    setSnapshot(simulation);
    setOpen(true);
    dialog.current?.showModal();
  };

  return (
    <>
      <button type="button" onClick={show} disabled={!simulation} className="btn btn-primary w-full text-[0.95rem] disabled:opacity-50">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M5 2.5h5.5L14 6v9.5H5zM10 2.5V6h4M7.5 10.5l1.5 1.5 2.5-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Recevoir ce calcul en PDF + le modèle de grille
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={(event) => {
          // Clic sur le fond assombri : fermeture
          if (event.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto w-[min(34rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-[1.4rem] border border-line bg-card p-0 text-ink shadow-[var(--shadow-slip)] backdrop:bg-ink/55 backdrop:backdrop-blur-[2px]"
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Gratuit</p>
              <h2 id={titleId} className="display mt-3 text-[1.7rem] sm:text-[1.9rem]">
                Votre calcul en PDF <em>+ le modèle de grille.</em>
              </h2>
            </div>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label="Fermer"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong text-muted transition-colors hover:border-ink hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">
            Le détail de cette simulation, palier par palier, et un modèle de grille de commissionnement prêt à l’emploi (Excel qui
            calcule tout seul + PDF à annexer au contrat).
          </p>
          <div className="mt-6">
            {open && (
              <Suspense fallback={<p className="py-10 text-center text-[0.9rem] text-muted">Chargement du formulaire…</p>}>
                <LeadForm source="simulateur" simulation={snapshot} submitLabel="Recevoir mon calcul et le modèle" />
              </Suspense>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
