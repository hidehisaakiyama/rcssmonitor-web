// The menu bar (rcssmonitor MainWindow::createMenus). A menu's items are
// built each time it opens, so that their enabled and checked states are
// current. With a menu open, moving the mouse over another title or pressing
// Left / Right opens that menu instead.
import { ContextMenu, type MenuItem } from './context-menu';

export interface MenuDef {
  /** The title button gets the id "menu-<id>", its list "menu-<id>-list". */
  readonly id: string;
  readonly label: string;
  readonly items: () => MenuItem[];
}

export class MenuBar {
  readonly element: HTMLElement;
  private readonly menu = new ContextMenu();
  private readonly buttons: HTMLButtonElement[] = [];
  private openIndex = -1;

  constructor(private readonly menus: readonly MenuDef[]) {
    this.element = document.createElement('nav');
    this.element.className = 'menubar';
    this.element.setAttribute('role', 'menubar');
    this.element.setAttribute('aria-label', 'Menu');
    menus.forEach((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menubar-item';
      b.id = `menu-${m.id}`;
      b.textContent = m.label;
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) {
          return;
        }
        e.preventDefault(); // keep the focus where it is
        if (this.openIndex === i) {
          this.close();
        } else {
          this.open(i, false);
        }
      });
      b.addEventListener('mouseenter', () => {
        if (this.openIndex >= 0 && this.openIndex !== i) {
          this.open(i, false);
        }
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          this.open(i, true);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          const n = this.buttons.length;
          this.buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n]?.focus();
        }
      });
      this.buttons.push(b);
      this.element.append(b);
    });
  }

  get isOpen(): boolean {
    return this.openIndex >= 0;
  }

  open(index: number, focusFirst: boolean): void {
    const def = this.menus[index];
    const button = this.buttons[index];
    if (!def || !button) {
      return;
    }
    this.openIndex = index;
    this.buttons.forEach((b, k) => b.setAttribute('aria-expanded', String(k === index)));
    const r = button.getBoundingClientRect();
    this.menu.show(def.items(), r.left, r.bottom, {
      id: `menu-${def.id}-list`,
      owner: this.element,
      focusFirst,
      onArrow: (d) => {
        const n = this.menus.length;
        this.open((index + d + n) % n, true);
      },
      onClose: () => {
        if (this.openIndex === index) {
          this.openIndex = -1;
          button.setAttribute('aria-expanded', 'false');
        }
      },
    });
  }

  close(): void {
    this.menu.close();
  }
}
