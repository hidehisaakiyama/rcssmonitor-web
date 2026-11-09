// Players (rcssmonitor src/player_painter.cpp).
import { MAX_PLAYER, PITCH, Side } from '../../core/constants';
import {
  hasRedCard,
  hasYellowCard,
  isAlive,
  isCatching,
  isCatchingFault,
  isCollidedBall,
  isCollidedPlayer,
  isFoulCharged,
  isGoalie,
  isIllegalDefense,
  isKicking,
  isKickingFault,
  isTackling,
  isTacklingFault,
  type BallState,
  type Frame,
  type PlayerState,
} from '../../core/frame';
import {
  circleIntersections,
  DEG2RAD,
  isLeftOf,
  normalizeAngle,
  rint,
  rotate,
  vectorAngle,
} from '../../core/geometry';
import type { PlayerType, ServerParam } from '../../core/params';
import { cssFont, darker } from '../palette';
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
  const colors = view.colors;
  const player = param.player;

  // base color
  p.setPen(selected ? { color: colors.playerPen, width: 2 } : colors.playerPen);
  if (player.side === Side.Left) {
    p.setBrush(isGoalie(player) ? colors.leftGoalie : colors.leftTeam);
  } else if (player.side === Side.Right) {
    p.setBrush(isGoalie(player) ? colors.rightGoalie : colors.rightTeam);
  } else {
    p.setBrush('#000000');
  }

  // state color
  if (!isAlive(player)) {
    p.setBrush('#000000');
  }
  if (isIllegalDefense(player) && view.options.showIllegalDefense) {
    p.setPen({ color: colors.illegalDefense, width: 2 });
  }
  if (isKicking(player)) {
    p.setPen({ color: colors.kick, width: 2 });
  }
  if (isKickingFault(player)) {
    p.setBrush(colors.kickFault);
  }
  if (isCatching(player)) {
    p.setBrush(colors.catch);
  }
  if (isCatchingFault(player)) {
    p.setBrush(colors.catchFault);
  }
  if (isTackling(player)) {
    p.setPen({ color: colors.tackle, width: 2 });
    p.setBrush(colors.tackle);
  }
  if (isTacklingFault(player)) {
    p.setPen({ color: colors.tackle, width: 2 });
    p.setBrush(colors.tackleFault);
  }
  if (isFoulCharged(player)) {
    p.setBrush(colors.foulCharged);
  }
  if (isCollidedBall(player)) {
    p.setBrush(colors.ballCollide);
  }
  if (isCollidedPlayer(player)) {
    p.setBrush(colors.playerCollide);
  }

  const r = param.drawRadius;
  p.drawEllipse(param.x - r, param.y - r, r * 2, r * 2);

  // Stamina: the body circle gets darker as stamina goes down.
  const staminaRate = player.stamina / sp.stamina_max;
  let darkRate = 200 - rint(200 * rint(staminaRate / 0.125) * 0.125);
  darkRate = Math.max(0, darkRate - 50);
  const brush = p.currentBrush() ?? '#000000';
  p.setPen(null);
  p.setBrush(darkRate === 0 ? brush : darker(brush, 100 + darkRate));
  const br = param.bodyRadius;
  p.drawEllipse(param.x - br, param.y - br, br * 2, br * 2);

  // A ring when effort or recovery has decayed.
  if (Math.abs(param.type.effort_max - player.effort) >= 1.0e-5) {
    const rr = r + 2;
    p.setPen(colors.effortDecayed);
    p.setBrush(null);
    p.drawEllipse(param.x - rr, param.y - rr, rr * 2, rr * 2);
  } else if (Math.abs(1.0 - player.recovery) >= 1.0e-5) {
    const rr = r + 2;
    p.setPen(colors.recoveryDecayed);
    p.setBrush(null);
    p.drawEllipse(param.x - rr, param.y - rr, rr * 2, rr * 2);
  }

  // real body edge
  p.setPen(colors.playerPen);
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
  const player = param.player;
  const fp = player.focusPoint;
  if (!fp) {
    return;
  }
  const angle = (player.body + player.neck + fp.dir) * DEG2RAD;
  const ix = vp.screenX(player.x + fp.dist * Math.cos(angle));
  const iy = vp.screenY(player.y + fp.dist * Math.sin(angle));
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

  const area = Math.hypot(sp.catchable_area_w * 0.5, sp.catchable_area_l);
  const catchable = vp.scale(area);
  p.setPen(color);
  p.setBrush(null);
  p.drawEllipse(param.x - catchable, param.y - catchable, catchable * 2, catchable * 2);

  const stretch = param.type.catchable_area_l_stretch;
  const maxR = vp.scale(Math.hypot(sp.catchable_area_w * 0.5, sp.catchable_area_l * stretch));
  if (maxR > catchable) {
    p.setPen({ color: darker(color, 200), width: 0, dot: true });
    p.drawEllipse(param.x - maxR, param.y - maxR, maxR * 2, maxR * 2);
    const minR = vp.scale(
      Math.hypot(sp.catchable_area_w * 0.5, sp.catchable_area_l * (1.0 - (stretch - 1.0))),
    );
    p.drawEllipse(param.x - minR, param.y - minR, minR * 2, minR * 2);
  }
}

function drawTackleArea(c: PlayerPaintContext, param: Param): void {
  const { p, vp, view, sp } = c;
  const player = param.player;
  const rel = rotate({ x: param.ball.x - player.x, y: param.ball.y - player.y }, -player.body);

  const tackleDist = rel.x > 0 ? sp.tackle_dist : sp.tackle_back_dist;
  if (tackleDist < 1.0e-5) {
    return;
  }
  const tackleFail =
    (Math.abs(rel.x) / tackleDist) ** sp.tackle_exponent +
    (Math.abs(rel.y) / sp.tackle_width) ** sp.tackle_exponent;
  const foulFail =
    (Math.abs(rel.x) / tackleDist) ** sp.foul_exponent +
    (Math.abs(rel.y) / sp.tackle_width) ** sp.foul_exponent;
  if (tackleFail >= 1.0 && foulFail >= 1.0) {
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
  const x = param.x + textRadius;
  const y = param.y + 2 + p.fontAscent();
  if (tackleFail < 1.0 && foulFail < 1.0) {
    p.drawText(x, y, `T=${qtNumber(1.0 - tackleFail)},F=${qtNumber(1.0 - foulFail)}`);
  } else if (tackleFail < 1.0) {
    p.drawText(x, y, `Tackle=${qtNumber(1.0 - tackleFail)}`);
  } else {
    p.drawText(x, y, `Foul=${qtNumber(1.0 - foulFail)}`);
  }
}

function drawKickAccelArea(c: PlayerPaintContext, param: Param): void {
  const { p, vp, view, sp } = c;
  const player = param.player;
  const type = param.type;
  const ball = param.ball;
  const bpos = { x: ball.x, y: ball.y };
  const rel = rotate({ x: ball.x - player.x, y: ball.y - player.y }, -player.body);
  const ballDist = Math.hypot(rel.x, rel.y);
  if (ballDist > type.player_size + type.kickable_margin + sp.ball_size) {
    return;
  }

  const dirDiff = Math.abs(vectorAngle(rel.x, rel.y));
  let maxAccel =
    sp.maxpower *
    type.kick_power_rate *
    (1.0 -
      (0.25 * dirDiff) / 180.0 -
      (0.25 * (ballDist - type.player_size - sp.ball_size)) / type.kickable_margin);
  maxAccel = Math.min(maxAccel, sp.ball_accel_max);

  const bnext = { x: bpos.x + ball.vx, y: bpos.y + ball.vy };
  const bx = vp.screenX(bpos.x);
  const by = vp.screenY(bpos.y);
  const nx = vp.screenX(bnext.x);
  const ny = vp.screenY(bnext.y);
  const maxSpeedR = vp.scale(sp.ball_speed_max);
  const maxAccelR = vp.scale(maxAccel);

  p.setPen(view.colors.kickAccel);
  p.setBrush(null);
  // the ball's move without noise
  p.drawLine(bx, by, nx, ny);

  const points = circleIntersections(bpos, sp.ball_speed_max, bnext, maxAccel);
  const [i1, i2] = points;
  if (points.length !== 2 || !i1 || !i2) {
    // Just the area the ball can reach next by the maximum acceleration.
    p.drawEllipse(nx - maxAccelR, ny - maxAccelR, maxAccelR * 2, maxAccelR * 2);
  } else {
    const toNext = vectorAngle(bnext.x - bpos.x, bnext.y - bpos.y);
    const [start, span] = arcBetween(
      vectorAngle(i1.x - bpos.x, i1.y - bpos.y),
      vectorAngle(i2.x - bpos.x, i2.y - bpos.y),
      toNext,
    );
    p.drawArc(bx - maxSpeedR, by - maxSpeedR, maxSpeedR * 2, maxSpeedR * 2, start, span);

    const [start2, span2] = arcBetween(
      vectorAngle(i1.x - bnext.x, i1.y - bnext.y),
      vectorAngle(i2.x - bnext.x, i2.y - bnext.y),
      normalizeAngle(toNext + 180.0),
    );
    p.drawArc(nx - maxAccelR, ny - maxAccelR, maxAccelR * 2, maxAccelR * 2, start2, span2);
  }

  p.setFont(cssFont(view.fonts.player));
  p.setPen(view.colors.kickAccel);
  p.drawText(nx + 10, ny + p.fontAscent(), `MaxAccel=${maxAccel.toFixed(3)}`);
}

/**
 * The arc from one intersection to the other that faces `toward`, as Qt arc
 * angles (1/16 degree).
 */
function arcBetween(a1: number, a2: number, toward: number): [number, number] {
  let start: number;
  let span: number;
  if (isLeftOf(a1, toward)) {
    start = a1;
    span = normalizeAngle(a2 - a1);
  } else {
    start = a2;
    span = normalizeAngle(a1 - a2);
  }
  if (span < 0) {
    span += 360;
  }
  span *= -1;
  return [rint(-start * 16), rint(span * 16)];
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

/**
 * The offside lines: the second last defender of each team, or the ball if
 * it is further back, and not beyond the goal line.
 */
export function offsideLines(frame: Frame): [number, number] {
  let offsideL = 0;
  let minX = 0;
  let offsideR = 0;
  let maxX = 0;
  for (let i = 0; i < 2 * MAX_PLAYER; ++i) {
    const p = frame.players[i];
    if (!p || p.state === 0) {
      continue;
    }
    if (p.side === Side.Left && p.x < offsideL) {
      if (p.x < minX) {
        offsideL = minX;
        minX = p.x;
      } else {
        offsideL = p.x;
      }
    } else if (p.side === Side.Right && offsideR < p.x) {
      if (maxX < p.x) {
        offsideR = maxX;
        maxX = p.x;
      } else {
        offsideR = p.x;
      }
    }
  }
  const half = PITCH.length * 0.5;
  return [
    Math.max(Math.min(offsideL, frame.ball.x), -half),
    Math.min(Math.max(offsideR, frame.ball.x), half),
  ];
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

/** QString::arg(value, 0, 'g', 3): up to 3 significant digits, no trailing zeros. */
export function qtNumber(v: number): string {
  if (v === 0 || !Number.isFinite(v)) {
    return String(v);
  }
  const stripZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
  // The exponent after rounding to 3 significant digits, as printf's %g uses.
  const [mantissa = '', e = '0'] = v.toExponential(2).split('e');
  const exp = Number(e);
  if (exp < -4 || exp >= 3) {
    return `${stripZeros(mantissa)}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return stripZeros(v.toFixed(2 - exp));
}
