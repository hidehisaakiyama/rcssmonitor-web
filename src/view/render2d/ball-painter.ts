// The ball (rcssmonitor src/ball_painter.cpp).
import type { BallState } from '../../core/frame';
import type { ServerParam } from '../../core/params';
import type { ViewState } from '../view-state';
import type { QtPainter } from './qt-painter';
import type { Viewport } from './viewport';

export function drawBall(
  p: QtPainter,
  vp: Viewport,
  view: ViewState,
  sp: ServerParam,
  ball: BallState,
): void {
  const opt = view.options;
  if (!opt.showBall) {
    return;
  }
  const radius =
    opt.ballSize >= 0.01 ? vp.scale(opt.ballSize) : Math.max(1, vp.scale(sp.ball_size));
  const kickable = Math.max(1, vp.scale(sp.player_size + sp.kickable_margin + sp.ball_size));
  const ix = vp.screenX(ball.x);
  const iy = vp.screenY(ball.y);

  p.setPen(null);
  p.setBrush(view.colors.ball);
  p.drawEllipse(ix - radius, iy - radius, radius * 2, radius * 2);

  // kickable margin of a default player
  p.setPen(view.colors.ball);
  p.setBrush(null);
  p.drawEllipse(ix - kickable, iy - kickable, kickable * 2, kickable * 2);

  if (opt.ballVelCycle > 0) {
    drawVelocity(p, vp, view, sp, ball);
  }
}

/** The ball path without noise for ballVelCycle cycles. */
function drawVelocity(
  p: QtPainter,
  vp: Viewport,
  view: ViewState,
  sp: ServerParam,
  ball: BallState,
): void {
  p.antialias = false;
  let x = ball.x;
  let y = ball.y;
  let vx = ball.vx;
  let vy = ball.vy;
  const first = [vp.screenX(x), vp.screenY(y)] as const;
  let last: readonly [number, number] = first;

  p.setPen(view.colors.ballVel);
  p.setBrush(null);
  const cycles = Math.min(100, view.options.ballVelCycle);
  for (let i = 0; i < cycles; ++i) {
    x += vx;
    y += vy;
    vx *= sp.ball_decay;
    vy *= sp.ball_decay;
    const pt = [vp.screenX(x), vp.screenY(y)] as const;
    if (Math.abs(last[0] - pt[0]) < 1 && Math.abs(last[1] - pt[1]) < 1) {
      break;
    }
    last = pt;
    p.drawEllipse(pt[0] - 1, pt[1] - 1, 3, 3);
  }
  p.drawLine(first[0], first[1], last[0], last[1]);
  p.antialias = true;
}
