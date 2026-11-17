import {
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';

/** Ground height of the grass top in island-local metres. */
export const GROUND_Y = 0.0062;

const shadowGeo = new CircleGeometry(1, 16);
shadowGeo.rotateX(-Math.PI / 2);
const shadowMat = new MeshBasicMaterial({
  color: 0x1a2a10,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/** A soft round contact shadow that sits on the grass. */
export function blobShadow(radius: number): Mesh {
  const m = new Mesh(shadowGeo, shadowMat);
  m.scale.setScalar(radius);
  m.position.y = GROUND_Y + 0.0001;
  m.renderOrder = 1;
  return m;
}

/**
 * Pooled particle bursts in island-local space: leaves when a tree is planted,
 * sparkles when a step completes, splashes when a field is watered.
 * Everything is preallocated so bursts never allocate during play.
 */
export class Particles {
  readonly mesh: InstancedMesh;
  private readonly pos: Vector3[] = [];
  private readonly vel: Vector3[] = [];
  private readonly life: number[] = [];
  private readonly maxLife: number[] = [];
  private readonly size: number[] = [];
  private readonly gravity: number[] = [];
  private readonly spin: number[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly axis = new Vector3(0.3, 1, 0.2).normalize();
  private readonly c = new Color();
  private next = 0;
  private alive = 0;

  constructor(private readonly count = 96) {
    this.mesh = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: 0xffffff }),
      count,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) {
      this.pos.push(new Vector3());
      this.vel.push(new Vector3());
      this.life.push(0);
      this.maxLife.push(1);
      this.size.push(0.001);
      this.gravity.push(0);
      this.spin.push(0);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.set(0xffffff));
    }
  }

  burst(
    at: Vector3,
    color: number,
    n: number,
    opts: { speed?: number; up?: number; size?: number; life?: number; gravity?: number } = {},
  ): void {
    const speed = opts.speed ?? 0.03;
    const up = opts.up ?? 0.04;
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.count;
      const a = Math.random() * Math.PI * 2;
      const r = speed * (0.4 + Math.random() * 0.6);
      this.pos[i].copy(at);
      this.vel[i].set(Math.cos(a) * r, up * (0.6 + Math.random() * 0.8), Math.sin(a) * r);
      this.maxLife[i] = this.life[i] = (opts.life ?? 0.7) * (0.7 + Math.random() * 0.6);
      this.size[i] = (opts.size ?? 0.0009) * (0.7 + Math.random() * 0.6);
      this.gravity[i] = opts.gravity ?? 0.12;
      this.spin[i] = Math.random() * 6;
      // Slight colour variation keeps bursts from looking flat.
      this.c.set(color).offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.12);
      this.mesh.setColorAt(i, this.c);
    }
    this.alive = this.count;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    let any = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const v = this.vel[i];
      v.y -= this.gravity[i] * dt;
      v.multiplyScalar(1 - Math.min(1, dt * 2.5));
      const p = this.pos[i].addScaledVector(v, dt);
      if (p.y < GROUND_Y) {
        p.y = GROUND_Y;
        v.y *= -0.3;
      }
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      // Pop in fast, shrink out smoothly.
      const k = Math.min(1, (1 - t) * 8) * Math.sqrt(t);
      const s = this.life[i] > 0 ? this.size[i] * k : 0;
      this.spin[i] += dt * 5;
      this.q.setFromAxisAngle(this.axis, this.spin[i]);
      this.m.compose(p, this.q, this.s.set(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
      if (this.life[i] > 0) any++;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive = any;
  }
}

/** Expanding rings on the pond surface. */
export class Ripples {
  readonly group = new Group();
  private readonly rings: Mesh[] = [];
  private readonly age: number[] = [];
  private readonly mats: MeshBasicMaterial[] = [];
  private timer = 0;
  private next = 0;

  constructor(n = 4) {
    const geo = new RingGeometry(0.86, 1, 24);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const mat = new MeshBasicMaterial({
        color: 0xe8f6ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const ring = new Mesh(geo, mat);
      ring.visible = false;
      ring.renderOrder = 2;
      this.group.add(ring);
      this.rings.push(ring);
      this.mats.push(mat);
      this.age.push(-1);
    }
  }

  /** Start a ripple at an island-local x/z (relative to the pond group). */
  spawn(x: number, z: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.rings.length;
    this.age[i] = 0;
    this.rings[i].position.set(x, 0, z);
    this.rings[i].visible = true;
  }

  update(dt: number, radius: number, calm: number): void {
    this.timer -= dt;
    if (this.timer <= 0 && calm > 0.2) {
      this.timer = 1.6 + Math.random() * 1.6;
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * radius * 0.5;
      this.spawn(Math.cos(a) * d, Math.sin(a) * d);
    }
    for (let i = 0; i < this.rings.length; i++) {
      if (this.age[i] < 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / 1.8;
      if (t >= 1) {
        this.age[i] = -1;
        this.rings[i].visible = false;
        continue;
      }
      const s = radius * (0.12 + 0.55 * t);
      this.rings[i].scale.set(s, 1, s);
      this.mats[i].opacity = 0.55 * (1 - t) * Math.min(1, t * 6);
    }
  }
}
