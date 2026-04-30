import { useEffect, useRef } from 'react';
import { useNavigation } from 'react-router-dom';

export function useFaviconSpin() {
  const navigation = useNavigation();
  const angleRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Pré-charger l'image favicon une seule fois
  useEffect(() => {
    const img = new Image();
    img.src = '/favicon.png';
    imgRef.current = img;
  }, []);

  useEffect(() => {
    const isLoading = navigation.state === 'loading';

    if (isLoading) {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (!ctx || !imgRef.current) return;

      const img = imgRef.current;

      const spin = () => {
        angleRef.current = (angleRef.current + 6) % 360;
        ctx.clearRect(0, 0, 32, 32);
        ctx.save();
        ctx.translate(16, 16);
        ctx.rotate((angleRef.current * Math.PI) / 180);
        ctx.drawImage(img, -16, -16, 32, 32);
        ctx.restore();

        // Mettre à jour le favicon
        let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = canvas.toDataURL('image/png');

        rafRef.current = requestAnimationFrame(spin);
      };

      // Attendre que l'image soit chargée
      if (img.complete) {
        rafRef.current = requestAnimationFrame(spin);
      } else {
        img.onload = () => { rafRef.current = requestAnimationFrame(spin); };
      }
    } else {
      // Arrêter l'animation et remettre le favicon original
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      angleRef.current = 0;
      const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (link) link.href = '/favicon.png';
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [navigation.state]);
}
