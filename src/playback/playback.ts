// The log player: current frame, play / stop, speed, loop, jumps
// (rcssmonitor src/log_player.cpp and the index handling of
// src/disp_holder.cpp).
//
// rcssmonitor steps one frame per QTimer timeout. Here the owner calls
// tick() from requestAnimationFrame with the current time, and as many
// frames as the elapsed time covers are stepped, so intervals shorter than
// a display frame (down to 5 ms) play at the right speed.
import type { GameStore } from '../core/game-store';

export const DEFAULT_INTERVAL = 100;
export const MIN_INTERVAL = 5;
export const MAX_INTERVAL = 5000;
/** Score jumps land this many frames before the goal. */
export const SCORE_JUMP_MARGIN = 50;
/** Longest time a single tick may account for (the tab was hidden, etc.). */
const MAX_TICK_MS = 250;

export interface PlaybackPosition {
  readonly index: number;
  /** Fraction of the way to the next frame while playing (0-1), for interpolation. */
  readonly alpha: number;
}

export class Playback {
  private storeValue: GameStore | null = null;
  private indexValue = 0;
  private playingValue = false;
  private intervalValue = DEFAULT_INTERVAL;
  private liveValue = false;
  private elapsed = 0;
  private lastTick: number | null = null;
  private readonly listeners = new Set<() => void>();

  /** The interval play() starts with (rcssmonitor's timer_interval option). */
  defaultInterval = DEFAULT_INTERVAL;
  /** Wrap around at both ends (rcssmonitor's auto_loop_mode). */
  loop = false;

  get store(): GameStore | null {
    return this.storeValue;
  }

  get index(): number {
    return this.indexValue;
  }

  get playing(): boolean {
    return this.playingValue;
  }

  /** Milliseconds per frame while playing. */
  get interval(): number {
    return this.intervalValue;
  }

  /** Following the newest frame of a live game. */
  get live(): boolean {
    return this.liveValue;
  }

  get frameCount(): number {
    return this.storeValue?.frameCount ?? 0;
  }

  position(): PlaybackPosition {
    return {
      index: this.indexValue,
      alpha: this.playingValue ? Math.min(1, this.elapsed / this.intervalValue) : 0,
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Shows a new game from its first frame, stopped, at the default speed. */
  setStore(store: GameStore | null): void {
    this.storeValue = store;
    this.indexValue = 0;
    this.playingValue = false;
    this.liveValue = false;
    this.intervalValue = this.defaultInterval;
    this.elapsed = 0;
    this.notify();
  }

  // ---- play / stop

  /** Plays forward. Restarts at the default speed if the speed was changed. */
  play(): void {
    this.liveValue = false;
    if (!this.playingValue || this.intervalValue !== this.defaultInterval) {
      this.playingValue = true;
      this.intervalValue = this.defaultInterval;
      this.elapsed = 0;
      this.lastTick = null;
    }
    this.notify();
  }

  stop(): void {
    this.liveValue = false;
    this.playingValue = false;
    this.notify();
  }

  togglePlay(): void {
    if (this.playingValue) {
      this.stop();
    } else {
      this.play();
    }
  }

  /** Halves the interval while playing (Ctrl+Up). */
  accelerate(): void {
    if (this.playingValue) {
      this.intervalValue = Math.max(MIN_INTERVAL, Math.trunc(this.intervalValue / 2));
      this.notify();
    }
  }

  /** Doubles the interval while playing (Ctrl+Down). */
  decelerate(): void {
    if (this.playingValue) {
      this.intervalValue = Math.min(MAX_INTERVAL, this.intervalValue * 2);
      this.notify();
    }
  }

  /**
   * Advances playback to `now` (milliseconds, e.g. the requestAnimationFrame
   * timestamp). Returns true if the frame changed.
   */
  tick(now: number): boolean {
    const last = this.lastTick;
    this.lastTick = now;
    if (!this.playingValue || last === null) {
      return false;
    }
    this.elapsed += Math.min(Math.max(0, now - last), MAX_TICK_MS);
    const before = this.indexValue;
    while (this.playingValue && this.elapsed >= this.intervalValue) {
      this.elapsed -= this.intervalValue;
      if (!this.stepForwardImpl()) {
        this.playingValue = false;
      }
    }
    if (!this.playingValue) {
      this.elapsed = 0;
    }
    const changed = this.indexValue !== before;
    if (changed || !this.playingValue) {
      this.notify();
    }
    return changed;
  }

  // ---- stepping (stops playback)

  stepForward(): void {
    this.liveValue = false;
    this.playingValue = false;
    this.stepForwardImpl();
    this.notify();
  }

  stepBackward(): void {
    this.liveValue = false;
    this.playingValue = false;
    this.stepBackwardImpl();
    this.notify();
  }

  goToFirst(): void {
    if (this.frameCount > 0) {
      this.liveValue = false;
      this.playingValue = false;
      this.indexValue = 0;
      this.notify();
    }
  }

  goToLast(): void {
    if (this.frameCount > 0) {
      this.liveValue = false;
      this.playingValue = false;
      this.indexValue = this.frameCount - 1;
      this.notify();
    }
  }

  // ---- jumps (keep playing)

  goToIndex(index: number): void {
    if (Number.isInteger(index) && index >= 0 && index < this.frameCount) {
      this.liveValue = false;
      if (index !== this.indexValue) {
        this.indexValue = index;
        this.notify();
      }
    }
  }

  /** Goes to the first frame of a cycle, or the next cycle after it. */
  goToCycle(cycle: number): boolean {
    const index = this.storeValue?.indexOfTime(cycle) ?? -1;
    if (index < 0) {
      return false;
    }
    this.goToIndex(index);
    return true;
  }

  /**
   * Goes to 50 frames before the previous goal (Ctrl+G). rcssmonitor records
   * the frame before the score changes; GameStore.scoreChanges has the frame
   * where it changes, hence the - 1, so that both land on the same frame.
   */
  goToPreviousScore(): void {
    const changes = this.storeValue?.scoreChanges ?? [];
    for (let k = changes.length - 1; k >= 0; --k) {
      const c = (changes[k] ?? 0) - 1;
      if (c < this.indexValue) {
        this.goToIndex(Math.max(0, c - SCORE_JUMP_MARGIN));
        return;
      }
    }
  }

  /** Goes to 50 frames before the next goal (G). */
  goToNextScore(): void {
    for (const change of this.storeValue?.scoreChanges ?? []) {
      const c = change - 1;
      // rcssmonitor compares unsigned values: a goal within the first 50
      // frames always counts as ahead.
      if (c < SCORE_JUMP_MARGIN || this.indexValue < c - SCORE_JUMP_MARGIN) {
        this.goToIndex(Math.max(0, c - SCORE_JUMP_MARGIN));
        return;
      }
    }
  }

  // ---- live mode (Phase 4)

  /** Follows the newest frame (Ctrl+L). */
  setLive(): void {
    this.playingValue = false;
    this.liveValue = true;
    if (this.frameCount > 0) {
      this.indexValue = this.frameCount - 1;
    }
    this.notify();
  }

  /** Call when frames were added; in live mode, moves to the newest one. */
  framesAdded(): void {
    if (this.liveValue && this.frameCount > 0 && this.indexValue !== this.frameCount - 1) {
      this.indexValue = this.frameCount - 1;
      this.notify();
    }
  }

  private stepForwardImpl(): boolean {
    const count = this.frameCount;
    if (count === 0) {
      return false;
    }
    if (this.indexValue < count - 1) {
      ++this.indexValue;
      return true;
    }
    if (this.loop) {
      this.indexValue = 0;
      return true;
    }
    return false;
  }

  private stepBackwardImpl(): boolean {
    const count = this.frameCount;
    if (count === 0) {
      return false;
    }
    if (this.indexValue > 0) {
      --this.indexValue;
      return true;
    }
    if (this.loop) {
      this.indexValue = count - 1;
      return true;
    }
    return false;
  }

  private notify(): void {
    for (const l of this.listeners) {
      l();
    }
  }
}
