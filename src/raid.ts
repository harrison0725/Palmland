import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { R } from './island.js';
import { GROUND_Y } from './fx.js';

/** A crow: 0 idle, 1 flying in, 2 pecking a field, 3 escaping with a crop, 4 swatted. */
interface Crow {
  obj: Group;
  wingL: Mesh;
  wingR: Mesh;
  state: number;
  t: number;
  dur: number;
  field: number;
  from: Vector3;
  to: Vector3;
  pos: Vector3;
  vel: Vector3;
  spin: number;
}

export interface RaidHooks {
  fieldCenter(i: number): Vector3;
  fieldCount: number;
  steal(i: number): void;
  feathers(at: Vector3): void;
  caw(): void;
  swat(combo: number): void;
  /** Optional real-world entry point (island-local), such as the room's window. */
  entry?(out: Vector3): boolean;
}

/** Crows read better a little larger than life next to the tiny villagers. */
const SIZE = 1.4;

const body = new MeshStandardMaterial({ color: 0x23232e, roughness: 0.7, flatShading: true });
const beakM = new MeshStandardMaterial({ color: 0xf2a23a, roughness: 0.6, flatShading: true });
const eyeM = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });

function buildCrow(): { obj: Group; wingL: Mesh; wingR: Mesh } {
  const g = new Group();
  const b = new Mesh(new SphereGeometry(0.0026, 8, 6), body);
  b.scale.set(1, 0.85, 1.35);
  g.add(b);
  const head = new Mesh(new SphereGeometry(0.0017, 8, 6), body);
  head.position.set(0, 0.0016, -0.0029);
  g.add(head);
  const beak = new Mesh(new ConeGeometry(0.0007, 0.0021, 5), beakM);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.0013, -0.0048);
  g.add(beak);
  for (const s of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(0.00042, 5, 4), eyeM);
    eye.position.set(s * 0.0009, 0.0024, -0.0038);
    g.add(eye);
  }
  const tail = new Mesh(new BoxGeometry(0.0022, 0.0004, 0.0026), body);
  tail.position.set(0, 0.0004, 0.0036);
  tail.rotation.x = -0.3;
  g.add(tail);
  const wingGeo = new BoxGeometry(0.0052, 0.0004, 0.0028);
  wingGeo.translate(0.0026, 0, 0);
  const wingR = new Mesh(wingGeo, body);
  wingR.position.set(0.0012, 0.0008, 0);
  const wingL = new Mesh(wingGeo, body);
  wingL.position.set(-0.0012, 0.0008, 0);
  wingL.scale.x = -1;
  g.add(wingL, wingR);
  g.visible = false;
  return { obj: g, wingL, wingR };
}

/**
 * Crow raid: a wave of crows flies in to peck at the crops, and the player
 * swats them away with a bare hand before they fly off with a sheaf. Swats in
 * quick succession build a combo. All crows are pooled; nothing allocates in play.
 */
export class CrowRaid {
  readonly group = new Group();
  private readonly crows: Crow[] = [];
  active = false;
  /** Seconds since the raid ended, for the result message. */
  afterT = 0;
  wave = 0;
  score = 0;
  swatted = 0;
  stolen = 0;
  combo = 0;
  private comboT = 0;
  private toSpawn = 0;
  private spawnT = 0;
  private time = 0;
  private readonly v = new Vector3();

  constructor(private readonly hooks: RaidHooks) {
    for (let i = 0; i < 8; i++) {
      const c = buildCrow();
      this.group.add(c.obj);
      this.crows.push({ ...c, state: 0, t: 0, dur: 1, field: 0, from: new Vector3(), to: new Vector3(), pos: new Vector3(), vel: new Vector3(), spin: 0 });
    }
  }

  start(): void {
    this.active = true;
    this.wave++;
    this.score = this.swatted = this.stolen = this.combo = 0;
    this.toSpawn = 7 + this.wave * 2;
    this.spawnT = 0.6;
    this.hooks.caw();
  }

  /** World-free: positions are island-local. Returns nothing; reads hits from `hits`. */
  update(dt: number, hits: Vector3[], hitCount: number, hitR: number): void {
    this.time += dt;
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    if (!this.active) {
      this.afterT += dt;
    } else {
      this.spawnT -= dt;
      if (this.toSpawn > 0 && this.spawnT <= 0) {
        const c = this.crows.find((k) => k.state === 0);
        if (c) {
          this.toSpawn--;
          this.spawnT = Math.max(0.55, 1.9 - this.wave * 0.2) * (0.6 + Math.random() * 0.8);
          c.field = Math.floor(Math.random() * this.hooks.fieldCount);
          const a = Math.random() * Math.PI * 2;
          c.from.set(Math.cos(a) * R * 1.7, 0.045 + Math.random() * 0.02, Math.sin(a) * R * 1.7);
          let far = 0;
          if (this.hooks.entry?.(c.to)) {
            // In through the real window, spread across its opening.
            c.from.set(c.to.x + (Math.random() - 0.5) * 0.04, c.to.y + (Math.random() - 0.5) * 0.03, c.to.z + (Math.random() - 0.5) * 0.04);
            far = Math.min(2.5, Math.hypot(c.from.x, c.from.z) * 4);
          }
          const fc = this.hooks.fieldCenter(c.field);
          c.to.set(fc.x + (Math.random() - 0.5) * 0.008, GROUND_Y + 0.0035, fc.z + (Math.random() - 0.5) * 0.008);
          c.state = 1;
          c.t = 0;
          c.dur = Math.max(1.4, 2.8 - this.wave * 0.25) + far;
          c.obj.visible = true;
          if (Math.random() < 0.5) this.hooks.caw();
        }
      }
      if (this.toSpawn <= 0 && this.crows.every((k) => k.state === 0)) {
        this.active = false;
        this.afterT = 0;
      }
    }
    for (const c of this.crows) {
      if (c.state === 0) continue;
      c.t += dt;
      const flap = Math.sin(this.time * 28 + c.field * 2);
      let wing = 0.25 + flap * 0.8;
      if (c.state === 1) {
        const k = Math.min(1, c.t / c.dur);
        const e = 1 - (1 - k) * (1 - k);
        c.pos.lerpVectors(c.from, c.to, e);
        c.pos.y += Math.sin(k * Math.PI) * 0.012;
        this.face(c, c.to.x - c.from.x, c.to.z - c.from.z);
        if (k >= 1) {
          c.state = 2;
          c.t = 0;
          c.dur = Math.max(1.6, 3 - this.wave * 0.2);
        }
      } else if (c.state === 2) {
        wing = 1.2; // folded
        c.obj.rotation.x = Math.max(0, Math.sin(c.t * 14)) * 0.6; // peck peck
        c.obj.position.y = c.pos.y;
        if (c.t >= c.dur) {
          this.hooks.steal(c.field);
          this.stolen++;
          this.hooks.caw();
          c.state = 3;
          c.t = 0;
          c.from.copy(c.pos);
          this.v.set(c.pos.x, 0, c.pos.z);
          if (this.v.lengthSq() < 1e-8) this.v.set(1, 0, 0);
          this.v.normalize().multiplyScalar(R * 2);
          c.to.set(this.v.x, 0.07, this.v.z);
          c.dur = 1.6;
        }
      } else if (c.state === 3) {
        const k = Math.min(1, c.t / c.dur);
        c.pos.lerpVectors(c.from, c.to, k * k);
        this.face(c, c.to.x - c.from.x, c.to.z - c.from.z);
        c.obj.rotation.x = -0.3;
        if (k >= 1) this.hide(c);
      } else if (c.state === 4) {
        c.vel.y -= dt * 0.35;
        c.pos.addScaledVector(c.vel, dt);
        c.obj.rotation.z += c.spin * dt;
        c.obj.rotation.x += c.spin * 0.6 * dt;
        wing = 1.4;
        if (c.t > 1.2) this.hide(c);
      }
      c.wingL.rotation.z = -wing;
      c.wingR.rotation.z = wing;
      c.obj.position.copy(c.pos);
      if (c.state === 2 || c.state === 3 || c.state === 4) {
        const pop = c.state === 4 ? Math.max(0, 1 - c.t / 1.2) : 1;
        c.obj.scale.setScalar(Math.max(0.0001, pop * SIZE));
      } else {
        c.obj.scale.setScalar(Math.max(0.0001, Math.min(1, c.t * 4) * SIZE));
      }
      // Swat check: any hand point near a crow that is still on the job.
      if (c.state >= 1 && c.state <= 3) {
        for (let h = 0; h < hitCount; h++) {
          if (hits[h].distanceTo(c.pos) < hitR) {
            this.swatCrow(c, hits[h]);
            break;
          }
        }
      }
    }
  }

  private swatCrow(c: Crow, by: Vector3): void {
    c.state = 4;
    c.t = 0;
    this.v.subVectors(c.pos, by).setY(0);
    if (this.v.lengthSq() < 1e-8) this.v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    this.v.normalize();
    c.vel.set(this.v.x * 0.09, 0.07, this.v.z * 0.09);
    c.spin = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8);
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 1.8;
    this.score += this.combo;
    this.swatted++;
    this.hooks.feathers(c.pos);
    this.hooks.swat(this.combo);
  }

  private face(c: Crow, dx: number, dz: number): void {
    c.obj.rotation.set(0, Math.atan2(-dx, -dz), 0);
  }

  private hide(c: Crow): void {
    c.state = 0;
    c.obj.visible = false;
    c.obj.rotation.set(0, 0, 0);
  }

  /** Island-local position of the first busy crow, for scripted demos. */
  /** Debug: the first active crow's state and island-local position. */
  probe(): number[] | null {
    const c = this.crows.find((k) => k.state !== 0);
    return c ? [c.state, +c.pos.x.toFixed(3), +c.pos.y.toFixed(3), +c.pos.z.toFixed(3)] : null;
  }

  target(out: Vector3): boolean {
    let best: Crow | null = null;
    for (const c of this.crows) {
      if (c.state === 2 && (!best || best.state !== 2)) best = c;
      else if (c.state === 1 && c.t / c.dur > 0.55 && !best) best = c;
    }
    if (!best) return false;
    out.copy(best.pos);
    return true;
  }
}
