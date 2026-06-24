import crypto from 'crypto';

/**
 * Vérifie si un mot de passe a été compromis via l'API HaveIBeenPwned (k-Anonymity).
 * Seuls les 5 premiers caractères du SHA-1 sont envoyés — le mot de passe ne quitte jamais le serveur.
 *
 * Politique fail-open : si l'API est indisponible (réseau, timeout), on laisse passer.
 * Si un match est trouvé, on retourne le nombre d'occurrences.
 */
export async function checkPasswordCompromised(password: string): Promise<{ compromised: boolean; count: number }> {
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'User-Agent': 'GrowCom-Security-Check' },
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      // API indisponible → fail-open
      return { compromised: false, count: 0 };
    }

    const body = await response.text();
    const lines = body.split('\n');

    for (const line of lines) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === suffix) {
        return { compromised: true, count: parseInt(countStr, 10) };
      }
    }

    return { compromised: false, count: 0 };
  } catch {
    // Erreur réseau, timeout, etc. → fail-open
    return { compromised: false, count: 0 };
  }
}
