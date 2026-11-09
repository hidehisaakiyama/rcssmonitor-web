import { App } from './ui/app';
import { scoreBoardText } from './view/hud/score-board';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app not found');
}
const app = new App(root);
app.applyUrlParams(new URLSearchParams(location.search));

// Hooks for the end-to-end tests and for debugging from the console.
declare global {
  interface Window {
    rcssmonitorWeb?: unknown;
  }
}
window.rcssmonitorWeb = {
  app,
  view: app.view,
  playback: app.playback,
  field: app.field,
  live: app.live,
  showFrame: (index: number) => app.playback.goToIndex(index),
  scoreBoard: () => (app.store ? scoreBoardText(app.store, app.field.frameIndex) : ''),
  renderNow: () => app.field.renderNow(),
};
