import { readFileSync } from 'node:fs';
import { GameStore } from '../../src/core/game-store';
import type { RcgRecord } from '../../src/core/records';
import { loadRcgBytes, type LoadResult } from '../../src/io/load';
import type { ParseIssue } from '../../src/io/parse-types';

export const fixturePath = (name: string) => new URL(`../fixtures/${name}`, import.meta.url);

export const fixture = (name: string) => new Uint8Array(readFileSync(fixturePath(name)));

export interface Loaded {
  store: GameStore;
  result: LoadResult;
  warnings: ParseIssue[];
}

/** Loads a log the way the Worker does and applies it to a new GameStore. */
export async function loadBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Loaded> {
  const store = new GameStore();
  const warnings: ParseIssue[] = [];
  const result = await loadRcgBytes(bytes, {
    record: (r) => store.apply(r),
    warning: (w) => warnings.push(w),
  });
  return { store, result, warnings };
}

export const loadFixture = (name: string) => loadBytes(fixture(name));

/** Collects the records of a parser into an array. */
export function collect(run: (sink: (r: RcgRecord) => void) => void): RcgRecord[] {
  const out: RcgRecord[] = [];
  run((r) => out.push(r));
  return out;
}

/** Play modes of consecutive frames, collapsed: [first index, mode name][]. */
export function modeRuns(store: GameStore, names: readonly string[]): [number, string][] {
  const runs: [number, string][] = [];
  store.frames.forEach((f, i) => {
    const last = runs[runs.length - 1];
    if (!last || names[f.mode] !== last[1]) {
      runs.push([i, names[f.mode] ?? '?']);
    }
  });
  return runs;
}
