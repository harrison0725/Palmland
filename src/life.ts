import {
  BackSide,
  BoxGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
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
    this.alive = any;
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
