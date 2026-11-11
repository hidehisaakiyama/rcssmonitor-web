import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerStateBit, Side } from '../../src/core/constants';
import { disabledPlayer } from '../../src/core/frame';
import { DEFAULT_PLAYER_TYPE, DEFAULT_SERVER_PARAM } from '../../src/core/params';
import {
  ballCenterHeight,
  ballRadius,
  fitCameraPosition,
  playerColor,
  playerSize,
  shadowOpacity,
  toWorld,
  yaw,
} from '../../src/view/render3d/scene-math';
import { DEFAULT_PALETTE } from '../../src/view/palette';
import { DEFAULT_VIEW_OPTIONS } from '../../src/view/view-state';

const Y = new Vector3(0, 1, 0);

describe('3D scene geometry', () => {
  it('puts the field on the ground, the height up', () => {
    expect(toWorld(10, -5)).toEqual({ x: 10, y: 0, z: -5 });
    expect(toWorld(10, -5, 2)).toEqual({ x: 10, y: 2, z: -5 });
  });

  it('turns +X to a field direction, clockwise on the screen', () => {
    for (const deg of [0, 30, 90, -45, 180]) {
      const v = new Vector3(1, 0, 0).applyAxisAngle(Y, yaw(deg));
      const rad = (deg * Math.PI) / 180;
      // Field direction (cos, sin) is world (X, Z).
      expect(v.x).toBeCloseTo(Math.cos(rad));
      expect(v.y).toBeCloseTo(0);
      expect(v.z).toBeCloseTo(Math.sin(rad));
    }
  });

  it('fits the pitch in the default camera view', () => {
    for (const aspect of [1.0, 1.4, 1.8, 2.4]) {
      const fov = 35;
      const { position, target } = fitCameraPosition(fov, aspect);
      const camera = new PerspectiveCamera(fov, aspect, 0.5, 2000);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(target.x, target.y, target.z);
      camera.updateMatrixWorld();
      const ndc = [-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => new Vector3(sx * 54.5, 0, sz * 36).project(camera)),
      );
      const maxX = Math.max(...ndc.map((v) => Math.abs(v.x)));
      const maxY = Math.max(...ndc.map((v) => Math.abs(v.y)));
      expect(maxX).toBeLessThanOrEqual(0.97 + 1e-9);
      expect(maxY).toBeLessThanOrEqual(0.85 + 1e-9);
      // As close as it can be: one of the limits is reached.
      expect(Math.max(maxX / 0.97, maxY / 0.85)).toBeCloseTo(1, 6);
    }
  });

  it('stands the ball at its height and fades its shadow', () => {
    const r = ballRadius(DEFAULT_VIEW_OPTIONS, DEFAULT_SERVER_PARAM);
    expect(r).toBe(0.35); // the 2D default Ball Size
    expect(ballRadius({ ...DEFAULT_VIEW_OPTIONS, ballSize: 0 }, DEFAULT_SERVER_PARAM)).toBe(0.085);
    const ground = { x: 0, y: 0, vx: 0, vy: 0 };
    expect(ballCenterHeight(ground, r)).toBe(0.35);
    expect(ballCenterHeight({ ...ground, z: 3 }, r)).toBe(3.35);
    expect(ballCenterHeight({ ...ground, z: -1 }, r)).toBe(0.35); // never below the ground
    expect(shadowOpacity({ ...ground, z: 8 })).toBeLessThan(shadowOpacity(ground));
  });

  it('sizes and colors the players as the 2D view', () => {
    const t = DEFAULT_PLAYER_TYPE;
    expect(playerSize(DEFAULT_VIEW_OPTIONS, DEFAULT_SERVER_PARAM, t)).toEqual({
      body: 0.3,
      ground: 0.3 + 0.7 + 0.085, // the kickable area
    });
    expect(
      playerSize({ ...DEFAULT_VIEW_OPTIONS, playerSize: 1.5 }, DEFAULT_SERVER_PARAM, t).ground,
    ).toBe(1.5);
    const p = { ...disabledPlayer(0), state: PlayerStateBit.Stand };
    expect(playerColor(DEFAULT_PALETTE, p)).toBe(DEFAULT_PALETTE.leftTeam);
    expect(
      playerColor(DEFAULT_PALETTE, { ...p, state: PlayerStateBit.Stand | PlayerStateBit.Goalie }),
    ).toBe(DEFAULT_PALETTE.leftGoalie);
    expect(playerColor(DEFAULT_PALETTE, { ...p, side: Side.Right })).toBe(
      DEFAULT_PALETTE.rightTeam,
    );
    expect(playerColor(DEFAULT_PALETTE, disabledPlayer(3))).toBe('#000000');
  });
});
