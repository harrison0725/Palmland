import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { GROUND_Y } from './fx.js';

const ZERO = new Matrix4().makeScale(0, 0, 0);
const Y = new Vector3(0, 1, 0);

/**
 * Butterflies by day that turn into glowing fireflies at night.
 * One instanced mesh, two wing instances per critter, no allocation per frame.
 */
export class Critters {
  readonly mesh: InstancedMesh;
  private readonly phase: number[] = [];
  private readonly radius: number[] = [];
  private readonly height: number[] = [];
  private readonly speed: number[] = [];
  private readonly day: Color[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly c = new Color();
  private readonly glow = new Color(0xfff27a);

  constructor(private readonly count: number, islandR: number) {
    const geo = new PlaneGeometry(1, 1);
    geo.translate(0.5, 0, 0); // hinge on the body so wings flap about it
    // Pinch the hinge edge so each quad reads as a tapered wing, not a card.
    const pa = geo.getAttribute('position');
    for (let i = 0; i < pa.count; i++) if (pa.getX(i) < 0.01) pa.setY(i, pa.getY(i) * 0.25);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(
      geo,
      new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, transparent: true, depthWrite: false }),
      count * 2,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const palette = [0xffb347, 0xff7eb6, 0x8fd3ff, 0xfff27a, 0xc49bff, 0xffffff];
    for (let i = 0; i < count; i++) {
      this.phase.push(i * 2.399);
      this.radius.push(islandR * (0.25 + 0.6 * ((i * 0.618) % 1)));
      this.height.push(0.012 + 0.014 * ((i * 0.377) % 1));
      this.speed.push(0.35 + 0.3 * ((i * 0.791) % 1));
      this.day.push(new Color(palette[i % palette.length]));
      this.mesh.setMatrixAt(i * 2, ZERO);
      this.mesh.setMatrixAt(i * 2 + 1, ZERO);
      this.mesh.setColorAt(i * 2, this.day[i]);
      this.mesh.setColorAt(i * 2 + 1, this.day[i]);
    }
  }

  /** `show` 0..1 fades the whole swarm in; `night` 0..1 turns wings into glows. */
  update(time: number, night: number, show: number): void {
    const size = 0.0042 * show;
    for (let i = 0; i < this.count; i++) {
      const t = time * this.speed[i] + this.phase[i];
      // A wobbly loop around the island, never quite repeating.
      const r = this.radius[i] * (0.8 + 0.2 * Math.sin(t * 1.7));
      this.p.set(
        Math.cos(t) * r + Math.sin(t * 2.3) * 0.004,
        GROUND_Y + this.height[i] + Math.sin(t * 3.1 + i) * 0.004,
        Math.sin(t * 1.13) * r + Math.cos(t * 1.9) * 0.004,
      );
      const heading = Math.atan2(-Math.sin(t) * r, Math.cos(t * 1.13) * r * 1.13);
      this.q.setFromAxisAngle(Y, heading);
      // Wings beat by day and fold into a tiny pulsing dot at night.
      const flap = Math.sin(time * 22 + i * 1.3) * 1.0 * (1 - night);
      const pulse = 0.55 + 0.45 * Math.sin(time * 3 + i * 2.1);
      const sz = size * (1 - night * 0.55) * (night > 0.5 ? pulse : 1);
      for (let w = 0; w < 2; w++) {
        const sign = w === 0 ? 1 : -1;
        this.q2.copy(this.q);
        this.s.set(sign * sz, sz, sz * 0.8);
        // Roll each wing about the body axis.
        this.q2.multiply(this.qRoll(sign * (0.5 + flap * 0.6)));
        this.m.compose(this.p, this.q2, this.s);
        this.mesh.setMatrixAt(i * 2 + w, this.m);
        this.c.copy(this.day[i]).lerp(this.glow, night);
        this.mesh.setColorAt(i * 2 + w, this.c);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private readonly qr = new Quaternion();
  private readonly zAxis = new Vector3(0, 0, 1);
  private qRoll(a: number): Quaternion {
    return this.qr.setFromAxisAngle(this.zAxis, a);
  }
}

/**
 * Festival fireworks: a rocket climbs from the island, then bursts into a
 * sphere of glowing sparks that drift down. Sized so that on a resting island
 * the bursts open above it at about head height.
 */
export class Fireworks {
  readonly mesh: InstancedMesh;
  private readonly pos: Vector3[] = [];
  private readonly vel: Vector3[] = [];
  private readonly life: number[] = [];
  private readonly maxLife: number[] = [];
  private readonly size: number[] = [];
  private readonly col: Color[] = [];
  /** >0 while this particle is a climbing rocket; it bursts when it runs out. */
  private readonly fuse: number[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly c = new Color();
  private readonly white = new Color(0xffffff);
  private next = 0;
  private alive = 0;
  /** Brightness of the most recent burst, eased to 0. Lights the island. */
  flash = 0;
  readonly flashColor = new Color(0xffffff);

  constructor(private readonly count = 420) {
    this.mesh = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      count,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < count; i++) {
      this.pos.push(new Vector3());
      this.vel.push(new Vector3());
      this.life.push(0);
      this.maxLife.push(1);
      this.size.push(0);
      this.fuse.push(0);
      this.col.push(new Color());
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, this.white);
    }
  }

  private take(): number {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    return i;
  }

  /** Launch a rocket from island-local x/z. */
  launch(x: number, z: number, color: number, height: number): void {
    const i = this.take();
    this.pos[i].set(x, GROUND_Y + 0.004, z);
    const climb = 0.55 + Math.random() * 0.15;
    this.vel[i].set((Math.random() - 0.5) * 0.01, height / climb, (Math.random() - 0.5) * 0.01);
    this.fuse[i] = climb;
    this.life[i] = this.maxLife[i] = climb + 0.01;
    this.size[i] = 0.0013;
    this.col[i].set(color);
    this.alive = this.count;
  }

  private burst(at: Vector3, color: Color): void {
    const n = 72;
    const speed = 0.075 + Math.random() * 0.03;
    for (let k = 0; k < n; k++) {
      const i = this.take();
      // Even spread over a sphere (golden spiral) with a little jitter.
      const u = 1 - (2 * (k + 0.5)) / n;
      const r = Math.sqrt(1 - u * u);
      const a = k * 2.399963 + Math.random() * 0.3;
      const sp = speed * (0.82 + Math.random() * 0.3);
      this.pos[i].copy(at);
      this.vel[i].set(Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp);
      this.fuse[i] = 0;
      this.life[i] = this.maxLife[i] = 1.1 + Math.random() * 0.7;
      this.size[i] = 0.0015 * (0.7 + Math.random() * 0.6);
      this.col[i].copy(color).offsetHSL((Math.random() - 0.5) * 0.05, 0, 0);
    }
    this.flash = 1;
    this.flashColor.copy(color);
    this.alive = this.count;
  }

  /** Returns true on the frame a rocket bursts, so the caller can play a sound. */
  update(dt: number): boolean {
    this.flash *= Math.exp(-dt * 4);
    if (this.alive === 0) return false;
    let any = 0;
    let banged = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const v = this.vel[i];
      const p = this.pos[i];
      if (this.fuse[i] > 0) {
        this.fuse[i] -= dt;
        v.y *= Math.exp(-dt * 1.2);
        p.addScaledVector(v, dt);
        if (this.fuse[i] <= 0) {
          this.life[i] = 0;
          this.mesh.setMatrixAt(i, ZERO);
          this.burst(p, this.col[i]);
          banged = true;
          continue;
        }
        this.s.set(this.size[i] * 0.7, this.size[i] * 2.4, this.size[i] * 0.7);
        this.q.identity();
        this.c.copy(this.white);
      } else {
        v.multiplyScalar(Math.exp(-dt * 2.2));
        v.y -= 0.022 * dt;
        p.addScaledVector(v, dt);
        const t = Math.max(0, this.life[i] / this.maxLife[i]);
        // Bright white at the bang, settling into colour, twinkling as it dies.
        const twinkle = t < 0.45 ? 0.55 + 0.45 * Math.sin(this.life[i] * 40 + i) : 1;
        const sz = this.life[i] > 0 ? this.size[i] * Math.sqrt(t) * twinkle : 0;
        this.s.set(sz, sz, sz);
        this.q.identity();
        this.c.copy(this.col[i]).lerp(this.white, Math.max(0, t - 0.9) * 6);
      }
      this.m.compose(p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c);
      if (this.life[i] > 0) any++;
      else this.mesh.setMatrixAt(i, ZERO);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // A burst can recycle slots this pass has already walked, so keep the pool awake.
    this.alive = banged ? this.count : any;
    return banged;
  }
}

/** Paper lanterns that the villagers release into the room on festival night. */
export class SkyLanterns {
  readonly mesh: InstancedMesh;
  private readonly pos: Vector3[] = [];
  private readonly age: number[] = [];
  private readonly sway: number[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private next = 0;
  private alive = 0;
  private static readonly LIFE = 9;

  constructor(private readonly count = 14) {
    this.mesh = new InstancedMesh(
      new BoxGeometry(1, 1.25, 1),
      new MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.95 }),
      count,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.pos.push(new Vector3());
      this.age.push(-1);
      this.sway.push(i * 1.7);
      this.mesh.setMatrixAt(i, ZERO);
    }
  }

  release(x: number, z: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i].set(x, GROUND_Y + 0.008, z);
    this.age[i] = 0;
    this.alive = this.count;
  }

  update(dt: number, time: number): void {
    if (this.alive === 0) return;
    let any = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] < 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / SkyLanterns.LIFE;
      if (t >= 1) {
        this.age[i] = -1;
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      any++;
      const p = this.pos[i];
      // Rise gently, drifting outward, slower as they climb.
      p.y += dt * 0.014 * (1 - t * 0.5);
      p.x += Math.sin(time * 0.8 + this.sway[i]) * dt * 0.003;
      p.z += Math.cos(time * 0.6 + this.sway[i]) * dt * 0.003;
      const grow = Math.min(1, this.age[i] * 2.5);
      const fade = t > 0.8 ? (1 - t) / 0.2 : 1;
      const flicker = 0.92 + 0.08 * Math.sin(time * 9 + i * 3);
      const sz = 0.0042 * grow * fade * flicker;
      this.q.setFromAxisAngle(Y, time * 0.4 + this.sway[i]);
      this.m.compose(p, this.q, this.s.set(sz, sz, sz));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive = any;
  }
}

/**
 * A pocket of night sky behind the island. Only the inside of the sphere is
 * drawn, so the island stays in plain view while the room behind it dims.
 */
export function buildNightDome(radius: number): Mesh {
  const dome = new Mesh(
    new SphereGeometry(radius, 24, 16),
    new MeshBasicMaterial({ color: 0x070b24, transparent: true, opacity: 0, side: BackSide, depthWrite: false }),
  );
  dome.renderOrder = -5;
  dome.visible = false;
  return dome;
}

const RAINBOW = [0xff4d4d, 0xff9f3a, 0xffe14a, 0x5fd66a, 0x4aa8ff, 0x8a63ff];

/** A rainbow that arcs over the island after the fields are watered. */
export class Rainbow {
  readonly group = new Group();
  private readonly mats: MeshBasicMaterial[] = [];
  private k = 0;

  constructor(radius: number) {
    const band = radius * 0.045;
    for (let i = 0; i < RAINBOW.length; i++) {
      const mat = new MeshBasicMaterial({
        color: RAINBOW[i],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      });
      // Flat ring segments read as bands of light rather than as plastic tubes.
      const geo = new RingGeometry(radius - (i + 1) * band, radius - i * band, 48, 1, 0, Math.PI);
      const m = new Mesh(geo, mat);
      m.renderOrder = 4;
      this.group.add(m);
      this.mats.push(mat);
    }
    this.group.visible = false;
  }

  /** `want` is whether the rainbow should be showing; it fades and sweeps in. */
  update(dt: number, want: boolean, yaw: number): void {
    this.k += ((want ? 1 : 0) - this.k) * (1 - Math.exp(-dt * (want ? 1.6 : 1.1)));
    this.group.visible = this.k > 0.01;
    if (!this.group.visible) return;
    this.group.rotation.y = yaw;
    // Rise out of the ground as it appears.
    const s = 0.6 + 0.4 * this.k;
    this.group.scale.set(s, s, s);
    for (let i = 0; i < this.mats.length; i++) this.mats[i].opacity = 0.62 * this.k;
  }
}

/** Moon and shooting stars that live in the pocket of night behind the island. */
export class NightSky {
  readonly group = new Group();
  private readonly moon: Mesh;
  private readonly moonMat: MeshBasicMaterial;
  private readonly streak: Mesh;
  private readonly streakMat: MeshBasicMaterial;
  private readonly from = new Vector3();
  private readonly dir = new Vector3();
  private t = -1;
  private wait = 1.2;

  constructor() {
    this.moonMat = new MeshBasicMaterial({ color: 0xfff6cf, transparent: true, opacity: 0, toneMapped: false });
    this.moon = new Mesh(new SphereGeometry(0.011, 16, 12), this.moonMat);
    this.moon.position.set(-0.075, 0.125, -0.1);
    this.group.add(this.moon);
    this.streakMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
    const geo = new BoxGeometry(1, 0.0006, 0.0006);
    geo.translate(-0.5, 0, 0); // origin at the bright head, tail trailing behind
    this.streak = new Mesh(geo, this.streakMat);
    this.streak.visible = false;
    this.group.add(this.streak);
    this.group.visible = false;
  }

  update(dt: number, dusk: number): void {
    this.group.visible = dusk > 0.02;
    if (!this.group.visible) return;
    this.moonMat.opacity = dusk;
    this.moon.scale.setScalar(0.6 + 0.4 * dusk);
    if (this.t < 0) {
      this.wait -= dt;
      if (this.wait <= 0 && dusk > 0.7) {
        this.t = 0;
        this.wait = 1.6 + Math.random() * 2.2;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.from.set(-0.11 * side + (Math.random() - 0.5) * 0.05, 0.13 + Math.random() * 0.04, -0.1 - Math.random() * 0.04);
        this.dir.set(side * (0.75 + Math.random() * 0.2), -0.45 - Math.random() * 0.2, 0.1).normalize();
        this.streak.rotation.set(0, 0, Math.atan2(this.dir.y, this.dir.x));
        this.streak.rotation.y = 0;
      }
    } else {
      this.t += dt / 0.7;
      if (this.t >= 1) {
        this.t = -1;
        this.streak.visible = false;
        return;
      }
      this.streak.visible = true;
      this.streak.position.copy(this.from).addScaledVector(this.dir, this.t * 0.17);
      const tail = 0.035 * Math.sin(this.t * Math.PI);
      this.streak.scale.set(Math.max(0.0001, tail), 1, 1);
      this.streakMat.opacity = Math.sin(this.t * Math.PI) * dusk;
    }
  }
}

/** Drives one fish model through an occasional leap out of the pond. */
export class LeapingFish {
  private t = -1;
  private wait = 3;
  private ax = 0;
  private az = 0;
  private bx = 0;
  private bz = 0;

  constructor(private readonly fish: Object3D) {
    fish.visible = false;
  }

  /**
   * @param calm whether the pond is level and full enough for a fish to jump
   * @returns 1 on the frame it leaves the water, 2 when it lands, else 0. `at` gets the spot.
   */
  update(dt: number, calm: boolean, pondX: number, pondZ: number, pondR: number, y: number, at: Vector3): number {
    if (this.t < 0) {
      this.fish.visible = false;
      if (!calm) return 0;
      this.wait -= dt;
      if (this.wait > 0) return 0;
      this.wait = 3.5 + Math.random() * 4;
      this.t = 0;
      const a = Math.random() * Math.PI * 2;
      const r = pondR * 0.5;
      this.ax = pondX + Math.cos(a) * r;
      this.az = pondZ + Math.sin(a) * r;
      this.bx = pondX - Math.cos(a) * r * 0.8;
      this.bz = pondZ - Math.sin(a) * r * 0.8;
      at.set(this.ax, y, this.az);
      return 1;
    }
    const before = this.t;
    this.t += dt / 0.75;
    const u = Math.min(1, this.t);
    const x = this.ax + (this.bx - this.ax) * u;
    const z = this.az + (this.bz - this.az) * u;
    const h = 4 * u * (1 - u) * 0.0075;
    this.fish.visible = true;
    this.fish.position.set(x, y + h - 0.0006, z);
    // Nose follows the arc: up on the way out, down on the way in.
    const heading = Math.atan2(this.bx - this.ax, this.bz - this.az);
    const pitch = Math.atan2(4 * (1 - 2 * u) * 0.0075, Math.hypot(this.bx - this.ax, this.bz - this.az));
    this.fish.rotation.set(-pitch, heading, Math.sin(this.t * 30) * 0.25, 'YXZ');
    if (this.t >= 1 && before < 1) {
      this.t = -1;
      this.fish.visible = false;
      at.set(this.bx, y, this.bz);
      return 2;
    }
    return 0;
  }
}
