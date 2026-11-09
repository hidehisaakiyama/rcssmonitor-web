// The log player tool bar (rcssmonitor MainWindow::createToolBars and
// src/log_player_slider.cpp), plus a cycle input that rcssmonitor lacks.
import type { Frame } from '../core/frame';
import { ICONS, type IconName } from './icons';

export interface ToolbarActions {
  open(): void;
  live(): void;
  togglePlay(): void;
  stepBackward(): void;
  stepForward(): void;
  decelerate(): void;
  accelerate(): void;
  previousScore(): void;
  nextScore(): void;
  toggleLoop(): void;
  seek(index: number): void;
  /** Returns false if the log has no such cycle. */
  goToCycle(cycle: number): boolean;
}

export interface ToolbarState {
  readonly frameCount: number;
  readonly index: number;
  readonly frame: Frame | undefined;
  readonly playing: boolean;
  readonly interval: number;
  readonly loop: boolean;
  readonly live: boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const CTRL = isMac ? '⌘' : 'Ctrl+';

/** "1746" or "1746.3" when stopped time advances. */
export function cycleLabel(frame: Frame): string {
  return frame.stime > 0 ? `${frame.time}.${frame.stime}` : String(frame.time);
}

export class Toolbar {
  readonly element: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly slider: HTMLInputElement;
  private readonly frameLabel: HTMLSpanElement;
  private readonly cycleInput: HTMLInputElement;
  private readonly speedLabel: HTMLSpanElement;

  constructor(private readonly actions: ToolbarActions) {
    const el = (tag: string, cls = '') => {
      const e = document.createElement(tag);
      if (cls) {
        e.className = cls;
      }
      return e;
    };
    this.element = el('header', 'toolbar');
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Log player');

    const group = () => {
      const g = el('div', 'toolbar-group');
      this.element.append(g);
      return g;
    };

    let g = group();
    g.append(this.button('open', 'open', `Open a game log (${CTRL}O)`, () => actions.open()));

    g = group();
    g.append(
      this.button('live', 'live', `Live mode (${CTRL}L)`, () => actions.live()),
      this.button('play', 'play', 'Play / stop (Space)', () => actions.togglePlay()),
      this.button('step-backward', 'stepBackward', 'One step backward (←)', () =>
        actions.stepBackward(),
      ),
      this.button('step-forward', 'stepForward', 'One step forward (→)', () =>
        actions.stepForward(),
      ),
      this.button('decelerate', 'decelerate', `Slower (${CTRL}↓)`, () => actions.decelerate()),
      this.button('accelerate', 'accelerate', `Faster (${CTRL}↑)`, () => actions.accelerate()),
      this.button('prev-score', 'previousScore', `Previous goal (${CTRL}G)`, () =>
        actions.previousScore(),
      ),
      this.button('next-score', 'nextScore', 'Next goal (G)', () => actions.nextScore()),
      this.button('loop', 'loop', 'Loop playback', () => actions.toggleLoop()),
    );

    this.slider = document.createElement('input');
    Object.assign(this.slider, {
      type: 'range',
      id: 'frame-slider',
      min: '0',
      max: '0',
      value: '0',
    });
    this.slider.disabled = true;
    this.slider.setAttribute('aria-label', 'Frame');
    this.slider.addEventListener('input', () => actions.seek(Number(this.slider.value)));

    this.frameLabel = el('span', 'frame-label') as HTMLSpanElement;
    this.frameLabel.id = 'frame-label';

    this.cycleInput = document.createElement('input');
    Object.assign(this.cycleInput, {
      type: 'text',
      id: 'cycle-input',
      inputMode: 'numeric',
      placeholder: 'cycle',
      size: 6,
      disabled: true,
    });
    this.cycleInput.setAttribute('aria-label', 'Go to cycle');
    this.cycleInput.title = 'Go to a cycle (Enter)';
    this.cycleInput.addEventListener('keydown', (e) => this.cycleKey(e));

    this.speedLabel = el('span', 'speed-label') as HTMLSpanElement;
    this.speedLabel.id = 'speed-label';
    this.speedLabel.title = 'Time per frame while playing';

    const sliderGroup = el('div', 'toolbar-group toolbar-slider');
    sliderGroup.append(this.slider, this.frameLabel);
    this.element.append(sliderGroup);
    g = group();
    g.append(this.cycleInput, this.speedLabel);
  }

  update(s: ToolbarState): void {
    const has = s.frameCount > 0;
    for (const [name, b] of this.buttons) {
      if (name !== 'open') {
        b.disabled = !has;
      }
    }
    this.slider.disabled = !has;
    this.cycleInput.disabled = !has;
    this.slider.max = String(Math.max(0, s.frameCount - 1));
    this.slider.value = String(s.index);

    const play = this.buttons.get('play');
    if (play) {
      play.innerHTML = s.playing ? ICONS.stop : ICONS.play;
      play.setAttribute('aria-pressed', String(s.playing));
    }
    this.buttons.get('loop')?.setAttribute('aria-pressed', String(s.loop));
    this.buttons.get('live')?.setAttribute('aria-pressed', String(s.live));

    this.frameLabel.textContent =
      has && s.frame ? `${cycleLabel(s.frame)} (${s.index + 1} / ${s.frameCount})` : '';
    this.speedLabel.textContent = has ? `${s.interval} ms` : '';
  }

  private button(
    id: string,
    icon: IconName,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `${id}-button`;
    b.className = 'tool-button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = ICONS[icon];
    // Keep the keyboard focus where it was, so that Space and the arrow
    // keys keep controlling the player after a click.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    this.buttons.set(id, b);
    return b;
  }

  private cycleKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      this.cycleInput.blur();
      return;
    }
    if (e.key !== 'Enter') {
      return;
    }
    const cycle = Number(this.cycleInput.value.trim());
    if (
      this.cycleInput.value.trim() !== '' &&
      Number.isInteger(cycle) &&
      this.actions.goToCycle(cycle)
    ) {
      this.cycleInput.classList.remove('invalid');
      this.cycleInput.value = '';
      this.cycleInput.blur();
    } else {
      this.cycleInput.classList.add('invalid');
    }
  }
}
