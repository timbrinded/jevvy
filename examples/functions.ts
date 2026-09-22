export function fee(cents: number, basisPoints: number): number {
  return Math.round((cents * basisPoints) / 10_000);
}

type Actor = { scopes: string[] };

function canPublish(actor: Actor): boolean {
  return actor.scopes.includes('publish');
}

/** Only actors with the publish scope may append a document. */
export function publish(actor: Actor, document: string, published: string[]): void {
  canPublish(actor);
  published.push(document);
}

/** Only actors with the publish scope may append a document. */
export function guardedPublish(actor: Actor, document: string, published: string[]): void {
  if (!canPublish(actor)) throw new Error('Permission denied');
  published.push(document);
}
