// A pop-up menu at the mouse, like QMenu::exec, with one level of submenus.
// Arrow keys move between the items and into / out of a submenu; Escape,
// a click elsewhere or leaving the window closes it.

export type MenuItem =
  | {
      readonly kind?: 'item';
      readonly id?: string;
      readonly label: string;
      readonly action: () => void;
      readonly disabled?: boolean;
      readonly title?: string;
    }
  | { readonly kind: 'separator' }
  | {
      readonly kind: 'submenu';
      readonly id?: string;
      readonly label: string;
      readonly items: readonly MenuItem[];
      readonly disabled?: boolean;
      readonly title?: string;
    };

export class ContextMenu {
  private root: HTMLElement | null = null;
  private restoreFocus: HTMLElement | null = null;
  private readonly onPointerDown = (e: PointerEvent) => {
    if (this.root && !this.root.contains(e.target as Node)) {
      this.close();
    }
  };
  private readonly onClose = () => this.close();

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Opens the menu with its top left at the client coordinates. */
  show(items: readonly MenuItem[], clientX: number, clientY: number): void {
    this.close();
    this.restoreFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = this.buildMenu(items);
    root.id = 'context-menu';
    root.addEventListener('keydown', (e) => this.key(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(root);
    this.root = root;

    // Keep the menu inside the window.
    const r = root.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX, window.innerWidth - r.width));
    const y = Math.max(0, Math.min(clientY, window.innerHeight - r.height));
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;

    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('blur', this.onClose);
    window.addEventListener('resize', this.onClose);
    window.addEventListener('wheel', this.onClose, { passive: true });
    root.focus();
  }

  close(): void {
    if (!this.root) {
      return;
    }
    this.root.remove();
    this.root = null;
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('blur', this.onClose);
    window.removeEventListener('resize', this.onClose);
    window.removeEventListener('wheel', this.onClose);
    this.restoreFocus?.focus({ preventScroll: true });
    this.restoreFocus = null;
  }

  private buildMenu(items: readonly MenuItem[]): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;
    for (const item of items) {
      if (item.kind === 'separator') {
        const s = document.createElement('div');
        s.className = 'menu-separator';
        s.setAttribute('role', 'separator');
        menu.append(s);
      } else if (item.kind === 'submenu') {
        menu.append(this.buildSubmenu(item));
      } else {
        const b = this.button(item.label, item.id, item.disabled, item.title);
        b.addEventListener('click', () => {
          this.close();
          item.action();
        });
        b.addEventListener('mouseenter', () => this.closeSubmenus(menu));
        menu.append(b);
      }
    }
    return menu;
  }

  private buildSubmenu(item: Extract<MenuItem, { kind: 'submenu' }>): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'menu-submenu';
    const b = this.button(item.label, item.id, item.disabled, item.title);
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    const sub = this.buildMenu(item.items);
    sub.hidden = true;
    wrapper.append(b, sub);
    if (!item.disabled) {
      b.addEventListener('mouseenter', () => this.openSubmenu(wrapper, false));
      b.addEventListener('click', () => this.openSubmenu(wrapper, true));
    }
    return wrapper;
  }

  private button(label: string, id?: string, disabled?: boolean, title?: string) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    b.textContent = label;
    if (id) {
      b.id = id;
    }
    if (disabled) {
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
    }
    if (title) {
      b.title = title;
    }
    return b;
  }

  private openSubmenu(wrapper: HTMLElement, focusFirst: boolean): void {
    const parentMenu = wrapper.parentElement;
    if (parentMenu) {
      this.closeSubmenus(parentMenu, wrapper);
    }
    const b = wrapper.firstElementChild as HTMLElement;
    const sub = wrapper.lastElementChild as HTMLElement;
    if (sub.hidden) {
      sub.hidden = false;
      b.setAttribute('aria-expanded', 'true');
      // To the right of the item, or to the left if there is no room; moved
      // up if it would go below the window.
      const item = b.getBoundingClientRect();
      const r = sub.getBoundingClientRect();
      const left = item.right + r.width <= window.innerWidth ? item.right : item.left - r.width;
      const top = Math.max(0, Math.min(item.top - 4, window.innerHeight - r.height));
      const base = wrapper.getBoundingClientRect();
      sub.style.left = `${left - base.left}px`;
      sub.style.top = `${top - base.top}px`;
    }
    if (focusFirst) {
      this.items(sub)[0]?.focus();
    }
  }

  private closeSubmenus(menu: HTMLElement, except?: HTMLElement): void {
    for (const w of menu.querySelectorAll<HTMLElement>(':scope > .menu-submenu')) {
      if (w !== except) {
        (w.lastElementChild as HTMLElement).hidden = true;
        w.firstElementChild?.setAttribute('aria-expanded', 'false');
      }
    }
  }

  /** The enabled items of one menu level. */
  private items(menu: HTMLElement): HTMLButtonElement[] {
    return [
      ...menu.querySelectorAll<HTMLButtonElement>(
        ':scope > .menu-item:not(:disabled), :scope > .menu-submenu > .menu-item:not(:disabled)',
      ),
    ];
  }

  private key(e: KeyboardEvent): void {
    // The player and view keys do not apply while the menu is open.
    e.stopPropagation();
    const active = document.activeElement as HTMLElement | null;
    const menu = active?.closest<HTMLElement>('.context-menu') ?? this.root;
    if (!menu) {
      return;
    }
    const items = this.items(menu);
    const i = active ? items.indexOf(active as HTMLButtonElement) : -1;
    switch (e.key) {
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        items[(i + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        items[(i - 1 + items.length) % items.length]?.focus();
        break;
      case 'ArrowRight':
        if (active?.parentElement?.classList.contains('menu-submenu')) {
          e.preventDefault();
          this.openSubmenu(active.parentElement, true);
        }
        break;
      case 'ArrowLeft': {
        const wrapper = menu.parentElement;
        if (wrapper?.classList.contains('menu-submenu')) {
          e.preventDefault();
          menu.hidden = true;
          const b = wrapper.firstElementChild as HTMLElement;
          b.setAttribute('aria-expanded', 'false');
          b.focus();
        }
        break;
      }
    }
  }
}
