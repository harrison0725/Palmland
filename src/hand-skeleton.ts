import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

/**
 * A soft, stylised hand drawn from the 25 WebXR joints. Used for demo
 * recordings and desktop emulation, where the player's real hands are not
 * visible through passthrough.
 */
export const ALL_JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
] as const;

// Bone pairs (indices into ALL_JOINTS), plus palm webbing between knuckles.
const BONES: [number, number][] = [];
for (const base of [1, 5, 10, 15, 20]) {
  BONES.push([0, base]);
  const len = base === 1 ? 3 : 4;
  for (let i = 0; i < len; i++) BONES.push([base + i, base + i + 1]);
}
BONES.push([6, 11], [11, 16], [16, 21], [2, 6]);

export class HandSkeleton {
  readonly joints: InstancedMesh;
  readonly bones: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly a = new Vector3();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly dir = new Vector3();

  constructor() {
    const mat = new MeshStandardMaterial({ color: 0xf1c7a6, roughness: 0.6, transparent: true, opacity: 0.92 });
    this.joints = new InstancedMesh(new SphereGeometry(1, 10, 8), mat, ALL_JOINTS.length * 2);
    this.bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8), mat, BONES.length * 2);
    this.joints.frustumCulled = false;
    this.bones.frustumCulled = false;
    this.hide(0);
    this.hide(1);
  }

  hide(handIndex: number): void {
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < ALL_JOINTS.length; i++) this.joints.setMatrixAt(handIndex * ALL_JOINTS.length + i, this.m);
    for (let i = 0; i < BONES.length; i++) this.bones.setMatrixAt(handIndex * BONES.length + i, this.m);
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
  }

  update(handIndex: number, pts: Vector3[]): void {
    for (let i = 0; i < ALL_JOINTS.length; i++) {
      const r = i === 0 ? 0.016 : i % 5 === 0 || i === 4 ? 0.0075 : 0.0095;
      this.m.makeScale(r, r, r).setPosition(pts[i]);
      this.joints.setMatrixAt(handIndex * ALL_JOINTS.length + i, this.m);
    }
    for (let b = 0; b < BONES.length; b++) {
      const p0 = pts[BONES[b][0]];
      const p1 = pts[BONES[b][1]];
      this.dir.copy(p1).sub(p0);
      const len = this.dir.length();
      this.a.copy(p0).lerp(p1, 0.5);
      this.q.setFromUnitVectors(this.up, this.dir.normalize());
      const r = BONES[b][0] === 0 ? 0.011 : 0.0085;
      this.s.set(r, len, r);
      this.m.compose(this.a, this.q, this.s);
      this.bones.setMatrixAt(handIndex * BONES.length + b, this.m);
    }
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
  }
}
