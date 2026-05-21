import { UnauthorizedError } from "./errors";

/**
 * Couche d'authentification de l'API.
 *
 * IMPORTANT — point d'évolution prévu (CLAUDE.md §4.3, séance S2) :
 * aujourd'hui l'auth n'est pas encore branchée (Auth.js arrive en S2). Cette
 * fonction est l'UNIQUE endroit qui décide « qui appelle ». Les routes appellent
 * `requireAuth()` sans rien savoir du mécanisme sous-jacent. En S2, on remplace
 * le corps de cette fonction par la vérification de session Auth.js — aucune route
 * ni service n'a besoin de changer.
 *
 * Tant que l'auth réelle n'est pas en place, on identifie l'admin unique seedé
 * via ADMIN_EMAIL. Si la variable est absente, l'accès est refusé (deny-by-default).
 */

export interface Actor {
  /** Email de l'admin, utilisé notamment comme `actor` dans audit_logs. */
  readonly email: string;
}

/**
 * Renvoie l'acteur courant ou `null` s'il n'est pas authentifié.
 * Ne lève jamais — à utiliser quand l'absence d'auth est un cas géré.
 */
export function getCurrentActor(): Actor | null {
  const email = process.env.ADMIN_EMAIL;
  if (!email) return null;
  return { email };
}

/**
 * Exige un acteur authentifié ; lève `UnauthorizedError` sinon.
 * À appeler en tête de chaque handler protégé.
 */
export function requireAuth(): Actor {
  const actor = getCurrentActor();
  if (!actor) {
    throw new UnauthorizedError();
  }
  return actor;
}
