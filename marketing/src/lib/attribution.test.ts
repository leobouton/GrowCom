import { describe, it, expect } from 'vitest';
import { attributionParams, withAttribution, withoutAttribution } from './attribution';

const PAGE = 'https://growcom.fr/?utm_source=lemlist&utm_campaign=rentree&cid=A12';
const carried = attributionParams(new URL(PAGE).search);

describe('attributionParams', () => {
  it('ne garde que les paramètres de campagne connus', () => {
    expect(attributionParams('?utm_source=lemlist&utm_medium=email&prix=300000&cid=A12&autre=x')).toEqual([
      ['utm_source', 'lemlist'],
      ['utm_medium', 'email'],
      ['cid', 'A12'],
    ]);
    expect(attributionParams('')).toEqual([]);
  });
});

describe('withAttribution', () => {
  it('complète un lien interne', () => {
    expect(withAttribution('/simulateur-commission-negociateur-immobilier', carried, PAGE)).toBe(
      '/simulateur-commission-negociateur-immobilier?utm_source=lemlist&utm_campaign=rentree&cid=A12',
    );
  });

  it('garde les paramètres et l\'ancre déjà présents dans le lien', () => {
    expect(withAttribution('/blog/article?x=1#section', carried, PAGE)).toBe(
      '/blog/article?x=1&utm_source=lemlist&utm_campaign=rentree&cid=A12#section',
    );
    expect(withAttribution('/?utm_source=autre', carried, PAGE)).toBe('/?utm_source=autre&utm_campaign=rentree&cid=A12');
  });

  it('ne touche pas aux liens externes, emails, API, fichiers et ancres', () => {
    for (const href of [
      'https://www.legifrance.gouv.fr/x',
      'mailto:contact@growcom.fr',
      '/api/lead',
      '/modele/grille-de-commissionnement-growcom.xlsx',
      '/og/accueil.png',
      '#faq',
    ]) {
      expect(withAttribution(href, carried, PAGE)).toBeNull();
    }
  });

  it('sans paramètre de campagne : aucun lien modifié', () => {
    expect(withAttribution('/blog', [], 'https://growcom.fr/')).toBeNull();
  });
});

describe('withoutAttribution', () => {
  it('retire la campagne mais garde la simulation', () => {
    expect(withoutAttribution('https://growcom.fr/simulateur-commission-negociateur-immobilier?prix=300000&utm_source=lemlist&cid=A12')).toBe(
      'https://growcom.fr/simulateur-commission-negociateur-immobilier?prix=300000',
    );
  });
});
