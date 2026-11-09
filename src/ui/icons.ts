// Tool bar icons: 16 x 16 SVG drawn with currentColor.

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${body}</svg>`;

const text = (s: string, size = 7) =>
  `<text x="8" y="11" text-anchor="middle" font-size="${size}" font-weight="bold" ` +
  `font-family="sans-serif" fill="currentColor">${s}</text>`;

export const ICONS = {
  open: svg(
    '<path d="M1.5 4.5v8h12l1-6h-9l-1 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' +
      '<path d="M1.5 4.5v-1h4l1 1h6v2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  ),
  // A plug in its socket, and pulled out.
  connect: svg(
    '<path d="M0.5 8h2M7.5 6.5h3M7.5 9.5h3" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
      '<rect x="2.5" y="4.5" width="5" height="7" rx="1" fill="currentColor"/>' +
      '<path d="M10.5 3.5h4v9h-4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  ),
  disconnect: svg(
    '<path d="M0.5 8h1M6.5 6.5h2M6.5 9.5h2" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
      '<rect x="1.5" y="4.5" width="5" height="7" rx="1" fill="currentColor"/>' +
      '<path d="M11 3.5h3.5v9H11" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  ),
  // A ball.
  kickOff: svg(
    '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M8 5.2l2.6 1.9-1 3.1H6.4l-1-3.1z" fill="currentColor"/>' +
      '<path d="M8 5.2V2M10.6 7.1l3-1M9.6 10.2l1.9 2.6M6.4 10.2l-1.9 2.6M5.4 7.1l-3-1" ' +
      'fill="none" stroke="currentColor" stroke-width="1"/>',
  ),
  live: svg(text('LIVE', 6)),
  play: svg('<path d="M4.5 2.5v11l9-5.5z" fill="currentColor"/>'),
  stop: svg('<rect x="3.5" y="3.5" width="9" height="9" fill="currentColor"/>'),
  stepBackward: svg(
    '<rect x="2.5" y="3" width="2" height="10" fill="currentColor"/><path d="M13.5 3v10l-7-5z" fill="currentColor"/>',
  ),
  stepForward: svg(
    '<rect x="11.5" y="3" width="2" height="10" fill="currentColor"/><path d="M2.5 3v10l7-5z" fill="currentColor"/>',
  ),
  decelerate: svg(
    '<path d="M3.5 4.5l4.5 4 4.5-4M3.5 8.5l4.5 4 4.5-4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  ),
  accelerate: svg(
    '<path d="M3.5 11.5l4.5-4 4.5 4M3.5 7.5l4.5-4 4.5 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  ),
  previousScore: svg(
    '<path d="M6 3.5v9l-5-4.5z" fill="currentColor"/><text x="11.5" y="12" text-anchor="middle" font-size="9" font-weight="bold" font-family="sans-serif" fill="currentColor">G</text>',
  ),
  nextScore: svg(
    '<path d="M1 3.5v9l5-4.5z" fill="currentColor"/><text x="11.5" y="12" text-anchor="middle" font-size="9" font-weight="bold" font-family="sans-serif" fill="currentColor">G</text>',
  ),
  loop: svg(
    '<path d="M3 7.5a5 5 0 0 1 9-2.5M13 8.5a5 5 0 0 1-9 2.5" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M12.8 2.2v3.3h-3.3M3.2 13.8v-3.3h3.3" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  ),
} as const;

export type IconName = keyof typeof ICONS;
