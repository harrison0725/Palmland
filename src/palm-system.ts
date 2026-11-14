import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  createSystem,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { HandState, Side } from './hands.js';
import {
  M,
  R,
  buildField,
  buildHouse,
  buildIslandBase,
  buildPond,
  buildTree,
  buildVillager,
  buildCloud,
  rng,
} from './island.js';
import { Label } from './label.js';
import { HandSkeleton } from './hand-skeleton.js';
import { sfx } from './sfx.js';

const PARAMS = new URLSearchParams(location.search);
const DEBUG = PARAMS.has('debug');
/** Visible stylised hands, for desktop emulation and demo recordings. */
const SHOW_HANDS = PARAMS.has('hands') || PARAMS.has('film');
/**
 * Film mode: the simulation only advances when a recording script asks for a
 * frame, by a fixed step, so slow capture still yields smooth footage.
 */
const FILM = PARAMS.has('film');
interface FilmControl {
  pending: number;
  frames: number;
  dt: number;
  api: Record<string, unknown>;
}
const film: FilmControl | null = FILM ? { pending: 0, frames: 0, dt: 1 / 24, api: {} } : null;
if (film) (window as unknown as { __film: FilmControl }).__film = film;
const SAVE_KEY = 'palmlands.v1';
const STEPS = [
  'Hold your hand out, palm up',
  'Poke the grass with your other finger to plant 3 trees',
  'Tilt your hand so the pond spills onto the fields',
  'Slowly close your hand to bring the night',
  'Now open your hand. Good morning!',
  'Pinch a villager and carry them to the new hut',
  'Your island is thriving. It will be waiting tomorrow.',
];

interface Villager {
  obj: Object3D;
  pos: Vector3; // island-local, y = height above ground
  vel: Vector3;
  target: Vector3;
  held: boolean;
  falling: boolean;
  hop: number;
  worldVel: Vector3;
}

interface Field {
  obj: Group;
  center: Vector3;
  wet: number;
  growth: number;
}

interface Save {
  step: number;
  trees: [number, number, number][];
  lastVisit: number;
  days: number;
}

const FIELD_SPOTS: [number, number, number][] = [
  [-0.026, 0.012, 0.4],
  [0.022, 0.022, -0.5],
  [-0.008, 0.032, 0.1],
];
const HOUSE_SPOT = new Vector3(0.024, 0, -0.022);
const HUT_SPOT = new Vector3(-0.028, 0, -0.02);

export class PalmSystem extends createSystem({}) {
  private hands!: Record<Side, HandState>;
  private home: Side | null = null;
  private islandEntityRoot!: Object3D;
  private island!: Group; // scaled pivot holding all content (local units = metres at scale 1)
  private content!: Group;
  private pond!: Mesh;
  private stream!: Mesh;
  private drops!: InstancedMesh;
  private dropPos: Vector3[] = [];
  private dropVel: Vector3[] = [];
  private dropLife: number[] = [];
  private dropNext = 0;
  private stars!: Points;
  private villagers: Villager[] = [];
  private clouds: Group[] = [];
  private fields: Field[] = [];
  private trees: Group[] = [];
  private hut!: Group;
  private house!: Group;
  private label!: Label;
  private sun!: DirectionalLight;
  private hemi!: HemisphereLight;
  private ambient!: AmbientLight;
  private lanternLights: PointLight[] = [];

  private save: Save = { step: 0, trees: [], lastVisit: 0, days: 1 };
  private reveal = 0;
  private night = 0;
  private nightHold = 0;
  private pondLevel = 1;
  private plantCooldown = 0;
  private stepTimer = 0;
  private heldIdx = -1;
  private wasPinching = false;
  private time = 0;
  private occludersApplied = new WeakSet<Object3D>();
  private skeleton: HandSkeleton | null = null;

  // scratch (no per-frame allocation)
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly q1 = new Quaternion();
  private readonly m1 = new Matrix4();
  private readonly originM = new Matrix4();
  private readonly targetPos = new Vector3();
  private readonly targetQuat = new Quaternion();
  private readonly localUp = new Vector3();
  private readonly downhill = new Vector3();
  private readonly invQ = new Quaternion();
  private readonly tmpColor = new Color();
  private readonly dropM = new Matrix4();

  init(): void {
    this.hands = { left: new HandState('left'), right: new HandState('right') };
    this.load();

    const entity = this.world.createTransformEntity();
    this.islandEntityRoot = entity.object3D!;
    this.island = new Group();
    this.islandEntityRoot.add(this.island);
    this.content = new Group();
    this.island.add(this.content);
    this.content.add(buildIslandBase());

    this.pond = buildPond();
    this.content.add(this.pond);

    this.house = buildHouse();
    this.house.position.copy(HOUSE_SPOT);
    this.house.rotation.y = -0.6;
    this.content.add(this.house);

    this.hut = buildHouse();
    this.hut.position.copy(HUT_SPOT);
    this.hut.rotation.y = 0.8;
    this.hut.scale.setScalar(this.save.step >= 5 ? 1 : 0.0001);
    this.content.add(this.hut);
    this.island.traverse((o) => {
      if (o instanceof PointLight) this.lanternLights.push(o);
    });

    for (const [x, z, ry] of FIELD_SPOTS) {
      const f = buildField();
      f.position.set(x, 0.006, z);
      f.rotation.y = ry;
      this.content.add(f);
      this.fields.push({ obj: f, center: new Vector3(x, 0, z), wet: 0, growth: 0 });
    }
    if (this.save.step >= 4) for (const f of this.fields) {
      f.wet = 1;
      f.growth = 1;
    }

    for (const [x, z, seed] of this.save.trees) this.addTree(x, z, seed, false);

    for (let i = 0; i < 3; i++) {
      const obj = buildVillager(i);
      this.content.add(obj);
      const r = rng(100 + i);
      const pos = new Vector3((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.03 + 0.01);
      this.villagers.push({
        obj,
        pos,
        vel: new Vector3(),
        target: pos.clone(),
        held: false,
        falling: false,
        hop: 0,
        worldVel: new Vector3(),
      });
    }

    // Water stream: a thin ribbon from the pond to the downhill rim.
    this.stream = new Mesh(new BoxGeometry(1, 0.0012, 0.004), M.water);
    this.stream.visible = false;
    this.content.add(this.stream);

    // Droplets fall in world space, so they live on the scene root.
    const dropCount = 120;
    this.drops = new InstancedMesh(
      new SphereGeometry(0.0012, 5, 4),
      new MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.9 }),
      dropCount,
    );
    this.drops.frustumCulled = false;
    for (let i = 0; i < dropCount; i++) {
      this.dropPos.push(new Vector3());
      this.dropVel.push(new Vector3());
      this.dropLife.push(0);
      this.dropM.makeScale(0, 0, 0);
      this.drops.setMatrixAt(i, this.dropM);
    }
    this.world.createTransformEntity(this.drops);

    for (let i = 0; i < 2; i++) {
      const c = buildCloud(11 + i);
      this.content.add(c);
      this.clouds.push(c);
    }

    // Stars above the island at night.
    const sg = new BufferGeometry();
    const sp = new Float32Array(60 * 3);
    const sr = rng(42);
    for (let i = 0; i < 60; i++) {
      const a = sr() * Math.PI * 2;
      const d = 0.01 + sr() * 0.06;
      sp.set([Math.cos(a) * d, 0.03 + sr() * 0.05, Math.sin(a) * d], i * 3);
    }
    sg.setAttribute('position', new BufferAttribute(sp, 3));
    this.stars = new Points(
      sg,
      new PointsMaterial({ color: 0xfff6d0, size: 0.0015, transparent: true, opacity: 0 }),
    );
    this.content.add(this.stars);

    // Island-local lighting, tinted by day and night.
    this.sun = new DirectionalLight(0xfff1d6, 2.2);
    this.sun.position.set(0.3, 1, 0.2);
    this.sun.target = this.island;
    this.hemi = new HemisphereLight(0xcfe8ff, 0x6a5a40, 1.2);
    this.ambient = new AmbientLight(0x223355, 0.2);
    this.world.scene.add(this.sun, this.hemi, this.ambient);

    this.label = new Label();
    this.world.createTransformEntity(this.label.sprite);

    this.island.scale.setScalar(0.0001);
    window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
    if (SHOW_HANDS) {
      this.skeleton = new HandSkeleton();
      this.world.createTransformEntity(this.skeleton.joints);
      this.world.createTransformEntity(this.skeleton.bones);
      this.hands.left.wantAllJoints = true;
      this.hands.right.wantAllJoints = true;
    }
    if (film) {
      film.api = {
        islandToWorld: (x: number, y: number, z: number) =>
          this.island.localToWorld(new Vector3(x, y, z)).toArray(),
        villagerWorld: (i: number) =>
          this.villagers[i].obj.getWorldPosition(new Vector3()).toArray(),
        state: () => ({ step: this.save.step, trees: this.trees.length, held: this.heldIdx, night: this.night }),
      };
    }
  }

  update(delta: number): void {
    if (film) {
      if (film.pending <= 0) return;
      film.pending--;
      film.frames++;
    }
    const dt = film ? film.dt : Math.min(delta, DEBUG ? 0.4 : 0.05);
    this.time += dt;
    const vis = this.world.visibilityState.peek();
    if (vis === VisibilityState.VisibleBlurred) return; // clean pause

    const xr = this.world.renderer.xr;
    const inXR = vis !== VisibilityState.NonImmersive && xr.isPresenting;
    const frame = inXR ? xr.getFrame() : null;
    const ref = inXR ? xr.getReferenceSpace() : null;
    this.world.player.updateWorldMatrix(true, false);
    this.originM.copy(this.world.player.matrixWorld);
    this.hands.left.update(frame, ref, this.originM, dt);
    this.hands.right.update(frame, ref, this.originM, dt);
    if (inXR && !SHOW_HANDS) this.applyHandOccluders();
    if (this.skeleton) {
      (['left', 'right'] as const).forEach((side, i) => {
        const h = this.hands[side];
        if (h.tracked) this.skeleton!.update(i, h.all);
        else this.skeleton!.hide(i);
      });
    }

    this.pickHomeHand();
    const home = this.home ? this.hands[this.home] : null;
    const god = this.home ? this.hands[this.home === 'left' ? 'right' : 'left'] : null;

    // ----- Place the island -----
    let present: boolean;
    if (inXR) {
      present = !!home;
      if (home) {
        this.targetPos.copy(home.palmCenter).addScaledVector(home.palmNormal, 0.03);
        this.v1.copy(home.forward).negate(); // local -Z towards fingers => +Z = -fwd
        this.v2.crossVectors(home.palmNormal, this.v1).normalize(); // x
        this.v1.crossVectors(this.v2, home.palmNormal).normalize();
        this.m1.makeBasis(this.v2, home.palmNormal, this.v1);
        this.targetQuat.setFromRotationMatrix(this.m1);
      }
    } else {
      // Flat-screen preview: float the island in front of the camera, slowly turning.
      present = true;
      this.targetPos.set(0, 1.5, 0.55);
      this.q1.setFromAxisAngle(this.v1.set(1, 0, 0), 0.12);
      this.targetQuat.setFromAxisAngle(this.v2.set(0, 1, 0), this.time * 0.2).premultiply(this.q1);
    }
    const k = Math.min(1, dt * 14);
    const root = this.islandEntityRoot;
    if (this.reveal < 0.01) {
      root.position.copy(this.targetPos);
      root.quaternion.copy(this.targetQuat);
    } else {
      root.position.lerp(this.targetPos, k);
      root.quaternion.slerp(this.targetQuat, k);
    }
    const targetReveal = present ? 1 : 0;
    this.reveal += (targetReveal - this.reveal) * Math.min(1, dt * (present ? 1.5 : 5));
    const grow = easeOutBack(this.reveal) * (inXR ? 1 : 3);
    this.island.scale.setScalar(Math.max(0.0001, grow));
    this.island.position.y = (1 - this.reveal) * -0.02;
    if (present && this.save.step === 0 && this.reveal > 0.9) this.advance();

    // ----- Day and night from how open the home hand is -----
    const targetNight = inXR && home ? 1 - home.openness : this.save.step === 4 ? 0 : 0;
    this.night += (targetNight - this.night) * Math.min(1, dt * 3);
    this.applyLighting();

    // ----- Tilt: which way is downhill on the island? -----
    root.updateWorldMatrix(true, true);
    this.invQ.copy(root.quaternion).invert();
    this.localUp.set(0, 1, 0).applyQuaternion(this.invQ);
    const tilt = Math.acos(Math.min(1, Math.max(-1, this.localUp.y)));
    this.downhill.set(-this.localUp.x, 0, -this.localUp.z);
    if (this.downhill.lengthSq() > 1e-6) this.downhill.normalize();

    this.updateWater(dt, tilt, present);
    this.updateGodFinger(dt, god, present);
    this.updateVillagers(dt, tilt);
    this.updateGrowth(dt);
    this.updateDrops(dt);
    this.updateLabel(inXR, present);
    this.updateSteps(dt);
    this.debugLog(god);
  }

  private dbgT = 0;
  private dbgLast = 0;
  private debugLog(god: HandState | null): void {
    if (!DEBUG) return;
    this.dbgT += 1;
    const now = performance.now();
    if (now - this.dbgLast < 1000) return;
    this.dbgLast = now;
    const fps = this.dbgT;
    this.dbgT = 0;
    const r = this.islandEntityRoot.position;
    const tip = god ? this.island.worldToLocal(this.v3.copy(god.indexTip)) : null;
    console.log(
      '[palm]',
      JSON.stringify({
        fps,
        home: this.home,
        step: this.save.step,
        trees: this.trees.length,
        reveal: +this.reveal.toFixed(2),
        night: +this.night.toFixed(2),
        root: [r.x, r.y, r.z].map((n) => +n.toFixed(3)),
        n: this.home ? this.hands[this.home].palmNormal.toArray().map((n) => +n.toFixed(2)) : null,
        open: this.home ? +this.hands[this.home].openness.toFixed(2) : null,
        ratio: this.home ? +this.hands[this.home].ratio.toFixed(2) : null,
        tip: tip ? tip.toArray().map((n) => +n.toFixed(4)) : null,
        pinch: god?.pinching,
        wet: this.fields.map((f) => +f.wet.toFixed(2)),
        grow: this.fields.map((f) => +f.growth.toFixed(2)),
        pond: +this.pondLevel.toFixed(2),
        v0: this.villagers[0].obj.getWorldPosition(new Vector3()).toArray().map((n) => +n.toFixed(4)),
        held: this.heldIdx,
        L: this.hands.left.tracked,
        R: this.hands.right.tracked,
      }),
    );
  }

  // ---------------------------------------------------------------------------

  private pickHomeHand(): void {
    const keep = this.home && this.hands[this.home];
    if (keep && keep.tracked && keep.palmNormal.y > -0.2) return;
    if (keep && keep.lostFor < 1.2 && !keep.tracked) return; // brief dropout (e.g. the other hand occludes it)
    this.home = null;
    let best = 0.55;
    for (const s of ['left', 'right'] as const) {
      const h = this.hands[s];
      if (h.tracked && h.palmNormal.y > best) {
        best = h.palmNormal.y;
        this.home = s;
      }
    }
  }

  private applyLighting(): void {
    const day = 1 - this.night;
    this.sun.intensity = 0.15 + 2.2 * day;
    this.tmpColor.set(0xffb27a).lerp(this.v3c(0xfff1d6), Math.min(1, day * 1.4));
    this.sun.color.copy(this.tmpColor);
    this.hemi.intensity = 0.25 + 1.0 * day;
    this.ambient.intensity = 0.2 + 0.4 * this.night;
    M.lantern.emissiveIntensity = Math.max(0, this.night * 3 - 0.6);
    for (const l of this.lanternLights) l.intensity = Math.max(0, this.night - 0.3) * 0.02;
    (this.stars.material as PointsMaterial).opacity = Math.max(0, this.night * 1.6 - 0.6);
    this.stars.rotation.y = this.time * 0.05;
    for (let i = 0; i < this.clouds.length; i++) {
      const a = this.time * (0.12 + i * 0.05) + i * 2.5;
      const c = this.clouds[i];
      c.position.set(Math.cos(a) * R * 0.75, 0.028 + i * 0.008, Math.sin(a) * R * 0.75);
      c.rotation.y = -a;
      c.scale.setScalar(0.4 + 0.6 * (1 - this.night));
    }
  }

  private readonly c2 = new Color();
  private v3c(hex: number): Color {
    return this.c2.set(hex);
  }

  private updateWater(dt: number, tilt: number, present: boolean): void {
    const pouring = present && tilt > 0.5 && this.pondLevel > 0.05;
    if (pouring) {
      this.pondLevel = Math.max(0, this.pondLevel - dt * 0.025);
      // Ribbon from pond centre to the rim along downhill.
      const start = this.v1.set(this.pond.position.x, 0, this.pond.position.z);
      const end = this.v2.copy(this.downhill).multiplyScalar(R * 0.98);
      const len = start.distanceTo(end);
      this.stream.visible = true;
      this.stream.position.copy(start).lerp(end, 0.5).setY(0.0065);
      this.stream.scale.set(len, 1, 0.6 + Math.sin(this.time * 20) * 0.15);
      this.stream.rotation.set(0, Math.atan2(-(end.z - start.z), end.x - start.x), 0);
      // Water the fields the stream passes over.
      for (const f of this.fields) {
        if (distToSegment(f.center, start, end) < 0.01) {
          const before = f.wet;
          f.wet = Math.min(1, f.wet + dt * 0.8);
          if (before < 1 && f.wet >= 1) sfx.pop();
        }
      }
      // Spill droplets off the rim into the real world.
      this.dropNext -= dt;
      if (this.dropNext <= 0) {
        this.dropNext = 0.025;
        this.v3.copy(end).setY(0.004);
        this.island.localToWorld(this.v3);
        this.spawnDrop(this.v3);
        if (Math.random() < 0.15) sfx.splash();
      }
    } else {
      this.stream.visible = false;
      if (tilt < 0.3) this.pondLevel = Math.min(1, this.pondLevel + dt * 0.15);
    }
    const s = 0.35 + 0.65 * this.pondLevel;
    this.pond.scale.set(s, s, 1);
    for (const f of this.fields) {
      const soil = f.obj.getObjectByName('soil') as Mesh;
      soil.material = f.wet > 0.6 ? M.fieldWet : M.fieldDry;
    }
  }

  private spawnDrop(worldPos: Vector3): void {
    for (let i = 0; i < this.dropLife.length; i++) {
      if (this.dropLife[i] <= 0) {
        this.dropPos[i].copy(worldPos);
        this.dropVel[i].set((Math.random() - 0.5) * 0.04, -0.02, (Math.random() - 0.5) * 0.04);
        this.dropLife[i] = 1.2;
        return;
      }
    }
  }

  private updateDrops(dt: number): void {
    for (let i = 0; i < this.dropLife.length; i++) {
      if (this.dropLife[i] <= 0) continue;
      this.dropLife[i] -= dt;
      this.dropVel[i].y -= 9.8 * dt * 0.6;
      this.dropPos[i].addScaledVector(this.dropVel[i], dt);
      const s = this.dropLife[i] > 0 ? 1 : 0;
      this.dropM.makeScale(s, s * 1.6, s).setPosition(this.dropPos[i]);
      this.drops.setMatrixAt(i, this.dropM);
    }
    this.drops.instanceMatrix.needsUpdate = true;
  }

  private updateGodFinger(dt: number, god: HandState | null, present: boolean): void {
    this.plantCooldown -= dt;
    if (!god || !god.tracked || !present || this.reveal < 0.8) {
      if (this.heldIdx >= 0) this.release();
      this.wasPinching = false;
      return;
    }
    const scale = this.island.scale.x;
    // Fingertip in island-local metres.
    const tip = this.v1.copy(god.indexTip);
    this.island.worldToLocal(tip);
    const pinch = this.v2.copy(god.pinchPoint);
    this.island.worldToLocal(pinch);
    void scale;

    // Pinch: pick up / carry / drop a villager.
    if (god.pinching && !this.wasPinching) {
      let best = 0.024;
      for (let i = 0; i < this.villagers.length; i++) {
        const v = this.villagers[i];
        const d = this.v3.copy(v.pos).setY(v.pos.y + 0.006).distanceTo(pinch);
        if (d < best) {
          best = d;
          this.heldIdx = i;
        }
      }
      if (this.heldIdx >= 0) {
        this.villagers[this.heldIdx].held = true;
        sfx.pick();
      }
    }
    if (this.heldIdx >= 0) {
      const v = this.villagers[this.heldIdx];
      if (!god.pinching) this.release();
      else {
        v.pos.copy(pinch).setY(pinch.y - 0.0055);
        v.obj.rotation.z = Math.sin(this.time * 18) * 0.35; // squirm
      }
    }
    this.wasPinching = god.pinching;
    if (god.pinching || this.heldIdx >= 0) return;

    // Poke: plant a tree where the fingertip touches the grass.
    const r = Math.hypot(tip.x, tip.z);
    const touching = tip.y < 0.01 && tip.y > -0.015 && r < R * 0.92;
    if (!touching || this.plantCooldown > 0) return;
    // Poke a villager and they hop.
    for (const v of this.villagers) {
      if (Math.hypot(v.pos.x - tip.x, v.pos.z - tip.z) < 0.005) {
        if (v.hop <= 0) {
          v.hop = 1;
          sfx.pop();
        }
        this.plantCooldown = 0.4;
        return;
      }
    }
    if (!this.canPlant(tip.x, tip.z)) {
      // Let the player know the poke registered even when nothing can grow there.
      sfx.thud();
      this.plantCooldown = 0.5;
      return;
    }
    const seed = Math.floor(Math.random() * 1e6);
    this.addTree(tip.x, tip.z, seed, true);
    this.save.trees.push([round4(tip.x), round4(tip.z), seed]);
    this.persist();
    this.plantCooldown = 0.6;
    sfx.plant();
  }

  private canPlant(x: number, z: number): boolean {
    if (this.trees.length >= 40) return false;
    const p = this.pond.position;
    if (Math.hypot(x - p.x, z - p.z) < 0.014) return false;
    if (Math.hypot(x - HOUSE_SPOT.x, z - HOUSE_SPOT.z) < 0.009) return false;
    if (Math.hypot(x - HUT_SPOT.x, z - HUT_SPOT.z) < 0.009) return false;
    for (const f of this.fields) if (Math.hypot(x - f.center.x, z - f.center.z) < 0.009) return false;
    for (const t of this.trees) if (Math.hypot(x - t.position.x, z - t.position.z) < 0.0065) return false;
    return true;
  }

  private addTree(x: number, z: number, seed: number, animate: boolean): void {
    const t = buildTree(seed);
    t.position.set(x, 0.006, z);
    t.userData.grow = animate ? 0 : 1;
    t.scale.setScalar(animate ? 0.001 : 1);
    this.content.add(t);
    this.trees.push(t);
  }

  private release(): void {
    const v = this.villagers[this.heldIdx];
    this.heldIdx = -1;
    if (!v) return;
    v.held = false;
    v.obj.rotation.z = 0;
    const onIsland = Math.hypot(v.pos.x, v.pos.z) < R * 0.95 && v.pos.y < 0.04 && v.pos.y > -0.02;
    if (DEBUG) console.log("[palm] release", JSON.stringify({ p: v.pos.toArray(), onIsland, step: this.save.step }));
    if (onIsland) {
      v.pos.y = Math.max(0, v.pos.y);
      v.target.copy(v.pos).setY(0);
      sfx.drop();
      if (this.save.step === 5 && Math.hypot(v.pos.x - HUT_SPOT.x, v.pos.z - HUT_SPOT.z) < 0.012) {
        this.advance();
      }
    } else {
      v.falling = true;
      v.worldVel.set(0, 0, 0);
    }
  }

  private updateVillagers(dt: number, tilt: number): void {
    const sliding = tilt > 0.45;
    for (let i = 0; i < this.villagers.length; i++) {
      const v = this.villagers[i];
      if (v.held) {
        v.obj.position.copy(v.pos).setY(v.pos.y + 0.006);
        continue;
      }
      if (v.falling) {
        // Fall off the island under gravity; respawn with a pop.
        v.pos.y -= dt * 0.15;
        v.obj.rotation.x += dt * 8;
        if (v.pos.y < -0.15) {
          v.falling = false;
          v.obj.rotation.x = 0;
          v.pos.set(0, 0.03, 0.01);
          sfx.pop();
        }
        v.obj.position.copy(v.pos);
        continue;
      }
      if (v.pos.y > 0) v.pos.y = Math.max(0, v.pos.y - dt * 0.08); // settle after drop
      if (sliding) {
        // Stumble downhill, stop at the rim, flail.
        v.vel.addScaledVector(this.downhill, Math.sin(tilt) * 0.05 * dt);
        v.vel.multiplyScalar(0.92);
        v.obj.rotation.z = Math.sin(this.time * 25 + i) * 0.4;
      } else {
        v.obj.rotation.z *= 0.8;
        if (v.pos.distanceTo(v.target) < 0.002 || Math.random() < dt * 0.15) {
          this.pickWanderTarget(v, i);
        }
        this.v3.copy(v.target).sub(v.pos).setY(0);
        const d = this.v3.length();
        if (d > 0.0005) this.v3.multiplyScalar(0.005 / d);
        v.vel.lerp(this.v3, Math.min(1, dt * 4));
      }
      v.pos.addScaledVector(v.vel, dt);
      const r = Math.hypot(v.pos.x, v.pos.z);
      const maxR = R * 0.88;
      if (r > maxR) {
        v.pos.x *= maxR / r;
        v.pos.z *= maxR / r;
        v.vel.multiplyScalar(0.3);
      }
      // Stay out of the pond.
      const px = v.pos.x - this.pond.position.x;
      const pz = v.pos.z - this.pond.position.z;
      const pr = Math.hypot(px, pz);
      const pondR = 0.011 * this.pond.scale.x + 0.002;
      if (pr < pondR) {
        v.pos.x = this.pond.position.x + (px / (pr || 1)) * pondR;
        v.pos.z = this.pond.position.z + (pz / (pr || 1)) * pondR;
      }
      if (v.hop > 0) v.hop = Math.max(0, v.hop - dt * 3);
      const hopY = Math.sin((1 - v.hop) * Math.PI) * 0.006 * (v.hop > 0 ? 1 : 0);
      v.obj.position.set(v.pos.x, 0.006 + v.pos.y + hopY + Math.abs(Math.sin(this.time * 12 + i)) * 0.0006 * (sliding ? 0 : 1), v.pos.z);
      if (v.vel.lengthSq() > 1e-8) v.obj.rotation.y = Math.atan2(v.vel.x, v.vel.z);
    }
  }

  private pickWanderTarget(v: Villager, i: number): void {
    // At night villagers head home; by day they wander.
    if (this.night > 0.6) {
      const home = i === 2 && this.save.step >= 6 ? HUT_SPOT : HOUSE_SPOT;
      v.target.set(home.x + (i - 1) * 0.004, 0, home.z + 0.006);
      return;
    }
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * R * 0.75;
    v.target.set(Math.cos(a) * d, 0, Math.sin(a) * d);
  }

  private updateGrowth(dt: number): void {
    for (const t of this.trees) {
      const g = t.userData.grow as number;
      if (g < 1) {
        t.userData.grow = Math.min(1, g + dt * 2.5);
        t.scale.setScalar(Math.max(0.001, easeOutBack(t.userData.grow)));
      }
    }
    // Wet fields grow crops at night; growth snaps to full on sunrise.
    for (const f of this.fields) {
      if (f.wet > 0.6 && this.night > 0.5) f.growth = Math.min(1, f.growth + dt * 0.5);
      const crops = f.obj.getObjectByName('crops')!;
      const s = Math.max(0.001, easeOutBack(f.growth));
      crops.scale.setScalar(s);
    }
    const hutTarget = this.save.step >= 5 ? 1 : 0.0001;
    const hs = this.hut.scale.x + (hutTarget - this.hut.scale.x) * Math.min(1, dt * 3);
    this.hut.scale.setScalar(hs);
  }

  private updateLabel(inXR: boolean, present: boolean): void {
    const step = Math.min(this.save.step, STEPS.length - 1);
    let text = STEPS[step];
    if (step === 2 && this.pondLevel < 0.12) text = 'The pond ran dry. Hold your hand flat for a moment to refill it';
    if (!inXR) text = '';
    if (!inXR && step > 0) text = '';
    if (step === 6 && this.stepTimer > 8) text = '';
    this.label.set(text);
    const s = this.label.sprite;
    if (present && this.reveal > 0.3) {
      this.v1.set(0, 0.075 * (inXR ? 1 : 3), 0);
      this.island.localToWorld(this.v1.multiplyScalar(1 / this.island.scale.x));
      s.position.lerp(this.v1, 0.2);
    } else {
      // Float in front of the viewer when there's no island yet.
      this.world.camera.getWorldPosition(this.v1);
      this.world.camera.getWorldDirection(this.v2);
      this.v1.addScaledVector(this.v2, 0.5);
      this.v1.y -= 0.12;
      s.position.lerp(this.v1, 0.15);
    }
    s.visible = text !== '';
  }

  private updateSteps(dt: number): void {
    this.stepTimer += dt;
    const step = this.save.step;
    if (step === 1 && this.trees.length >= 3) this.advance();
    else if (step === 2 && this.fields.every((f) => f.wet >= 1)) this.advance();
    else if (step === 3) {
      this.nightHold = this.night > 0.75 ? this.nightHold + dt : 0;
      if (this.nightHold > 2) {
        for (const f of this.fields) f.growth = Math.max(f.growth, 0.6);
        this.advance();
      }
    } else if (step === 4 && this.night < 0.15) {
      for (const f of this.fields) f.growth = 1;
      sfx.grow();
      this.advance();
    }
  }

  private advance(): void {
    if (this.save.step >= STEPS.length - 1) return;
    this.save.step++;
    this.stepTimer = 0;
    if (this.save.step > 1) sfx.chime();
    this.persist();
  }

  private applyHandOccluders(): void {
    // In passthrough the player's real hands are visible, so the virtual hand
    // meshes become depth-only occluders: invisible, but they still hide the
    // island behind your fingers.
    const adapters = this.input.xr.visualAdapters.hand;
    for (const side of ['left', 'right'] as const) {
      const model = adapters[side].visual?.model;
      if (!model || this.occludersApplied.has(model)) continue;
      model.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m: Material) => {
          m.colorWrite = false;
        });
        mesh.renderOrder = -1;
      });
      this.occludersApplied.add(model);
    }
  }

  private load(): void {
    try {
      if (new URLSearchParams(location.search).has('reset')) localStorage.removeItem(SAVE_KEY);
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) this.save = { ...this.save, ...(JSON.parse(raw) as Save) };
    } catch {
      /* private mode: play without saving */
    }
    const today = Math.floor(Date.now() / 86400000);
    const last = Math.floor(this.save.lastVisit / 86400000);
    if (this.save.lastVisit && today > last) this.save.days++;
    // Returning players skip the reveal step but keep their island.
    if (this.save.step === 0) this.save.trees = [];
    this.save.lastVisit = Date.now();
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch {
      /* ignore */
    }
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, t));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

const _ab = new Vector3();
const _ap = new Vector3();
function distToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  _ab.copy(b).sub(a).setY(0);
  _ap.copy(p).sub(a).setY(0);
  const t = Math.max(0, Math.min(1, _ap.dot(_ab) / Math.max(1e-9, _ab.lengthSq())));
  return _ap.addScaledVector(_ab, -t).length();
}

