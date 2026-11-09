// Helpers for the modal dialogs (<dialog> with a method="dialog" form).

/** Creates an element with a class and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) {
    e.className = className;
  }
  if (text) {
    e.textContent = text;
  }
  return e;
}

export interface FormDialog {
  readonly dialog: HTMLDialogElement;
  readonly form: HTMLFormElement;
  /** The button row; the default button is the last. */
  readonly buttons: HTMLElement;
  readonly ok: HTMLButtonElement;
}

/**
 * A dialog with a title, a form and Cancel / OK buttons. OK submits the
 * form, which closes the dialog with returnValue "ok".
 */
export function formDialog(id: string, title: string, okLabel: string): FormDialog {
  const dialog = el('dialog', 'dialog');
  dialog.id = id;
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const form = el('form');
  form.method = 'dialog';
  const heading = el('h2', 'dialog-title', title);
  heading.id = `${id}-title`;

  const buttons = el('div', 'dialog-buttons');
  const cancel = el('button', 'dialog-button', 'Cancel');
  cancel.type = 'submit';
  cancel.value = 'cancel';
  cancel.formNoValidate = true;
  const ok = el('button', 'dialog-button default', okLabel);
  ok.type = 'submit';
  ok.value = 'ok';
  ok.id = `${id}-ok`;
  buttons.append(cancel, ok);

  form.append(heading, buttons);
  dialog.append(form);
  return { dialog, form, buttons, ok };
}

/**
 * Shows the dialog modally in `parent` and resolves when it closes: with
 * `accept()` if it closed by OK, null otherwise. The dialog is removed.
 */
export function runDialog<T>(
  parent: HTMLElement,
  d: FormDialog,
  accept: () => T | null,
): Promise<T | null> {
  return new Promise((resolve) => {
    d.dialog.addEventListener('close', () => {
      const result = d.dialog.returnValue === 'ok' ? accept() : null;
      d.dialog.remove();
      resolve(result);
    });
    parent.append(d.dialog);
    d.dialog.returnValue = '';
    d.dialog.showModal();
  });
}

/** A labelled form row. */
export function row(label: string, control: HTMLElement, hint = ''): HTMLElement {
  const r = el('div', 'dialog-row');
  const l = el('label', '', label);
  if (control.id) {
    l.htmlFor = control.id;
  }
  r.append(l, control);
  if (hint) {
    r.append(el('span', 'dialog-hint', hint));
  }
  return r;
}
