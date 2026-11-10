import { describe, expect, it } from 'vitest';
import { PITCH } from '../../src/core/constants';
import { RAD2DEG } from '../../src/core/geometry';
import {
  bearing,
  compassOffset,
  compassRect,
  guideShown,
  minimapPoint,
  minimapRect,
} from '../../src/view/hud/guides';
import { goalPose } from '../../src/view/render3d/cameras';
import {
  BANNER,
  BOARDS,
  GOAL_HEIGHT,
  shade,
  TEXTURE_AREA,
  textColorOn,
} from '../../src/view/render3d/scene-math';
import { EYE_HEIGHT, SHOULDER } from '../../src/view/render3d/player-camera';

describe('the compass', () => {
  it('shows with the chosen cameras, never with the top one', () => {
    expect(guideShown('off', 'player')).toBe(false);
    expect(guideShown('player', 'player')).toBe(true);
    expect(guideShown('player', 'broadcast')).toBe(false);
    expect(guideShown('all', 'free')).toBe(true);
    expect(guideShown('all', 'goal-left')).toBe(true);
    expect(guideShown('all', 'top')).toBe(false);
  });

  it('puts the camera direction in the middle and clockwise to the right', () => {
    const center = { x: 0, y: 0 };
    const right = { x: PITCH.length / 2, y: 0 };
    const left = { x: -PITCH.length / 2, y: 0 };
    // Looking at the right goal: it is in the middle, the left one at the end.
    expect(compassOffset(bearing(center, right), 0)).toBe(0);
    expect(Math.abs(compassOffset(bearing(center, left), 0))).toBe(1);
    // Looking down the 2D screen (+y): the right goal (+x) is on the left.
    expect(compassOffset(bearing(center, right), 90)).toBe(-0.5);
    expect(compassOffset(bearing(center, left), 90)).toBe(0.5);
    // Across -180 / 180.
    expect(compassOffset(-170, 170)).toBeCloseTo(20 / 180);
  });

  it('sits at the top in the middle, at most 480 px wide', () => {
    expect(compassRect(1000)).toEqual({ x: 260, y: 6, width: 480, height: 22 });
    expect(compassRect(400)).toEqual({ x: 80, y: 6, width: 240, height: 22 });
  });
});

describe('the minimap', () => {
  it('shows the pitch and its margin at the bottom right, as the 2D view', () => {
    const r = minimapRect(1280, 720);
    expect(r.width).toBe(300);
    expect(r.x + r.width).toBe(1280 - 8);
    expect(r.y + r.height).toBe(720 - 8);
    expect(r.height / r.width).toBeCloseTo(TEXTURE_AREA.width / TEXTURE_AREA.length, 2);
    expect(minimapPoint(r, { x: 0, y: 0 })).toEqual({
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    });
    // The corner of the margin, +y down.
    const corner = minimapPoint(r, { x: TEXTURE_AREA.length / 2, y: TEXTURE_AREA.width / 2 });
    expect(corner.x).toBeCloseTo(r.x + r.width);
    expect(corner.y).toBeCloseTo(r.y + r.height, 0);
    expect(minimapRect(300, 200).width).toBe(140);
  });
});

describe('the ends in the team colors', () => {
  it('writes in black or white, whichever reads better', () => {
    expect(textColorOn('#ffd700')).toBe('#000000'); // the left team
    expect(textColorOn('#00bfff')).toBe('#000000'); // the right team
    expect(textColorOn('#000080')).toBe('#ffffff');
    expect(textColorOn('#f00')).toBe('#000000');
    expect(textColorOn('rgb(20, 20, 20)')).toBe('#ffffff');
    expect(textColorOn('not a color')).toBe('#000000');
  });

  it('darkens the team colors for the boards, so that the players stand out', () => {
    expect(shade('#ffd700', 0.5)).toBe('#806c00');
    expect(shade('#00bfff', 0.32)).toBe('#003d52');
    expect(shade('rgb(255, 255, 255)', 0)).toBe('#000000');
    expect(shade('gold', 0.5)).toBe('gold'); // not read: as it is
  });

  it('floats the banners above the goals, seen from the pitch', () => {
    // From the other end and from near, the banner is well above the crossbar.
    for (const [distance, eye] of [
      [PITCH.length, EYE_HEIGHT],
      [20, EYE_HEIGHT],
      [20, SHOULDER.height],
    ] as const) {
      const toBanner = distance + BANNER.behind;
      const crossbar = Math.atan2(GOAL_HEIGHT - eye, distance) * RAD2DEG;
      const bottom = Math.atan2(BANNER.bottom - eye, toBanner) * RAD2DEG;
      expect(bottom - crossbar).toBeGreaterThan(3); // degrees: 4.2 from the other end
    }
  });

  it('keeps the banners behind the goal camera and the boards under its view', () => {
    const camera = goalPose(-1, { x: 0, y: 0 }).position;
    const behindGoalLine = -PITCH.length / 2 - camera.x;
    expect(BANNER.behind).toBeGreaterThan(behindGoalLine);
    // The line from the camera down to the goal line passes over the boards.
    const over = (camera.y * BOARDS.offset) / behindGoalLine;
    expect(over).toBeGreaterThan(BOARDS.height);
    // Outside where the players can go.
    expect(BOARDS.offset).toBeGreaterThan(PITCH.margin);
  });
});
