import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PITCH } from '../../src/core/constants';
import {
  CAMERA_FOV,
  nextViewpoint,
  viewpointPose,
  VIEWPOINTS,
} from '../../src/view/render3d/cameras';
import { fitCameraPosition, fitView } from '../../src/view/render3d/scene-math';

/** Where the corners of the pitch and 2 m around it are on the screen (NDC) from a pose. */
function corners(pose: ReturnType<typeof viewpointPose>, aspect: number) {
  const camera = new PerspectiveCamera(pose.fov, aspect, 0.1, 2000);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateMatrixWorld();
  const out: { x: number; y: number }[] = [];
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const v = new Vector3(x * (PITCH.length / 2 + 2), 0, z * (PITCH.width / 2 + 2)).project(
        camera,
      );
      out.push({ x: v.x, y: v.y });
    }
  }
  return out;
}

describe('the viewpoints of the whole pitch', () => {
  it('start with where the free camera starts', () => {
    for (const aspect of [16 / 9, 4 / 3, 1]) {
      const fit = fitCameraPosition(CAMERA_FOV, aspect);
      const side = viewpointPose('side', aspect);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(side.position[k]).toBeCloseTo(fit.position[k], 6);
      }
      expect(fitView(90, 32, CAMERA_FOV, aspect).position.z).toBeCloseTo(fit.position.z, 6);
    }
  });

  it('each have the whole pitch on the screen, as near as it fits', () => {
    for (const aspect of [16 / 9, 4 / 3, 0.8]) {
      for (const vp of VIEWPOINTS) {
        const c = corners(viewpointPose(vp, aspect), aspect);
        for (const p of c) {
          // 3% free at the sides, 15% above and below for the logos and the score board.
          expect(Math.abs(p.x), vp).toBeLessThanOrEqual(0.97 + 1e-6);
          expect(Math.abs(p.y), vp).toBeLessThanOrEqual(0.85 + 1e-6);
        }
        // A corner touches a limit: no nearer would do.
        const tight = c.some(
          (p) => Math.abs(Math.abs(p.x) - 0.97) < 1e-3 || Math.abs(Math.abs(p.y) - 0.85) < 1e-3,
        );
        expect(tight, vp).toBe(true);
      }
    }
  });

  it('look from where they say', () => {
    const at = (vp: (typeof VIEWPOINTS)[number]) => viewpointPose(vp, 16 / 9).position;
    expect(at('side').z).toBeGreaterThan(0); // the near touch line: +y, +Z
    expect(at('far-side').z).toBeLessThan(0);
    expect(at('left-end').x).toBeLessThan(0);
    expect(at('right-end').x).toBeGreaterThan(0);
    // Steeper from high above.
    const steep = (p: { x: number; y: number; z: number }) => p.y / Math.hypot(p.x, p.z);
    expect(steep(at('high'))).toBeGreaterThan(steep(at('side')) * 2);
    expect(Math.sign(at('near-left').x)).toBe(-1);
    expect(Math.sign(at('near-left').z)).toBe(1);
    expect(Math.sign(at('far-right').x)).toBe(1);
    expect(Math.sign(at('far-right').z)).toBe(-1);
  });

  it('go round with Ctrl+I', () => {
    expect(nextViewpoint(null)).toBe('side');
    expect(nextViewpoint('side')).toBe('far-side');
    expect(nextViewpoint('far-right')).toBe('side');
    const seen = new Set<string>();
    let vp = nextViewpoint(null);
    for (let i = 0; i < VIEWPOINTS.length; ++i) {
      seen.add(vp);
      vp = nextViewpoint(vp);
    }
    expect(seen.size).toBe(VIEWPOINTS.length);
  });
});
