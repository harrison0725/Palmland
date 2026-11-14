import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

/**
 * Reads WebXR hand-tracking joints every frame and derives the few signals the
 * game needs: palm centre, palm normal, hand forward, openness and pinch.
 * Everything is in world space and lightly smoothed to hide tracking jitter.
 */
export type Side = 'left' | 'right';

const JOINTS = [
  'wrist',
  'thumb-tip',
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
  'index-finger-phalanx-proximal',
  'middle-finger-phalanx-proximal',
  'pinky-finger-phalanx-proximal',
  'middle-finger-metacarpal',
] as const;
type JointName = (typeof JOINTS)[number];

export class HandState {
  tracked = false;
  /** Seconds since tracking was last valid. */
  lostFor = 999;
  readonly joints = new Map<JointName, Vector3>();
  readonly palmCenter = new Vector3();
  /** Unit vector pointing out of the palm. */
  readonly palmNormal = new Vector3(0, 1, 0);
  /** Unit vector from wrist towards the fingers, projected onto the palm. */
  readonly forward = new Vector3(0, 0, -1);
  /** 0 = fist, 1 = flat open hand. Smoothed. */
  openness = 1;
  pinching = false;
  readonly pinchPoint = new Vector3();
  readonly indexTip = new Vector3();
  private rawOpen = 1;
  ratio = 0;
  private readonly tmpQ = new Quaternion();
  private readonly tmpV = new Vector3();
  private readonly tmpM = new Matrix4();
  private initialised = false;

  constructor(readonly side: Side) {
    for (const j of JOINTS) this.joints.set(j, new Vector3());
  }

  get(j: JointName): Vector3 {
    return this.joints.get(j)!;
  }

  update(
    frame: XRFrame | null | undefined,
    refSpace: XRReferenceSpace | null | undefined,
    origin: Matrix4,
    dt: number,
  ): void {
    const source = this.findSource(frame);
    if (!frame || !refSpace || !source?.hand) {
      this.markLost(dt);
      return;
    }
    const hand = source.hand;
    let ok = true;
    let palmQuat: Quaternion | null = null;
    for (const name of JOINTS) {
      const space = hand.get(name as XRHandJoint);
      const pose = space ? frame.getJointPose?.(space, refSpace) : undefined;
      if (!pose) {
        ok = false;
        break;
      }
      const p = pose.transform.position;
      this.tmpV.set(p.x, p.y, p.z).applyMatrix4(origin);
      const target = this.get(name);
      if (!this.initialised || !this.tracked) target.copy(this.tmpV);
      else target.lerp(this.tmpV, Math.min(1, dt * 22));
      if (name === 'middle-finger-metacarpal') {
        const o = pose.transform.orientation;
        this.tmpQ.set(o.x, o.y, o.z, o.w);
        this.tmpM.extractRotation(origin);
        this.tmpQ.premultiply(new Quaternion().setFromRotationMatrix(this.tmpM));
        palmQuat = this.tmpQ;
      }
    }
    if (!ok) {
      this.markLost(dt);
      return;
    }
    this.initialised = true;
    this.tracked = true;
    this.lostFor = 0;

    const wrist = this.get('wrist');
    const knuckle = this.get('middle-finger-phalanx-proximal');
    this.palmCenter.copy(wrist).lerp(knuckle, 0.6);

    // WebXR joint convention: -Y of a joint points out of the palm.
    if (palmQuat) {
      this.tmpV.set(0, -1, 0).applyQuaternion(palmQuat);
      this.palmNormal.lerp(this.tmpV, Math.min(1, dt * 18)).normalize();
    }
    this.forward.copy(knuckle).sub(wrist);
    this.forward
      .addScaledVector(this.palmNormal, -this.forward.dot(this.palmNormal))
      .normalize();

    const size = Math.max(0.03, wrist.distanceTo(knuckle));
    let sum = 0;
    for (const t of [
      'index-finger-tip',
      'middle-finger-tip',
      'ring-finger-tip',
      'pinky-finger-tip',
    ] as const) {
      sum += this.get(t).distanceTo(this.palmCenter);
    }
    const ratio = sum / 4 / size; // ~1.5 open, ~0.6 fist
    this.ratio = ratio;
    this.rawOpen = Math.min(1, Math.max(0, (ratio - 0.4) / 0.75));
    this.openness += (this.rawOpen - this.openness) * Math.min(1, dt * 6);

    const thumb = this.get('thumb-tip');
    const index = this.get('index-finger-tip');
    this.indexTip.copy(index);
    const pinchDist = thumb.distanceTo(index);
    // Hysteresis so a pinch doesn't flicker.
    this.pinching = this.pinching ? pinchDist < 0.035 : pinchDist < 0.022;
    this.pinchPoint.copy(thumb).lerp(index, 0.5);
  }

  private markLost(dt: number): void {
    this.lostFor += dt;
    if (this.lostFor > 0.5) {
      this.tracked = false;
      this.pinching = false;
    }
  }

  private findSource(frame: XRFrame | null | undefined): XRInputSource | null {
    const session = frame?.session;
    if (!session) return null;
    for (const s of session.inputSources) {
      if (s.handedness === this.side && s.hand) return s;
    }
    return null;
  }
}
