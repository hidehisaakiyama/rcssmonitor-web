// A pop-up menu at the mouse, like QMenu::exec, with one level of submenus;
// also the drop-down menus of the menu bar. Arrow keys move between the
// items and into / out of a submenu; Escape, a click elsewhere or leaving
// the window closes it.

export type MenuItem =
  | {
      readonly kind?: 'item';
      readonly id?: string;
      readonly label: string;
      readonly action: () => void;
      readonly disabled?: boolean;
      readonly title?: string;
      /** A check box item when set. */
      readonly checked?: boolean;
      /** Shown on the right, e.g. "Ctrl+O". */
      readonly shortcut?: string;
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

/** A menu item that runs an action. */
export type ActionItem = Extract<MenuItem, { readonly action: () => void }>;

export interface MenuOptions {
  /** Default "context-menu". */
  readonly id?: string;
  /** Pointer presses in it do not close the menu (the menu bar handles them). */
  readonly owner?: HTMLElement;
  /** Called with -1 / +1 for Left / Right in the top level (to move along the menu bar). */
  readonly onArrow?: (direction: -1 | 1) => void;
  readonly onClose?: () => void;
  /** Focus the first item, as when opened from the keyboard. */
  readonly focusFirst?: boolean;
}

export class ContextMenu {
  private root: HTMLElement | null = null;
  private options: MenuOptions = {};
  private restoreFocus: HTMLElement | null = null;
  private readonly onPointerDown = (e: PointerEvent) => {
    const target = e.target as Node;
    if (this.root && !this.root.contains(target) && !this.options.owner?.contains(target)) {
      this.close();
    }
  };
  private readonly onClose = () => this.close();

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Opens the menu with its top left at the client coordinates. */
  show(
    items: readonly MenuItem[],
    clientX: number,
    clientY: number,
    options: MenuOptions = {},
  ): void {
    const restore = this.root ? this.restoreFocus : null;
    this.close(false);
    this.options = options;
    this.restoreFocus =
      restore ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const root = this.buildMenu(items);
    root.id = options.id ?? 'context-menu';
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
    // With every item disabled, the menu itself takes the keys.
    (options.focusFirst ? (this.items(root)[0] ?? root) : root).focus();
  }

  /** Closes the menu; `restoreFocus` false keeps the focus (another menu opens). */
  close(restoreFocus = true): void {
    if (!this.root) {
      return;
    }
    this.root.remove();
    this.root = null;
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('blur', this.onClose);
    window.removeEventListener('resize', this.onClose);
    window.removeEventListener('wheel', this.onClose);
    const onClose = this.options.onClose;
    this.options = {};
    if (restoreFocus) {
      this.restoreFocus?.focus({ preventScroll: true });
      this.restoreFocus = null;
    }
    onClose?.();
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
        const b = this.button(item.label, item.id, item.disabled, item.title, item.shortcut);
        if (item.checked !== undefined) {
          b.setAttribute('role', 'menuitemcheckbox');
          b.setAttribute('aria-checked', String(item.checked));
        }
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

  private button(
    label: string,
    id?: string,
    disabled?: boolean,
    title?: string,
    shortcut?: string,
  ) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    b.setAttribute('role', 'menuitem');
    b.tabIndex = -1;
    const text = document.createElement('span');
    text.className = 'menu-label';
    text.textContent = label;
    b.append(text);
    if (shortcut) {
      const key = document.createElement('span');
      key.className = 'menu-shortcut';
      key.textContent = shortcut;
      b.append(key);
      b.setAttribute('aria-keyshortcuts', shortcut.replace(/⌃/g, 'Control+'));
    }
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
        e.preventDefault();
        if (active?.parentElement?.classList.contains('menu-submenu')) {
          this.openSubmenu(active.parentElement, true);
        } else {
          this.options.onArrow?.(1);
        }
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        const wrapper = menu.parentElement;
        if (wrapper?.classList.contains('menu-submenu')) {
          menu.hidden = true;
          const b = wrapper.firstElementChild as HTMLElement;
          b.setAttribute('aria-expanded', 'false');
          b.focus();
        } else {
          this.options.onArrow?.(-1);
        }
        break;
      }
    }
  }
}
