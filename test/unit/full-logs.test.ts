// Full-length game logs, for correctness and load time. They are not in the
// repository: put them (or links to them) in test/fixtures/full/ to run this.
//   test/fixtures/full/1-json.rcg.gz
//   test/fixtures/full/202207160432-HELIOS2022_1-vs-CYRUS_0.rcg.gz
// The expected show counts are those of the files the fixtures were cut from.
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fixturePath, loadBytes } from './helpers';

const LOGS = [
  { name: '1-json.rcg.gz', shows: 6209, last: 6000 },
  { name: '202207160432-HELIOS2022_1-vs-CYRUS_0.rcg.gz', shows: 8406, last: 8000 },
];

for (const log of LOGS) {
  const path = fixturePath(`full/${log.name}`);
  describe.skipIf(!existsSync(path))(`full log ${log.name}`, () => {
    it('has one frame per show record', { timeout: 60_000 }, async () => {
      const bytes = new Uint8Array(readFileSync(path));
      const text = gunzipSync(bytes).toString('utf8');
      const showLines = text.match(/^(\{"show"|\(show )/gm)?.length ?? 0;
      expect(showLines).toBe(log.shows);

      globalThis.gc?.();
      const heapBefore = process.memoryUsage().heapUsed;
      const started = performance.now();
      const { store, warnings } = await loadBytes(bytes);
      const ms = performance.now() - started;
      globalThis.gc?.();
      const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20;

      expect(warnings).toEqual([]);
      expect(store.frameCount).toBe(log.shows);
      expect(store.lastFrame?.time).toBe(log.last);
      for (const g of store.teamGraphics) {
        expect(g.isEmpty() || g.isComplete()).toBe(true);
      }
      console.log(
        `${log.name}: ${store.frameCount} frames in ${Math.round(ms)} ms, ` +
          `heap +${heapMb.toFixed(0)} MB${globalThis.gc ? '' : ' (no --expose-gc: rough)'}`,
      );
    });
  });
}
