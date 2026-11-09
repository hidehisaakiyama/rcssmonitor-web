import type { RecordSink } from '../core/records';

export interface ParseIssue {
  /** 1-based line number in the log, or 0 when not applicable. */
  readonly line: number;
  readonly message: string;
}

export interface ParseCallbacks {
  readonly record: RecordSink;
  readonly warning?: (issue: ParseIssue) => void;
  /** Called now and then with the fraction (0-1) of the input parsed so far. */
  readonly progress?: (fraction: number) => void;
}

export interface ParseStats {
  readonly lines: number;
  readonly records: number;
  readonly shows: number;
  readonly warnings: number;
}

/** Wraps the callbacks to count records, shows and warnings. */
export class ParseCounter {
  records = 0;
  shows = 0;
  warnings = 0;
  readonly sink: RecordSink;

  constructor(private readonly cb: ParseCallbacks) {
    this.sink = (r) => {
      ++this.records;
      if (r.type === 'show') {
        ++this.shows;
      }
      cb.record(r);
    };
  }

  warn(line: number, message: string): void {
    ++this.warnings;
    this.cb.warning?.({ line, message });
  }

  stats(lines: number): ParseStats {
    return { lines, records: this.records, shows: this.shows, warnings: this.warnings };
  }
}

/** Calls cb.progress at most every `step` characters. */
export function progressReporter(
  cb: ParseCallbacks,
  total: number,
  step = 1 << 20,
): (pos: number) => void {
  let next = step;
  return (pos) => {
    if (cb.progress && pos >= next) {
      next = pos + step;
      cb.progress(total > 0 ? pos / total : 1);
    }
  };
}
