// Players (rcssmonitor src/player_painter.cpp).
import { PITCH, Side } from '../../core/constants';
import {
  hasRedCard,
  hasYellowCard,
  isGoalie,
  isIllegalDefense,
  type BallState,
  type Frame,
  type PlayerState,
} from '../../core/frame';
import { DEG2RAD, rint } from '../../core/geometry';
import type { PlayerType, ServerParam } from '../../core/params';
import {
  catchAreaRadii,
  focusPointOf,
  kickAccel,
  offsideLines,
  tackleChances,
  tackleText,
  type Arc,
} from '../overlay-math';
import { cssFont, darker } from '../palette';
import { playerStyle } from '../player-style';
import type { ViewState } from '../view-state';
import type { QtPainter } from './qt-painter';
import type { Viewport } from './viewport';

interface Param {
  readonly x: number;
  readonly y: number;
  readonly bodyRadius: number;
  readonly kickRadius: number;
  readonly drawRadius: number;
  readonly player: PlayerState;
  readonly ball: BallState;
  readonly type: PlayerType;
}

export interface PlayerPaintContext {
  readonly p: QtPainter;
  readonly vp: Viewport;
  readonly view: ViewState;
  readonly sp: ServerParam;
  readonly playerType: (id: number) => PlayerType;
}

export function drawPlayers(c: PlayerPaintContext, frame: Frame): void {
  if (!c.view.options.showPlayer) {
    return;
  }
  for (const player of frame.players) {
    drawAll(c, player, frame.ball);
  }
  if (c.view.options.showOffsideLine) {
    drawOffsideLine(c, frame);
  }
}

function makeParam(c: PlayerPaintContext, player: PlayerState, ball: BallState): Param {
  const { vp, sp, view } = c;
  const type = c.playerType(player.type);
  const bodyRadius = Math.max(1, vp.scale(type.player_size));
  const kickRadius = Math.max(5, vp.scale(type.player_size + type.kickable_margin + sp.ball_size));
  return {
    x: vp.screenX(player.x),
    y: vp.screenY(player.y),
    bodyRadius,
    kickRadius,
    drawRadius: view.options.playerSize >= 0.01 ? vp.scale(view.options.playerSize) : kickRadius,
    player,
    ball,
    type,
  };
}

function drawAll(c: PlayerPaintContext, player: PlayerState, ball: BallState): void {
  const opt = c.view.options;
  const param = makeParam(c, player, ball);
  const selected = c.view.isSelected(player.side, player.unum);

  drawBody(c, param, selected);
  drawDir(c, param);

  if (opt.showViewArea) {
    drawViewArea(c, param, selected);
  }
  if (opt.showFocusPoint && selected && player.focusPoint && player.focusPoint.dist > 1.0e-5) {
    drawFocusPoint(c, param);
  }
  if (isGoalie(player) && opt.showCatchArea) {
    drawCatchArea(c, param);
  }
  if (opt.showTackleArea) {
    drawTackleArea(c, param);
  }
  if (opt.showKickAccelArea && selected) {
    drawKickAccelArea(c, param);
  }
  if (player.point && opt.showPointto) {
    drawPointto(c, param);
  }
  drawText(c, param);
}

function drawBody(c: PlayerPaintContext, param: Param, selected: boolean): void {
  const { p, view, sp } = c;
  const style = playerStyle(view.colors, view.options, sp, param.type, param.player, selected);

  // The outer circle in the team or state color.
  p.setPen(style.pen);
  p.setBrush(style.brush);
  const r = param.drawRadius;
  p.drawEllipse(param.x - r, param.y - r, r * 2, r * 2);

  // Stamina: the body circle gets darker as stamina goes down.
  p.setPen(null);
  p.setBrush(style.body);
  const br = param.bodyRadius;
  p.drawEllipse(param.x - br, param.y - br, br * 2, br * 2);

  // A ring when effort or recovery has decayed.
  if (style.decay) {
    const rr = r + 2;
    p.setPen(style.decay);
    p.setBrush(null);
    p.drawEllipse(param.x - rr, param.y - rr, rr * 2, rr * 2);
  }

  // real body edge
  p.setPen(view.colors.playerPen);
  p.setBrush(null);
  p.drawEllipse(param.x - br, param.y - br, br * 2, br * 2);
}

function drawDir(c: PlayerPaintContext, param: Param): void {
  const { p, vp, view, sp } = c;
  const player = param.player;
  const realR = param.type.player_size + param.type.kickable_margin + sp.ball_size;
  const body = player.body * DEG2RAD;

  p.setPen(view.colors.playerPen);
  p.setBrush(null);
  p.drawLine(
    param.x,
    param.y,
    vp.screenX(player.x + realR * Math.cos(body)),
    vp.screenY(player.y + realR * Math.sin(body)),
  );

  if (!view.options.showViewArea) {
    const head = (player.body + player.neck) * DEG2RAD;
    p.setPen(view.colors.neck);
    p.drawLine(
      param.x,
      param.y,
      vp.screenX(player.x + realR * Math.cos(head)),
      vp.screenY(player.y + realR * Math.sin(head)),
    );
  }
}

function drawViewArea(c: PlayerPaintContext, param: Param, selected: boolean): void {
  const { p, vp, view, sp } = c;
  const player = param.player;
  const visibleRadius = vp.scale(sp.visible_distance);
  const head = player.body + player.neck;
  const start = rint((-head - player.viewWidth * 0.5) * 16);
  const span = rint(player.viewWidth * 16);

  if (selected) {
    p.setPen(view.colors.largeViewArea);
    p.setBrush(null);
    for (const dist of [20, 40, 60]) {
      const r = vp.scale(dist);
      p.drawArc(param.x - r, param.y - r, r * 2, r * 2, start, span);
    }
    // feeling area
    p.drawArc(
      param.x - visibleRadius,
      param.y - visibleRadius,
      visibleRadius * 2,
      visibleRadius * 2,
      0,
      360 * 16,
    );
    const a1 = (head - player.viewWidth * 0.5) * DEG2RAD;
    const a2 = (head + player.viewWidth * 0.5) * DEG2RAD;
    p.drawLine(
      param.x + vp.scale(60 * Math.cos(a1)),
      param.y + vp.scale(60 * Math.sin(a1)),
      param.x,
      param.y,
    );
    p.drawLine(
      param.x + vp.scale(60 * Math.cos(a2)),
      param.y + vp.scale(60 * Math.sin(a2)),
      param.x,
      param.y,
    );
  } else {
    p.setPen(view.colors.viewArea);
    p.setBrush(null);
    p.drawPie(
      param.x - visibleRadius,
      param.y - visibleRadius,
      visibleRadius * 2,
      visibleRadius * 2,
      start,
      span,
    );
  }
}

function drawFocusPoint(c: PlayerPaintContext, param: Param): void {
  const { p, vp, view } = c;
  const fp = focusPointOf(param.player);
  if (!fp) {
    return;
  }
  const ix = vp.screenX(fp.x);
  const iy = vp.screenY(fp.y);
  const r = vp.scale(view.options.focusPointSize);
  p.setPen(view.colors.focusPoint);
  p.setBrush(null);
  p.drawLine(param.x, param.y, ix, iy);
  p.drawEllipse(ix - r, iy - r, r * 2, r * 2);
}

function drawCatchArea(c: PlayerPaintContext, param: Param): void {
  const { p, vp, view, sp } = c;
  const left = param.player.side === Side.Left;
  const color = left ? view.colors.leftGoalie : view.colors.rightGoalie;
  const radii = catchAreaRadii(sp, param.type);

  const catchable = vp.scale(radii.catchable);
  p.setPen(color);
  p.setBrush(null);
  p.drawEllipse(param.x - catchable, param.y - catchable, catchable * 2, catchable * 2);

  if (radii.stretched) {
    p.setPen({ color: darker(color, 200), width: 0, dot: true });
    for (const radius of radii.stretched) {
      const r = vp.scale(radius);
      p.drawEllipse(param.x - r, param.y - r, r * 2, r * 2);
    }
  }
}

function drawTackleArea(c: PlayerPaintContext, param: Param): void {
  const { p, vp, view, sp } = c;
  const player = param.player;
  const chances = tackleChances(sp, player, param.ball);
  if (!chances) {
    return;
  }

  const pen = { color: view.colors.tackle, width: 2 };
  p.save();
  p.translate(param.x, param.y);
  p.rotate(player.body);
  p.setPen(pen);
  p.setBrush(null);
  p.drawRect(
    vp.scale(-sp.tackle_back_dist),
    vp.scale(-sp.tackle_width),
    vp.scale(sp.tackle_dist + sp.tackle_back_dist),
    vp.scale(sp.tackle_width * 2.0),
  );
  p.restore();

  const textRadius = Math.min(40, param.drawRadius);
  p.setFont(cssFont(view.fonts.player));
  p.setPen(pen);
  p.drawText(param.x + textRadius, param.y + 2 + p.fontAscent(), tackleText(chances));
}

function drawKickAccelArea(c: PlayerPaintContext, param: Param): void {
  const { p, vp, view, sp } = c;
  const ball = param.ball;
  const kick = kickAccel(sp, param.type, param.player, ball);
  if (!kick) {
    return;
  }
  const nx = vp.screenX(kick.next.x);
  const ny = vp.screenY(kick.next.y);

  p.setPen(view.colors.kickAccel);
  p.setBrush(null);
  // the ball's move without noise
  p.drawLine(vp.screenX(ball.x), vp.screenY(ball.y), nx, ny);

  for (const arc of kick.arcs) {
    const x = vp.screenX(arc.center.x);
    const y = vp.screenY(arc.center.y);
    const r = vp.scale(arc.radius);
    if (arc.span >= 360) {
      // Just the area the ball can reach next by the maximum acceleration.
      p.drawEllipse(x - r, y - r, r * 2, r * 2);
    } else {
      p.drawArc(x - r, y - r, r * 2, r * 2, ...qtArc(arc));
    }
  }

  p.setFont(cssFont(view.fonts.player));
  p.setPen(view.colors.kickAccel);
  p.drawText(nx + 10, ny + p.fontAscent(), `MaxAccel=${kick.maxAccel.toFixed(3)}`);
}

/** An arc as Qt angles (1/16 degree, counter-clockwise on the screen). */
function qtArc(arc: Arc): [number, number] {
  return [rint(-arc.start * 16), rint(-arc.span * 16)];
}

function drawPointto(c: PlayerPaintContext, param: Param): void {
  const { p, vp, view } = c;
  const point = param.player.point;
  if (!point) {
    return;
  }
  const ix = vp.screenX(point.x);
  const iy = vp.screenY(point.y);
  p.setPen(view.colors.pointto);
  p.setBrush(null);
  p.drawLine(param.x, param.y, ix, iy);
  p.drawLine(ix - 2, iy - 2, ix + 2, iy + 2);
  p.drawLine(ix - 2, iy + 2, ix + 2, iy - 2);
}

function drawText(c: PlayerPaintContext, param: Param): void {
  const { p, view } = c;
  const opt = view.options;
  const player = param.player;

  let text = '';
  if (opt.showPlayerNumber) {
    text += String(player.unum);
  }
  if (opt.showStamina) {
    text += (text !== '' ? ',' : '') + player.stamina.toFixed(0).padStart(4);
  }
  if (player.capacity !== undefined && opt.showStaminaCapacity) {
    if (text !== '') {
      text += opt.showStamina ? '/' : ',';
    }
    text += player.capacity.toFixed(0);
  }
  if (opt.showPlayerType) {
    text += (text !== '' ? ',' : '') + `t${player.type}`;
  }

  p.setFont(cssFont(view.fonts.player));
  const textRadius = Math.min(40, param.drawRadius);
  let cardOffset = 0;

  if (opt.showCard && (hasRedCard(player) || hasYellowCard(player))) {
    const ascent = p.fontAscent();
    const xSize = Math.max(4, ascent - 2);
    const ySize = Math.max(4, ascent);
    cardOffset = xSize + 2;
    p.antialias = false;
    p.setPen('#000000');
    p.setBrush(hasRedCard(player) ? '#ff0000' : '#ffff00');
    p.drawRect(param.x + textRadius, param.y - ySize, xSize, ySize);
    p.antialias = true;
  }

  if (text !== '') {
    if (isIllegalDefense(player) && opt.showIllegalDefense) {
      p.setPen({ color: view.colors.illegalDefense, width: 2 });
    } else if (textRadius < param.drawRadius - 10) {
      p.setPen(view.colors.playerNumberInner);
    } else {
      p.setPen(view.colors.playerNumber);
    }
    p.setBrush(null);
    p.drawText(param.x + textRadius + cardOffset, param.y, text);
  }
}

function drawOffsideLine(c: PlayerPaintContext, frame: Frame): void {
  const { p, vp, view } = c;
  const [l, r] = offsideLines(frame);
  const top = vp.screenY(PITCH.width * 0.5);
  const bottom = vp.screenY(-PITCH.width * 0.5);
  p.setBrush(null);
  p.setPen(view.colors.leftTeam);
  p.drawLine(vp.screenX(l), top, vp.screenX(l), bottom);
  p.setPen(view.colors.rightTeam);
  p.drawLine(vp.screenX(r), top, vp.screenX(r), bottom);
}
