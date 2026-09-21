import { setImmediate } from 'node:timers/promises';

export async function bounded<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index]!, index);
      await setImmediate();
    }
  }));
}
