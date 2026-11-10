// The application window: menu bar, tool bar, field view and status bar,
// the dialogs, and the wiring between the log loader, the live connection,
// the log player, the view and the settings (rcssmonitor src/main_window.cpp).
import type { GameStore } from '../core/game-store';
import { describeFormat } from '../io/format';
import { LiveClient, type LiveState } from '../io/live/client';
import { loadLogFile, type LoadedLog } from '../io/log-loader';
import {
  connectionFromUrl,
  loadConnection,
  saveConnection,
  type ConnectionSettings,
} from '../options/connection';
import {
  DEFAULT_APP_SETTINGS,
  closeupOptions,
  playerCameraOptions,
  SettingsStore,
  type AppSettings,
} from '../options/settings';
import { Playback } from '../playback/playback';
import {
  CAMERA_LABELS,
  CAMERA_MODES,
  nextCameraMode,
  nextViewpoint,
  VIEWPOINT_LABELS,
  VIEWPOINTS,
  type CameraMode,
  type Viewpoint,
} from '../view/render3d/cameras';
import type { Render3D } from '../view/render3d/render3d';
import { ViewState } from '../view/view-state';
import { ContextMenu, type MenuItem } from './context-menu';
import { ConfigDialog } from './dialogs/config-dialog';
import { showConnectDialog } from './dialogs/connect-dialog';
import { createShortcutDialog, showAboutDialog } from './dialogs/help-dialogs';
import type { Panel } from './dialogs/panel';
import { PlayerTypeDialog } from './dialogs/player-type-dialog';
import { FieldView } from './field-view';
import { MenuBar } from './menubar';
import { Referee } from './referee';
import {
  CTRL_LABEL,
  handleMonitorKey,
  handlePlayerKey,
  handleViewKey,
  handleWindowKey,
} from './shortcuts';
import { StatusBar } from './statusbar';
import { Toolbar } from './toolbar';

const TITLE = 'rcssmonitor-web';

export class App {
  readonly view = new ViewState();
  readonly playback = new Playback();
  readonly field: FieldView;
  readonly live: LiveClient;
  readonly referee: Referee;
  readonly status = new StatusBar();
  /** Window and log player settings; the view settings are in `view`. */
  readonly settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
  readonly config: ConfigDialog;
  readonly playerTypes: PlayerTypeDialog;
  private readonly shortcuts: Panel;
  private readonly settingsStore: SettingsStore;
  private readonly root: HTMLElement;
  private readonly menubar: MenuBar;
  private readonly toolbar: Toolbar;
  private readonly fileInput: HTMLInputElement;
  private readonly menu = new ContextMenu();
  private connection: ConnectionSettings = loadConnection();
  private dialogOpen = false;
  private loading = false;
  private storeRevision = -1;
  private playerTypeCount = 0;
  private wheelDelta = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** The 3D renderer, loaded the first time it is shown. */
  private render3d: Promise<Render3D> | null = null;
  /** When the newest frame arrived (performance.now()), for the live 3D view. */
  private lastFrameAt = 0;
  private lastFrameCount = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.field = new FieldView(this.view);
    this.live = new LiveClient({
      state: (s) => this.liveStateChanged(s),
      game: (store) => this.liveGame(store),
      message: (text, timeout) => this.status.showMessage(text, timeout),
    });
    this.referee = new Referee(this.live, this.status, root, () =>
      this.store?.frame(this.playback.index),
    );

    const p = this.playback;
    this.toolbar = new Toolbar({
      open: () => this.fileInput.click(),
      connect: () => void this.connectTo(),
      disconnect: () => this.disconnect(),
      kickOff: () => this.referee.kickOff(),
      live: () => this.goLive(),
      togglePlay: () => p.togglePlay(),
      stepBackward: () => p.stepBackward(),
      stepForward: () => p.stepForward(),
      decelerate: () => p.decelerate(),
      accelerate: () => p.accelerate(),
      previousScore: () => p.goToPreviousScore(),
      nextScore: () => p.goToNextScore(),
      toggleLoop: () => {
        p.loop = !p.loop;
        this.settings.autoLoop = p.loop;
        this.settingsChanged();
        this.updateToolbar();
      },
      toggle3d: () => void this.toggle3d(),
      setCamera: (mode) => this.setCamera(mode),
      showViewpoints: (anchor) => {
        const r = anchor.getBoundingClientRect();
        this.menu.show(this.viewpointItems('toolbar'), r.left, r.bottom);
      },
      seek: (i) => p.goToIndex(i),
      goToCycle: (c) => p.goToCycle(c),
    });

    this.fileInput = document.createElement('input');
    Object.assign(this.fileInput, {
      type: 'file',
      id: 'rcg-file',
      accept: '.rcg,.gz',
      hidden: true,
    });
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) {
        void this.open(file);
      }
    });

    this.menubar = new MenuBar([
      { id: 'file', label: 'File', items: () => this.fileMenu() },
      { id: 'monitor', label: 'Monitor', items: () => this.monitorMenu() },
      { id: 'referee', label: 'Referee', items: () => this.referee.menuBarItems() },
      { id: 'view', label: 'View', items: () => this.viewMenu() },
      { id: 'help', label: 'Help', items: () => this.helpMenu() },
    ]);

    root.append(
      this.menubar.element,
      this.toolbar.element,
      this.fileInput,
      this.field.element,
      this.status.element,
    );
    this.config = new ConfigDialog(root, {
      view: this.view,
      app: this.settings,
      applyCanvasSize: () => {
        this.applyCanvasSize();
        this.settingsChanged();
      },
      applyView3d: () => {
        this.applyView3d();
        this.settingsChanged();
      },
    });
    this.playerTypes = new PlayerTypeDialog(root, () => this.store);
    this.shortcuts = createShortcutDialog(root);
    this.settingsStore = new SettingsStore({
      options: this.view.options,
      colors: this.view.colors,
      fonts: this.view.fonts,
      app: this.settings,
    });
    this.view.onChange(() => this.settingsChanged());

    this.status.setText(
      'Open a game log (.rcg / .rcg.gz) with the open button, Ctrl+O or by dropping it here, ' +
        'or connect to rcssserver (server::ws_port).',
    );

    p.onChange(() => {
      this.field.setFrameIndex(p.index);
      this.updateToolbar();
    });
    this.field.onTick = (now) => this.tick(now);
    this.field.position = () => this.scenePosition();
    this.field.animate = () => this.playback.playing || this.playback.live;
    this.field.onPointerField = (pos) => {
      this.status.setMousePos(pos ? `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})` : '');
    };
    this.field.element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const target = this.field.targetAt(e.clientX, e.clientY);
      this.menu.show(this.referee.menuItems(target.point, target.player), e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('pagehide', () => {
      // Say (dispbye), and keep the settings.
      this.live.disconnect();
      this.saveSettings();
    });
    this.field.element.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.attachDrop(root);
    this.updateToolbar();
  }

  get store(): GameStore | null {
    return this.playback.store;
  }

  /**
   * Applies the saved settings and the URL parameters (rcssmonitor's
   * command line options), e.g. ?show_view_area=on&connect=1&port=6080, and
   * connects if asked to.
   */
  start(params: URLSearchParams = new URLSearchParams()): void {
    this.settingsStore.load(params);
    this.applyAppSettings();
    this.view.changed();
    const { settings, connect } = connectionFromUrl(this.connection, params);
    this.connection = settings;
    if (connect) {
      this.connect(settings, false);
    }
  }

  // ---- settings and the window

  /** Shows the bars, sizes the field and sets up the player from `settings`. */
  private applyAppSettings(): void {
    const s = this.settings;
    this.menubar.element.hidden = !s.showMenuBar;
    this.toolbar.element.hidden = !s.showToolBar;
    this.status.element.hidden = !s.showStatusBar;
    this.playback.defaultInterval = s.timerInterval;
    this.playback.loop = s.autoLoop;
    this.applyCanvasSize();
    if (s.view3d !== this.is3d) {
      void this.set3d(s.view3d);
    }
    this.applyView3d();
    this.updateToolbar();
  }

  /** Gives the 3D view the settings of the preference dialog's 3D tab. */
  private applyView3d(): void {
    void this.render3d?.then((r) => this.configure3d(r));
  }

  /** The close-up and player cameras, the compass and the minimap, the boards and the banners. */
  private configure3d(r: Render3D): void {
    const s = this.settings;
    r.setCloseup(closeupOptions(s));
    r.setPlayerCamera(playerCameraOptions(s));
    r.setGuides({ compass: s.compass3d, minimap: s.minimap3d });
    r.setStadium({ boards: s.boards3d, banners: s.banners3d });
    r.setPlayerModel(s.playerModel3d);
  }

  // ---- 2D / 3D

  get is3d(): boolean {
    return this.field.renderer.kind === '3d';
  }

  /** Switches between the 2D and 3D views (D). */
  async toggle3d(): Promise<void> {
    await this.set3d(!this.is3d);
    this.settings.view3d = this.is3d;
    this.settingsChanged();
  }

  /**
   * Shows the 3D view or the 2D view. The 3D renderer and three.js are
   * loaded the first time; without WebGL the view stays 2D.
   */
  async set3d(on: boolean): Promise<void> {
    if (!on) {
      this.field.setRenderer(this.field.render2d);
      this.updateToolbar();
      return;
    }
    this.render3d ??= import('../view/render3d/render3d').then((m) => {
      const r = new m.Render3D();
      r.setCameraMode(this.settings.camera3d);
      this.configure3d(r);
      // A drag makes the broadcast or goal camera free.
      r.onCameraModeChange = (mode) => {
        this.settings.camera3d = mode;
        this.settingsChanged();
        this.updateToolbar();
      };
      // The wheel over a close-up camera: kept as the setting of the 3D tab.
      r.onCloseupDistanceChange = (distance) => {
        this.settings.closeupDistance3d = distance;
        this.settingsChanged();
        if (this.config.panel.isOpen) {
          this.config.refresh();
        }
        this.status.showMessage(`Close-up distance: ${distance.toFixed(1)} m`, 1500);
      };
      return r;
    });
    try {
      this.field.setRenderer(await this.render3d);
    } catch (e) {
      this.render3d = null;
      this.settings.view3d = false;
      this.status.showMessage(
        `The 3D view is not available: ${e instanceof Error ? e.message : String(e)}`,
        5000,
      );
    }
    this.updateToolbar();
  }

  /** A fixed field size (Canvas Size of the configuration), or the window's. */
  private applyCanvasSize(): void {
    const { canvasWidth: w, canvasHeight: h } = this.settings;
    const fixed = w > 0 && h > 0;
    Object.assign(this.field.element.style, {
      flex: fixed ? 'none' : '',
      width: fixed ? `${w}px` : '',
      height: fixed ? `${h}px` : '',
    });
  }

  private toggleBar(name: 'showMenuBar' | 'showToolBar' | 'showStatusBar'): void {
    this.settings[name] = !this.settings[name];
    this.applyAppSettings();
    this.settingsChanged();
  }

  /** Full screen (F11, Alt+Enter), with the Fullscreen API. */
  toggleFullScreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch((e: unknown) => {
        this.status.showMessage(
          `Full screen is not available: ${e instanceof Error ? e.message : String(e)}`,
          5000,
        );
      });
    }
  }

  /** Saves the settings shortly after the last change. */
  private settingsChanged(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveSettings(), 500);
  }

  private saveSettings(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.settingsStore.save();
  }

  /** Chooses the 3D camera (View > 3D Camera, the tool bar, E). */
  setCamera(mode: CameraMode): void {
    this.settings.camera3d = mode;
    this.settingsChanged();
    void this.render3d?.then((r) => r.setCameraMode(mode));
    if (mode === 'player' && !this.view.selected) {
      this.status.showMessage(
        'Select a player (1-9, 0, - for the left team, with Ctrl for the right) to see with its eyes.',
        5000,
      );
    } else if (mode === 'closeup-player' && !this.view.selected) {
      this.status.showMessage(
        'Select a player (1-9, 0, - for the left team, with Ctrl for the right) to follow; ' +
          'until then, the ball.',
        5000,
      );
    }
    this.updateToolbar();
  }

  /** The last viewpoint chosen, for Ctrl+I. */
  private viewpointShown: Viewpoint | null = null;

  /**
   * Puts the free camera at a viewpoint of the whole pitch (View > 3D
   * Camera, the tool bar, I, Ctrl+I): the camera mode becomes free.
   */
  viewFrom(viewpoint: Viewpoint): void {
    if (!this.is3d) {
      this.status.showMessage('The viewpoints are for the 3D view (D).', 3000);
      return;
    }
    this.viewpointShown = viewpoint;
    this.settings.camera3d = 'free';
    this.settingsChanged();
    void this.render3d?.then((r) => r.viewFrom(viewpoint));
    this.status.showMessage(`Viewpoint: ${VIEWPOINT_LABELS[viewpoint]}`, 2000);
    this.updateToolbar();
  }

  /** I (the whole pitch from the side) and Ctrl+I (the next viewpoint) in 3D; 2D fits with I. */
  private keyViewpoint(next: boolean): boolean {
    if (!this.is3d && !next) {
      return false; // I fits the field (handleViewKey)
    }
    // Ctrl+I in 2D only says it is for 3D, rather than leave it to the browser (Firefox's page info).
    this.viewFrom(next ? nextViewpoint(this.viewpointShown) : 'side');
    return true;
  }

  /** The viewpoints as menu items. */
  private viewpointItems(prefix: string): MenuItem[] {
    return VIEWPOINTS.map((vp) => ({
      id: `${prefix}-viewpoint-${vp}`,
      label: VIEWPOINT_LABELS[vp],
      ...(vp === 'side' ? { shortcut: 'I' } : {}),
      disabled: !this.is3d,
      action: () => this.viewFrom(vp),
    }));
  }

  private nextCamera(): void {
    if (this.is3d) {
      this.setCamera(nextCameraMode(this.settings.camera3d));
      this.status.showMessage(`Camera: ${CAMERA_LABELS[this.settings.camera3d]}`, 2000);
    } else {
      this.status.showMessage('The cameras are for the 3D view (D).', 3000);
    }
  }

  /**
   * The frame the 3D view shows and the fraction of the way to the next one.
   * Live, it shows the frame before the newest, moving toward the newest
   * over one simulation step: one cycle late, but smooth (§4.3).
   */
  private scenePosition(): { index: number; alpha: number } {
    const p = this.playback;
    const store = p.store;
    if (!store) {
      return { index: 0, alpha: 0 };
    }
    if (p.live && store.frameCount >= 2) {
      const step = store.serverParam.simulator_step || 100;
      const alpha = Math.min(1, (performance.now() - this.lastFrameAt) / step);
      return { index: store.frameCount - 2, alpha };
    }
    return p.position();
  }

  // ---- menus (MainWindow::createMenus)

  private fileMenu(): MenuItem[] {
    return [
      {
        id: 'file-open',
        label: 'Open Game Log...',
        shortcut: `${CTRL_LABEL}O`,
        action: () => this.fileInput.click(),
      },
    ];
  }

  private monitorMenu(): MenuItem[] {
    const idle = this.live.state === 'idle';
    return [
      {
        id: 'monitor-connect',
        label: 'Connect',
        shortcut: `${CTRL_LABEL}C`,
        title: `Connect to ${this.connection.host}:${this.connection.port}${this.connection.path}`,
        disabled: !idle,
        action: () => this.connect(this.connection),
      },
      {
        id: 'monitor-connect-to',
        label: 'Connect to ...',
        disabled: !idle,
        action: () => void this.connectTo(),
      },
      {
        id: 'monitor-disconnect',
        label: 'Disconnect',
        disabled: idle,
        action: () => this.disconnect(),
      },
      { kind: 'separator' },
      {
        id: 'monitor-live',
        label: 'Live Mode',
        shortcut: `${CTRL_LABEL}L`,
        disabled: this.live.state !== 'connected',
        action: () => this.goLive(),
      },
    ];
  }

  private viewMenu(): MenuItem[] {
    const s = this.settings;
    return [
      {
        id: 'view-menu-bar',
        label: 'Menu Bar',
        shortcut: `${CTRL_LABEL}M`,
        checked: s.showMenuBar,
        action: () => this.toggleBar('showMenuBar'),
      },
      {
        id: 'view-tool-bar',
        label: 'Tool Bar',
        checked: s.showToolBar,
        action: () => this.toggleBar('showToolBar'),
      },
      {
        id: 'view-status-bar',
        label: 'Status Bar',
        checked: s.showStatusBar,
        action: () => this.toggleBar('showStatusBar'),
      },
      { kind: 'separator' },
      {
        id: 'view-player-types',
        label: 'Player Type List',
        shortcut: `${CTRL_LABEL}H`,
        checked: this.playerTypes.panel.isOpen,
        action: () => this.playerTypes.panel.toggle(),
      },
      {
        id: 'view-3d',
        label: '3D View',
        shortcut: 'D',
        checked: this.is3d,
        action: () => void this.toggle3d(),
      },
      {
        kind: 'submenu',
        id: 'view-camera',
        label: '3D Camera',
        disabled: !this.is3d,
        title: this.is3d
          ? `E: the next camera; I: the whole pitch; ${CTRL_LABEL}I: the next viewpoint`
          : 'For the 3D view (D)',
        items: [
          ...CAMERA_MODES.map((mode) => ({
            id: `view-camera-${mode}`,
            label: CAMERA_LABELS[mode],
            checked: this.settings.camera3d === mode,
            action: () => this.setCamera(mode),
          })),
          { kind: 'separator' as const },
          ...this.viewpointItems('view'),
        ],
      },
      { kind: 'separator' },
      {
        id: 'view-full-screen',
        label: 'Full Screen',
        shortcut: 'F11',
        checked: document.fullscreenElement !== null,
        action: () => this.toggleFullScreen(),
      },
      {
        id: 'view-preference',
        label: 'Preference',
        shortcut: `${CTRL_LABEL}V`,
        checked: this.config.panel.isOpen,
        action: () => this.config.panel.toggle(),
      },
    ];
  }

  private helpMenu(): MenuItem[] {
    return [
      { id: 'help-about', label: 'About', action: () => void showAboutDialog(this.root) },
      {
        id: 'help-shortcuts',
        label: 'Shortcut Keys',
        checked: this.shortcuts.isOpen,
        action: () => this.shortcuts.toggle(),
      },
    ];
  }

  async open(file: File): Promise<void> {
    if (this.loading) {
      return;
    }
    // rcssmonitor disconnects before opening a log.
    this.disconnect();
    this.loading = true;
    this.status.progress.hidden = false;
    this.status.progress.value = 0;
    this.status.clearMessage();
    this.status.setText(`Reading ${file.name}…`);
    try {
      const log = await loadLogFile(await file.arrayBuffer(), {
        progress: (phase, fraction, store) => {
          this.status.progress.value = fraction;
          this.status.setText(
            phase === 'decompress'
              ? `Decompressing ${file.name}… ${Math.round(fraction * 100)}%`
              : `Parsing ${file.name}… cycle ${store.lastFrame?.time ?? 0}`,
          );
        },
      });
      this.setStore(log.store);
      document.title = `${file.name} - ${TITLE}`;
      this.status.setText(
        `${file.name}: ${summaryLine(log)}`,
        log.warnings.map((w) => `line ${w.line}: ${w.message}`).join('\n'),
      );
    } catch (error) {
      this.status.setText(
        `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.loading = false;
      this.status.progress.hidden = true;
    }
  }

  /** Shows a game from its first frame with the whole field (MainWindow::openGameLogFile). */
  setStore(store: GameStore | null): void {
    this.view.fitToScreen();
    this.field.setStore(store);
    this.storeRevision = store?.revision ?? -1;
    this.playback.setStore(store);
    this.updatePlayerTypes();
  }

  /** Updates the player type list if it is open and the types changed. */
  private updatePlayerTypes(): void {
    const count = this.store?.playerTypes.length ?? 0;
    if (this.playerTypes.panel.isOpen && count !== this.playerTypeCount) {
      this.playerTypes.update();
    }
    this.playerTypeCount = count;
  }

  /** Connects with the settings; saves them if asked to. */
  connect(settings: ConnectionSettings, save = true): void {
    this.connection = settings;
    if (save) {
      saveConnection(settings);
    }
    this.live.autoReconnect = settings.autoReconnect;
    this.live.reconnectWait = settings.reconnectWait;
    this.live.connect(settings);
  }

  /** Connect to ...: asks where (MainWindow::connectMonitorTo). */
  async connectTo(): Promise<void> {
    if (this.dialogOpen) {
      return;
    }
    this.dialogOpen = true;
    try {
      const settings = await showConnectDialog(this.root, this.connection);
      if (settings) {
        this.connect(settings);
      }
    } finally {
      this.dialogOpen = false;
    }
  }

  disconnect(): void {
    if (this.live.state !== 'idle') {
      this.live.disconnect();
      this.status.showMessage('Disconnected.', 3000);
    }
  }

  /** Live mode (Ctrl+L): only while connected, as in rcssmonitor. */
  private goLive(): void {
    if (this.live.state === 'connected') {
      this.playback.setLive();
    }
  }

  /** A connection was accepted: show its game, following the newest frame. */
  private liveGame(store: GameStore): void {
    this.status.setText(`Live game from ${this.live.url}`);
    document.title = `${this.live.url} - ${TITLE}`;
    this.setStore(store);
    this.playback.setLive();
  }

  private liveStateChanged(state: LiveState): void {
    this.status.setConnection(state, this.live.url);
    if (state !== 'connected' && this.playback.live) {
      // No more frames: the game stays to look at, like a log.
      this.playback.stop();
    }
    this.updateToolbar();
  }

  private tick(now: number): void {
    const store = this.playback.store;
    if (store && store.frameCount !== this.lastFrameCount) {
      this.lastFrameCount = store.frameCount;
      this.lastFrameAt = now;
    }
    if (store && store.revision !== this.storeRevision) {
      this.storeRevision = store.revision;
      this.playback.framesAdded();
      this.updateToolbar();
      this.updatePlayerTypes();
    }
    this.playback.tick(now);
  }

  private updateToolbar(): void {
    const p = this.playback;
    this.toolbar.update({
      frameCount: p.frameCount,
      index: p.index,
      frame: p.store?.frame(p.index),
      playing: p.playing,
      interval: p.interval,
      loop: p.loop,
      live: p.live,
      connection: this.live.state,
      view3d: this.is3d,
      camera: this.settings.camera3d,
    });
  }

  private keydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.type !== 'range') {
      return;
    }
    // Keys in an open dialog or a menu belong to them.
    if (target?.closest('dialog[open], .context-menu') || this.menu.isOpen || this.menubar.isOpen) {
      return;
    }
    // Let a focused button take Space and Enter.
    if (target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) {
      return;
    }
    const windowKeys = {
      open: () => this.fileInput.click(),
      toggle3d: () => void this.toggle3d(),
      nextCamera: () => this.nextCamera(),
      viewpoint: (next: boolean) => this.keyViewpoint(next),
      toggleMenuBar: () => this.toggleBar('showMenuBar'),
      playerTypes: () => this.playerTypes.panel.toggle(),
      preference: () => this.config.panel.toggle(),
      fullScreen: () => this.toggleFullScreen(),
    };
    const monitor = {
      // Connect (Ctrl+C): to the last server, without asking. Like the
      // action in rcssmonitor, it does nothing while connected.
      connect: () => {
        if (this.live.state === 'idle') {
          this.connect(this.connection);
        }
      },
      live: () => this.goLive(),
      kickOff: () => this.referee.kickOff(),
    };
    if (
      handleWindowKey(windowKeys, e) ||
      handleMonitorKey(monitor, e) ||
      handlePlayerKey(this.playback, e) ||
      handleViewKey(this.view, e)
    ) {
      e.preventDefault();
    }
  }

  /** The wheel steps frames: down is forward (MainWindow::wheelEvent). */
  private wheel(e: WheelEvent): void {
    // In 3D, the wheel zooms the camera.
    if (!this.store || this.is3d) {
      return;
    }
    e.preventDefault();
    if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
      this.step(e.deltaY);
      return;
    }
    // Touch pads send many small pixel deltas: step once per 50 pixels.
    this.wheelDelta += e.deltaY;
    while (Math.abs(this.wheelDelta) >= 50) {
      this.step(this.wheelDelta);
      this.wheelDelta -= Math.sign(this.wheelDelta) * 50;
    }
  }

  private step(delta: number): void {
    if (delta > 0) {
      this.playback.stepForward();
    } else if (delta < 0) {
      this.playback.stepBackward();
    }
  }

  private attachDrop(root: HTMLElement): void {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    let depth = 0;
    root.addEventListener('dragenter', (e) => {
      if (hasFiles(e)) {
        ++depth;
        root.classList.add('drop-target');
      }
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        root.classList.remove('drop-target');
      }
    });
    root.addEventListener('dragover', (e) => {
      if (hasFiles(e)) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
      }
    });
    root.addEventListener('drop', (e) => {
      depth = 0;
      root.classList.remove('drop-target');
      const file = e.dataTransfer?.files[0];
      if (file) {
        e.preventDefault();
        void this.open(file);
      }
    });
  }
}

function summaryLine({ store, result: r }: LoadedLog): string {
  const first = store.frame(0);
  const last = store.lastFrame;
  const [l, rt] = last?.teams ?? [];
  const warnings = r.warnings > 0 ? `, ${r.warnings} warnings` : '';
  return (
    `${describeFormat(r.info.format)}${r.info.gzip ? ' (gzip)' : ''}, ` +
    `${store.frameCount.toLocaleString('en')} frames, ` +
    `cycles ${first?.time ?? 0}-${last?.time ?? 0}, ` +
    `${l?.name || '(no name)'} ${l?.score ?? 0}-${rt?.score ?? 0} ${rt?.name || '(no name)'}` +
    warnings
  );
}
