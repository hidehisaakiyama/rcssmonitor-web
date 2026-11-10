// The human figures: a rigged glTF model with its animations (the CC0
// Quaternius Mannequin, models/README.md). Each player has a copy of the
// model and an animation mixer:
// - the idle, walk, run and sprint clips mixed by the speed, each at the
//   time of the distance walked (pose.ts gaitAt) over its own speed, and the
//   idle one at the game's time: so a frame shows the same however it is
//   reached, and stepping back walks back;
// - the head turned by the neck; the kick, the tackle and the fall after a
//   foul (pose.ts) put on the legs and the upper body over the clips, the
//   catch, the fall and the pointing on the arms. The axes are the model's (forward, up, across), taken into
//   each bone's parent, so that any rig works.
// The mixer writes a bone only when its clips' value changes, so a bone
// turned over the clips keeps the turn when the same time is drawn again
// (while a camera glides after a step): each turn is undone first then
// (Overlay), not turned again on top of the last.
// The jersey material is copied for each player, in its color. The figures
// are FIGURE_SCALE times a person's size, to be seen from afar.
import {
  AnimationMixer,
  Box3,
  Group,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type AnimationAction,
  type Bone,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { MAX_PLAYER } from '../../../core/constants';
import { DEG2RAD } from '../../../core/geometry';
import type { FigureInput, Figures, FigureState, FigureTime } from './figures';
import { gaitAt, poseOf, speedOf, type LimbPose } from './pose';
import mannequinUrl from './models/Mannequin.glb?url';

/** What a model offers, by name. */
export interface ModelRig {
  readonly url: string;
  readonly clips: {
    readonly idle: string;
    readonly walk: string;
    readonly run: string;
    readonly sprint?: string;
  };
  /** How fast the walk, run and sprint clips go at their own speed (m/s). */
  readonly walkSpeed: number;
  readonly runSpeed: number;
  readonly sprintSpeed?: number;
  readonly bones: {
    readonly head: string;
    /** Leaned for the upper body (not the legs' parent). */
    readonly spine: string;
    readonly upperLeg: { readonly L: string; readonly R: string };
    readonly lowerLeg: { readonly L: string; readonly R: string };
    readonly upperArm: { readonly L: string; readonly R: string };
  };
  /** The materials painted in the jersey color. */
  readonly jersey: readonly string[];
}

/** Quaternius' Mannequin (Universal Animation Library), an Unreal-like rig. */
export const MANNEQUIN: ModelRig = {
  url: mannequinUrl,
  clips: { idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop' },
  walkSpeed: 1.4,
  runSpeed: 3.6,
  sprintSpeed: 6.5,
  bones: {
    head: 'Head',
    spine: 'spine_02',
    upperLeg: { L: 'thigh_l', R: 'thigh_r' },
    lowerLeg: { L: 'calf_l', R: 'calf_r' },
    upperArm: { L: 'upperarm_l', R: 'upperarm_r' },
  },
  jersey: ['M_Main'],
};

/** How much larger than a person (1.85 m) the figures are drawn, to be seen from afar. */
export const FIGURE_SCALE = 1.2;
const HEIGHT = 1.85 * FIGURE_SCALE;

/** A bone turned over the clips: as the clips had it, and as turned. */
interface Overlay {
  readonly base: Quaternion;
  readonly applied: Quaternion;
  /** Turned in this update. */
  touched: boolean;
}

/** One player's copy of the model. */
interface Figure {
  readonly root: Object3D;
  readonly mixer: AnimationMixer;
  readonly idle: AnimationAction;
  readonly walk: AnimationAction;
  readonly run: AnimationAction;
  readonly sprint?: AnimationAction;
  readonly jersey: MeshStandardMaterial[];
  readonly bones: {
    head?: Bone;
    spine?: Bone;
    upperLeg: { L?: Bone; R?: Bone };
    lowerLeg: { L?: Bone; R?: Bone };
    upperArm: { L?: Bone; R?: Bone };
  };
  /** The bones turned over the clips in the last update. */
  readonly overlays: Map<Bone, Overlay>;
}

/** Puts a looping clip at `seconds` of its time, forward or back. */
function playAt(action: AnimationAction | undefined, seconds: number): void {
  if (!action) {
    return;
  }
  const d = action.getClip().duration || 1;
  action.time = ((seconds % d) + d) % d;
}

export class GltfFigures implements Figures {
  readonly group = new Group();
  private figures: Figure[] = [];
  private scale = 1;
  private ready = false;
  private failed = '';
  private state: FigureState = {
    model: 'figure',
    ready: false,
    drawn: 0,
    kicks: 0,
    tackles: 0,
    catches: 0,
    fouled: 0,
    knees: [],
    heads: [],
  };
  // Reused.
  private readonly q = new Quaternion();
  private readonly axis = new Vector3();
  private readonly parentQ = new Quaternion();
  private readonly rootQ = new Quaternion();

  constructor(
    private readonly rig: ModelRig = MANNEQUIN,
    private readonly onReady: () => void = () => {},
  ) {
    void new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .loadAsync(rig.url)
      .then((gltf) => this.build(gltf))
      .catch((e: unknown) => {
        this.failed = e instanceof Error ? e.message : String(e);
      });
  }

  update(players: readonly FigureInput[], time: FigureTime): void {
    if (!this.ready) {
      return;
    }
    const counts = { kicks: 0, tackles: 0, catches: 0, fouled: 0 };
    const drawn = new Set<number>();
    for (const input of players) {
      const f = this.figures[input.index];
      if (!f) {
        continue;
      }
      drawn.add(input.index);
      const p = input.player;
      const gait = gaitAt(time, input.index);
      const pose = poseOf(p, input.index, gait.phase, time);
      if (pose.action === 'kick') {
        ++counts.kicks;
      } else if (pose.action === 'tackle') {
        ++counts.tackles;
      } else if (pose.action === 'catch') {
        ++counts.catches;
      } else if (pose.action === 'fouled') {
        ++counts.fouled;
      }
      // Idle, walk, run and sprint by the speed; still while acting.
      const v = speedOf(p, time.step);
      const acting =
        pose.action === 'kick' || pose.action === 'tackle' || pose.action === 'fouled' ? 1 : 0;
      const ramp = (x: number) => Math.min(1, Math.max(0, x));
      const sprint = f.sprint ? ramp((v - 5) / 1.5) * (1 - acting) : 0;
      const run = ramp((v - 2) / 1.5) * (1 - sprint) * (1 - acting);
      const walk = ramp(v / 0.8) * (1 - run - sprint) * (1 - acting);
      f.sprint?.setEffectiveWeight(sprint);
      f.run.setEffectiveWeight(run);
      f.walk.setEffectiveWeight(walk);
      f.idle.setEffectiveWeight(Math.max(0, 1 - walk - run - sprint));
      // Where the clips are, from the log: then the mixer only applies them.
      playAt(f.idle, (time.frameIndex + time.alpha) * time.step + input.index * 0.53);
      playAt(f.walk, gait.distance / this.rig.walkSpeed);
      playAt(f.run, gait.distance / this.rig.runSpeed);
      playAt(f.sprint, gait.distance / (this.rig.sprintSpeed ?? 6.5));
      f.mixer.update(0);
      this.undoTurns(f);

      // glTF models look along +Z; field direction d is +X turned by -d.
      f.root.position.set(p.x, -pose.drop, p.y);
      f.root.rotation.y = Math.PI / 2 - p.body * DEG2RAD;
      f.root.visible = true;
      for (const m of f.jersey) {
        m.color.copy(input.color);
      }
      f.root.updateMatrixWorld(true);
      // Over the clips: the head by the neck, the legs when kicking or tackling.
      this.turn(f, f.bones.head, 'up', -pose.head);
      if (acting) {
        // Forward is about +X toward +Z: the pose's lean as it is.
        this.turn(f, f.bones.spine, 'right', pose.lean * 0.5);
        this.leg(f, 'L', pose.legL);
        this.leg(f, 'R', pose.legR);
      }
      // The arms: up for the goalie's catch, behind on the ground when down, the right one pointing.
      if (pose.action === 'catch' || pose.action === 'fouled') {
        this.arm(f, 'L', pose.armL);
        this.arm(f, 'R', pose.armR);
      } else if (p.point && pose.action === null) {
        this.arm(f, 'R', pose.armR);
      }
      this.keepTurns(f);
    }
    this.figures.forEach((f, i) => {
      f.root.visible = drawn.has(i);
    });
    this.state = {
      model: 'figure',
      ready: true,
      drawn: drawn.size,
      ...counts,
      knees: [],
      heads: [],
    };
  }

  inspect(): FigureState {
    const at = new Vector3();
    const round = (v: number) => Math.round(v * 1e4) / 1e4;
    const knees = this.figures.map((f) => {
      const knee = f.bones.lowerLeg.L;
      if (!f.root.visible || !knee) {
        return null;
      }
      knee.getWorldPosition(at);
      return { x: round(at.x), y: round(at.y), z: round(at.z) };
    });
    const q = new Quaternion();
    const heads = this.figures.map((f) => {
      const head = f.bones.head;
      if (!f.root.visible || !head) {
        return null;
      }
      head.getWorldQuaternion(q);
      return [q.x, q.y, q.z, q.w].map(round);
    });
    return { ...this.state, knees, heads };
  }

  /** Why the model did not load, if it did not. */
  get error(): string {
    return this.failed;
  }

  dispose(): void {
    for (const f of this.figures) {
      f.mixer.stopAllAction();
      for (const m of f.jersey) {
        m.dispose();
      }
    }
    this.figures = [];
  }

  private build(gltf: GLTF): void {
    const box = new Box3().setFromObject(gltf.scene);
    this.scale = HEIGHT / Math.max(1e-3, box.max.y - box.min.y);
    const clip = (name: string) => gltf.animations.find((a) => a.name === name);
    const idleClip = clip(this.rig.clips.idle);
    const walkClip = clip(this.rig.clips.walk);
    const runClip = clip(this.rig.clips.run);
    const sprintClip = this.rig.clips.sprint ? clip(this.rig.clips.sprint) : undefined;
    if (!idleClip || !walkClip || !runClip) {
      this.failed = 'the model lacks the idle, walk or run animation';
      return;
    }
    for (let i = 0; i < 2 * MAX_PLAYER; ++i) {
      const root = clone(gltf.scene);
      root.scale.setScalar(this.scale);
      root.visible = false;
      const jersey: MeshStandardMaterial[] = [];
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) {
          return;
        }
        mesh.frustumCulled = false; // the animated bounds are not the bind pose's
        const swap = (m: Material) => {
          if (this.rig.jersey.includes(m.name) && m instanceof MeshStandardMaterial) {
            const own = m.clone();
            jersey.push(own);
            return own;
          }
          return m;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(swap)
          : swap(mesh.material);
      });
      const bone = (name: string) => (root.getObjectByName(name) as Bone | undefined) ?? undefined;
      const mixer = new AnimationMixer(root);
      const play = (c: typeof idleClip) => {
        const a = mixer.clipAction(c);
        a.play();
        a.setEffectiveWeight(0);
        return a;
      };
      const b = this.rig.bones;
      this.figures.push({
        root,
        mixer,
        idle: play(idleClip),
        walk: play(walkClip),
        run: play(runClip),
        ...(sprintClip ? { sprint: play(sprintClip) } : {}),
        jersey,
        bones: {
          head: bone(b.head),
          spine: bone(b.spine),
          upperLeg: { L: bone(b.upperLeg.L), R: bone(b.upperLeg.R) },
          lowerLeg: { L: bone(b.lowerLeg.L), R: bone(b.lowerLeg.R) },
          upperArm: { L: bone(b.upperArm.L), R: bone(b.upperArm.R) },
        },
        overlays: new Map(),
      });
      this.group.add(root);
    }
    this.ready = true;
    this.onReady();
  }

  /**
   * A leg as the pose has it: swung by the pitch, then turned by the yaw
   * (turning a hanging leg first would not show), and the knee's bend.
   */
  private leg(f: Figure, side: 'L' | 'R', l: LimbPose): void {
    this.turn(f, f.bones.lowerLeg[side], 'right', l.bend);
    this.turn(f, f.bones.upperLeg[side], 'right', -l.pitch);
    this.turn(f, f.bones.upperLeg[side], 'up', -l.yaw);
  }

  /** An arm as the pose has it, over the clip's: raised by the pitch, then turned by the yaw. */
  private arm(f: Figure, side: 'L' | 'R', a: LimbPose): void {
    this.turn(f, f.bones.upperArm[side], 'right', -a.pitch);
    this.turn(f, f.bones.upperArm[side], 'up', -a.yaw);
  }

  /**
   * Back to the clips' pose where the mixer did not write it again (its
   * value did not change): those bones are still as the last update turned them.
   */
  private undoTurns(f: Figure): void {
    for (const [bone, o] of f.overlays) {
      if (bone.quaternion.equals(o.applied)) {
        bone.quaternion.copy(o.base);
      }
      o.touched = false;
    }
  }

  /** Keeps how the bones turned in this update are, and forgets the others. */
  private keepTurns(f: Figure): void {
    for (const [bone, o] of f.overlays) {
      if (o.touched) {
        o.applied.copy(bone.quaternion);
      } else {
        f.overlays.delete(bone);
      }
    }
  }

  /**
   * Turns a bone by `deg` degrees about one of the model's axes (+Y up,
   * +X across: a model looking along +Z has its right at -X), taken into
   * the bone's parent so that it turns about its own joint.
   */
  private turn(f: Figure, bone: Bone | undefined, about: 'up' | 'right', deg: number): void {
    if (!bone?.parent || Math.abs(deg) < 1e-3) {
      return;
    }
    let o = f.overlays.get(bone);
    if (!o) {
      o = { base: new Quaternion(), applied: new Quaternion(), touched: false };
      f.overlays.set(bone, o);
    }
    if (!o.touched) {
      o.base.copy(bone.quaternion);
      o.touched = true;
    }
    f.root.getWorldQuaternion(this.rootQ);
    bone.parent.getWorldQuaternion(this.parentQ);
    this.axis.set(about === 'up' ? 0 : 1, about === 'up' ? 1 : 0, 0);
    this.axis.applyQuaternion(this.rootQ).applyQuaternion(this.parentQ.invert()).normalize();
    this.q.setFromAxisAngle(this.axis, deg * DEG2RAD);
    bone.quaternion.premultiply(this.q);
    bone.updateMatrixWorld(true);
  }
}
