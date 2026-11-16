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
import {
  buildFlowers,
  buildLanternRing,
  UNLOCK_FESTIVAL,
  UNLOCK_FLOWERS,
  UNLOCK_LANTERNS,
  WISH_TEXT,
  WISH_TYPES,
  WishBubble,
  WishType,
} from './wishes.js';
import { blobShadow, GROUND_Y, Particles, Ripples } from './fx.js';

const PARAMS = new URLSearchParams(location.search);
const DEBUG = PARAMS.has('debug');
/** Visible stylised hands, for desktop emulation and demo recordings. */
const SHOW_HANDS = PARAMS.has('hands') || PARAMS.has('film');
/**
 * Film mode: the simulation only advances when a recording script asks for a
 * frame, by a fixed step, so slow capture still yields smooth footage.
 */
const FILM = PARAMS.has('film');
/** Pretend a calendar day has passed since the last visit (testing / demos). */
const NEXT_DAY = PARAMS.has('nextday');
/** Each new day after the first session, one more villager moves in, up to this many. */
const MAX_VILLAGERS = 8;
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
  shadow: Mesh;
  /** Floating down from the sky on the day they move in. */
  arriving: boolean;
}

interface Field {
  obj: Group;
  soil: Mesh;
  crops: Object3D;
  center: Vector3;
  wet: number;
  growth: number;
}

interface Save {
  step: number;
  trees: [number, number, number][];
  lastVisit: number;
  days: number;
  villagers: number;
  /** Wishes granted so far: the village's happiness. */
  wishes: number;
}

const FIELD_SPOTS: [number, number, number][] = [
  [-0.026, 0.012, 0.4],
  [0.022, 0.022, -0.5],
  [-0.008, 0.032, 0.1],
];
const FIREWORK_COLORS = [0xff6f91, 0xffd84a, 0x7ad7ff, 0xb48cff, 0x8cff9e];
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
  private fx!: Particles;
  private ripples!: Ripples;
  /** Label fade state: what is drawn now, and its opacity. */
  private labelShown = '';
  private labelAlpha = 0;
  /** Adaptive (one-euro style) smoothing of the palm anchor. */
  private readonly prevTargetPos = new Vector3();
  private readonly prevTargetQuat = new Quaternion();
  private anchorSpeed = 0;
  private anchorInit = false;

  private save: Save = { step: 0, trees: [], lastVisit: 0, days: 1, villagers: 3, wishes: 0 };
  /** Seconds left to show the "new villager" greeting; -1 when none is pending. */
  private arrivalLabel = -1;
  private arrivalPending = false;
  private inXR = false;
  // Villager wishes: the long-term goal after the guided first session.
  private wishType: WishType | null = null;
  private wishIdx = -1;
  private wishField = -1;
  private wishAge = 0;
  private wishWait = 5;
  private wishHold = 0;
  private wishMsg = '';
  private wishMsgT = 0;
  private lastWish: WishType | null = null;
  private bubble!: WishBubble;
  private flowers!: InstancedMesh;
  private lanternRing!: Group;
  private flowerGrow = 0;
  private lanternGrow = 0;
  private fireworkT = 0;
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
    this.house.add(blobShadow(0.0075));
    this.content.add(this.house);

    this.hut = buildHouse();
    this.hut.position.copy(HUT_SPOT);
    this.hut.rotation.y = 0.8;
    this.hut.add(blobShadow(0.0075));
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
      this.fields.push({
        obj: f,
        soil: f.getObjectByName('soil') as Mesh,
        crops: f.getObjectByName('crops')!,
        center: new Vector3(x, 0, z),
        wet: 0,
        growth: 0,
      });
    }
    if (this.save.step >= 4) for (const f of this.fields) {
      f.wet = 1;
      f.growth = 1;
    }

    for (const [x, z, seed] of this.save.trees) this.addTree(x, z, seed, false);

    const count = film ? 3 : Math.min(MAX_VILLAGERS, Math.max(3, this.save.villagers));
    for (let i = 0; i < count; i++) {
      const obj = buildVillager(i);
      this.content.add(obj);
      const shadow = blobShadow(0.0017);
      this.content.add(shadow);
      const r = rng(100 + i);
      const pos = new Vector3((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.03 + 0.01);
      const arriving = this.arrivalPending && i === count - 1;
      if (arriving) {
        // Today's newcomer drifts down from above the island.
        pos.set(0.004, 0.09, 0.012);
        obj.position.copy(pos);
      }
      this.villagers.push({
        obj,
        pos,
        vel: new Vector3(),
        target: pos.clone().setY(0),
        held: false,
        falling: false,
        hop: 0,
        worldVel: new Vector3(),
        shadow,
        arriving,
      });
    }

    // Water stream: a thin ribbon from the pond to the downhill rim.
    this.stream = new Mesh(new BoxGeometry(1, 0.0012, 0.004), M.water);
    this.stream.visible = false;
    this.content.add(this.stream);

    this.bubble = new WishBubble();
    this.bubble.sprite.scale.setScalar(0.011);
    this.content.add(this.bubble.sprite);
    this.flowers = buildFlowers((x, z) => this.isOpenGrass(x, z));
    this.content.add(this.flowers);
    this.lanternRing = buildLanternRing();
    this.content.add(this.lanternRing);
    this.flowerGrow = this.save.wishes >= UNLOCK_FLOWERS ? 1 : 0;
    this.lanternGrow = this.save.wishes >= UNLOCK_LANTERNS ? 1 : 0;

    this.fx = new Particles();
    this.content.add(this.fx.mesh);
    this.ripples = new Ripples();
    this.ripples.group.position.set(this.pond.position.x, GROUND_Y + 0.0004, this.pond.position.z);
    this.content.add(this.ripples.group);

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
    if (DEBUG) {
      (window as unknown as { __palm: unknown }).__palm = {
        villagerWorld: (i: number) => this.villagers[i].obj.getWorldPosition(new Vector3()).toArray(),
        islandToWorld: (x: number, y: number, z: number) =>
          this.island.localToWorld(new Vector3(x, y, z)).toArray(),
        wish: () => ({ type: this.wishType, idx: this.wishIdx, wishes: this.save.wishes, night: this.night }),
      };
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
    this.inXR = inXR;
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
    // One-euro style filter: heavy smoothing while the hand is still (hides
    // tracking jitter), light smoothing when it moves (no rubber-band lag).
    if (!this.anchorInit) {
      this.prevTargetPos.copy(this.targetPos);
      this.prevTargetQuat.copy(this.targetQuat);
      this.anchorInit = true;
    }
    const linSpeed = this.prevTargetPos.distanceTo(this.targetPos) / Math.max(dt, 1e-4);
    const angSpeed = this.prevTargetQuat.angleTo(this.targetQuat) / Math.max(dt, 1e-4);
    this.prevTargetPos.copy(this.targetPos);
    this.prevTargetQuat.copy(this.targetQuat);
    const rawSpeed = linSpeed + angSpeed * 0.05; // 1 rad/s counts like 5 cm/s
    this.anchorSpeed += (rawSpeed - this.anchorSpeed) * Math.min(1, dt * 20);
    const cutoff = 2.2 + this.anchorSpeed * 60; // Hz
    const k = 1 - Math.exp(-2 * Math.PI * cutoff * dt);
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
    this.updateVillagerShadows();
    this.updateGrowth(dt);
    this.updateDrops(dt);
    this.fx.update(dt);
    this.ripples.update(dt, 0.011 * this.pond.scale.x, 1 - Math.min(1, tilt * 2));
    this.updateLabel(inXR, present, dt);
    this.updateSteps(dt);
    this.updateWishes(dt, present);
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
        vn: this.villagers.length,
        arr: this.villagers.some((v) => v.arriving),
        greet: +this.arrivalLabel.toFixed(1),
        days: this.save.days,
        wish: this.wishType,
        wi: this.wishIdx,
        wishes: this.save.wishes,
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
          if (before < 1 && f.wet >= 1) {
            sfx.pop();
            this.v3.copy(f.center).setY(GROUND_Y + 0.001);
            this.fx.burst(this.v3, 0x8fd3ff, 10, { speed: 0.025, up: 0.035, size: 0.0008 });
            if (this.wishType === 'water' && this.fields[this.wishField] === f) this.grantWish();
          }
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
      const m = f.wet > 0.6 ? M.fieldWet : M.fieldDry;
      if (f.soil.material !== m) f.soil.material = m;
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
        if (v.arriving) continue;
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
    for (let i = 0; i < this.villagers.length; i++) {
      const v = this.villagers[i];
      const wantsPlay = this.wishType === 'play' && this.wishIdx === i;
      if (Math.hypot(v.pos.x - tip.x, v.pos.z - tip.z) < (wantsPlay ? 0.008 : 0.005)) {
        if (v.hop <= 0) {
          v.hop = 1;
          sfx.pop();
        }
        if (wantsPlay) this.grantWish();
        this.plantCooldown = 0.4;
        return;
      }
    }
    if (!this.canPlant(tip.x, tip.z)) {
      // Let the player know the poke registered even when nothing can grow there.
      sfx.thud();
      this.v3.set(tip.x, GROUND_Y + 0.0005, tip.z);
      this.fx.burst(this.v3, 0xc9b48a, 4, { speed: 0.012, up: 0.012, size: 0.0006, life: 0.4 });
      this.plantCooldown = 0.5;
      return;
    }
    const seed = Math.floor(Math.random() * 1e6);
    this.addTree(tip.x, tip.z, seed, true);
    this.v3.set(tip.x, GROUND_Y + 0.001, tip.z);
    this.fx.burst(this.v3, 0x5fb85a, 9, { speed: 0.03, up: 0.04 });
    this.fx.burst(this.v3, 0xa8744a, 5, { speed: 0.02, up: 0.025, size: 0.0007 });
    if (this.wishType === 'tree') {
      const w = this.villagers[this.wishIdx];
      if (w && Math.hypot(w.pos.x - tip.x, w.pos.z - tip.z) < 0.016) this.grantWish();
    }
    this.save.trees.push([round4(tip.x), round4(tip.z), seed]);
    this.persist();
    this.plantCooldown = 0.6;
    sfx.plant();
  }

  private isOpenGrass(x: number, z: number): boolean {
    const p = this.pond.position;
    if (Math.hypot(x - p.x, z - p.z) < 0.014) return false;
    if (Math.hypot(x - HOUSE_SPOT.x, z - HOUSE_SPOT.z) < 0.009) return false;
    if (Math.hypot(x - HUT_SPOT.x, z - HUT_SPOT.z) < 0.009) return false;
    for (const f of this.fields) if (Math.hypot(x - f.center.x, z - f.center.z) < 0.009) return false;
    return true;
  }

  private canPlant(x: number, z: number): boolean {
    if (this.trees.length >= 40) return false;
    if (!this.isOpenGrass(x, z)) return false;
    for (const t of this.trees) if (Math.hypot(x - t.position.x, z - t.position.z) < 0.0065) return false;
    return true;
  }

  private addTree(x: number, z: number, seed: number, animate: boolean): void {
    const t = buildTree(seed);
    t.position.set(x, 0.006, z);
    const sh = blobShadow(0.0034);
    sh.position.y = GROUND_Y - 0.006 + 0.0001;
    t.add(sh);
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
      this.v3.set(v.pos.x, GROUND_Y + 0.0005, v.pos.z);
      this.fx.burst(this.v3, 0xe8dcc0, 6, { speed: 0.015, up: 0.012, size: 0.0006, life: 0.5 });
      if (this.save.step === 5 && Math.hypot(v.pos.x - HUT_SPOT.x, v.pos.z - HUT_SPOT.z) < 0.012) {
        this.advance();
      }
      if (this.wishType === 'friend' && this.villagers[this.wishIdx] === v) {
        for (const o of this.villagers) {
          if (o !== v && !o.arriving && Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z) < 0.011) {
            o.hop = 1;
            this.grantWish();
            break;
          }
        }
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
      if (v.arriving) {
        // Wait until the player is in XR and the island has grown in, then float
        // down with a sway. The flat-screen preview never shows the newcomer, so
        // the moment isn't spent before the player puts the headset on.
        v.obj.visible = this.inXR;
        if (this.inXR && this.reveal > 0.9) {
          v.pos.y = Math.max(0, v.pos.y - dt * 0.018);
          v.obj.rotation.y += dt * 3;
          v.obj.rotation.z = Math.sin(this.time * 4) * 0.25;
          if (v.pos.y <= 0) {
            v.arriving = false;
            v.obj.rotation.z = 0;
            v.hop = 1;
            v.target.copy(v.pos);
            this.arrivalLabel = 7;
            this.v3.set(v.pos.x, GROUND_Y + 0.002, v.pos.z);
            this.fx.burst(this.v3, 0xf2b134, 10, { speed: 0.03, up: 0.05 });
            this.fx.burst(this.v3, 0xe85d75, 8, { speed: 0.03, up: 0.05 });
            sfx.pop();
            sfx.chime();
          }
        }
        v.obj.position.set(v.pos.x, 0.006 + v.pos.y, v.pos.z);
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
      if (v.vel.lengthSq() > 1e-8) {
        // Turn smoothly toward the walking direction instead of snapping.
        const want = Math.atan2(v.vel.x, v.vel.z);
        let d = want - v.obj.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.obj.rotation.y += d * Math.min(1, dt * 10);
      }
    }
  }

  private updateVillagerShadows(): void {
    for (const v of this.villagers) {
      const o = v.obj.position;
      const h = Math.max(0, o.y - 0.006);
      const onIsland = Math.hypot(o.x, o.z) < R * 0.97 && o.y > -0.005;
      v.shadow.visible = v.obj.visible && onIsland && !v.falling;
      v.shadow.position.set(o.x, GROUND_Y + 0.0001, o.z);
      v.shadow.scale.setScalar(0.0017 / (1 + h * 35));
    }
  }

  private pickWanderTarget(v: Villager, i: number): void {
    // At night villagers head home; by day they wander.
    if (this.night > 0.6) {
      const toHut = this.save.step >= 6 && (i === 2 || (i > 2 && i % 2 === 1));
      const home = toHut ? HUT_SPOT : HOUSE_SPOT;
      v.target.set(home.x + ((i % 3) - 1) * 0.004, 0, home.z + 0.006 + (i > 2 ? 0.004 : 0));
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
      const s = Math.max(0.001, easeOutBack(f.growth));
      // Crops sway gently once grown.
      f.crops.scale.set(s, s * (1 + Math.sin(this.time * 2.2 + f.center.x * 200) * 0.06 * f.growth), s);
    }
    const hutTarget = this.save.step >= 5 ? 1 : 0.0001;
    const hs = this.hut.scale.x + (hutTarget - this.hut.scale.x) * Math.min(1, dt * 3);
    this.hut.scale.setScalar(hs);
  }

  private updateLabel(inXR: boolean, present: boolean, dt: number): void {
    const step = Math.min(this.save.step, STEPS.length - 1);
    let text = STEPS[step];
    if (step === 2 && this.pondLevel < 0.12) text = 'The pond ran dry. Hold your hand flat for a moment to refill it';
    if (!inXR) text = '';
    if (!inXR && step > 0) text = '';
    if (step === 6 && !film) {
      // After the guided session the wishes take over the label.
      if (this.stepTimer < 6) text = 'Your villagers have wishes now. Watch for a thought bubble';
      else if (this.wishMsgT > 0) text = this.wishMsg;
      else if (this.wishType && this.wishAge < 14) text = `${WISH_TEXT[this.wishType]}  \u2665 ${this.save.wishes}`;
      else text = '';
    }
    if (step === 6 && film && this.stepTimer > 8) text = '';
    if (this.arrivalLabel > 0) {
      this.arrivalLabel -= dt;
      text = `Day ${this.save.days}: a new villager moved in! Pinch them to say hi`;
    }
    if (!inXR) text = '';
    // Fade out the old message before showing a new one, then fade it in.
    if (text !== this.labelShown) {
      this.labelAlpha = Math.max(0, this.labelAlpha - dt * 6);
      if (this.labelAlpha <= 0) {
        this.labelShown = text;
        this.label.set(text);
      }
    } else if (text) {
      this.labelAlpha = Math.min(1, this.labelAlpha + dt * 4);
    }
    this.label.setOpacity(this.labelAlpha);
    this.label.setPop(0.85 + 0.15 * easeOutBack(this.labelAlpha));
    const s = this.label.sprite;
    const follow = 1 - Math.exp(-dt * 12);
    if (present && this.reveal > 0.3) {
      this.v1.set(0, 0.075 * (inXR ? 1 : 3), 0);
      this.island.localToWorld(this.v1.multiplyScalar(1 / this.island.scale.x));
      s.position.lerp(this.v1, follow);
    } else {
      // Float in front of the viewer when there's no island yet.
      this.world.camera.getWorldPosition(this.v1);
      this.world.camera.getWorldDirection(this.v2);
      this.v1.addScaledVector(this.v2, 0.5);
      this.v1.y -= 0.12;
      s.position.lerp(this.v1, follow);
    }
    s.visible = this.labelAlpha > 0.01 && this.labelShown !== '';
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

  // ---------------------------------------------------------------------------
  // Villager wishes

  private updateWishes(dt: number, present: boolean): void {
    const n = this.save.wishes;
    // Village unlocks grow in rather than popping.
    this.flowerGrow += ((n >= UNLOCK_FLOWERS ? 1 : 0) - this.flowerGrow) * Math.min(1, dt * 2);
    this.lanternGrow += ((n >= UNLOCK_LANTERNS ? 1 : 0) - this.lanternGrow) * Math.min(1, dt * 2);
    this.flowers.visible = this.flowerGrow > 0.01;
    this.flowers.scale.set(1, Math.max(0.001, this.flowerGrow), 1);
    this.flowers.position.y = GROUND_Y * (1 - this.flowerGrow);
    this.lanternRing.visible = this.lanternGrow > 0.01;
    this.lanternRing.scale.set(1, Math.max(0.001, this.lanternGrow), 1);
    this.lanternRing.position.y = GROUND_Y * (1 - this.lanternGrow);
    // Festival: fireworks over the island on any night once the village is happy.
    if (n >= UNLOCK_FESTIVAL && this.night > 0.8 && present) {
      this.fireworkT -= dt;
      if (this.fireworkT <= 0) {
        this.fireworkT = 0.7 + Math.random() * 0.9;
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * R * 0.6;
        this.v3.set(Math.cos(a) * d, 0.04 + Math.random() * 0.025, Math.sin(a) * d);
        const col = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
        this.fx.burst(this.v3, col, 16, { speed: 0.05, up: 0.01, gravity: 0.03, life: 1.1, size: 0.0008 });
        sfx.pop();
      }
    }

    if (this.wishMsgT > 0) this.wishMsgT -= dt;
    const active = !film && this.save.step >= 6 && present && this.reveal > 0.9;
    if (!active) {
      this.bubble.sprite.visible = false;
      return;
    }
    if (!this.wishType) {
      this.bubble.sprite.visible = false;
      this.wishWait -= dt;
      if (this.wishWait <= 0 && this.stepTimer > 6 && this.heldIdx < 0) this.startWish();
      return;
    }
    this.wishAge += dt;
    const v = this.villagers[this.wishIdx];
    if (this.wishType === 'sleep') {
      this.wishHold = this.night > 0.75 ? this.wishHold + dt : 0;
      if (this.wishHold > 1.5) {
        this.grantWish();
        return;
      }
    }
    if (this.wishAge > 60 || v.falling) {
      // Unanswered wishes quietly pass; another villager asks later.
      this.wishType = null;
      this.wishWait = 4;
      return;
    }
    const b = this.bubble.sprite;
    b.visible = v.obj.visible;
    const pop = Math.min(1, this.wishAge * 4);
    b.scale.setScalar(0.011 * easeOutBack(pop));
    if (this.wishType === 'water') {
      const f = this.fields[this.wishField];
      b.position.set(f.center.x, GROUND_Y + 0.013 + Math.sin(this.time * 3) * 0.0008, f.center.z);
    } else {
      b.position.set(v.obj.position.x, v.obj.position.y + 0.013 + Math.sin(this.time * 3) * 0.0008, v.obj.position.z);
    }
  }

  private startWish(): void {
    const candidates: number[] = [];
    for (let i = 0; i < this.villagers.length; i++) {
      const v = this.villagers[i];
      if (!v.held && !v.falling && !v.arriving) candidates.push(i);
    }
    if (!candidates.length) return;
    // The first wishes follow a fixed order so every gesture gets a purpose early.
    let type = WISH_TYPES[this.save.wishes % WISH_TYPES.length];
    if (this.save.wishes >= WISH_TYPES.length) {
      do type = WISH_TYPES[Math.floor(Math.random() * WISH_TYPES.length)];
      while (type === this.lastWish);
    }
    const forced = PARAMS.get('wish') as WishType | null;
    if (forced && WISH_TYPES.includes(forced)) type = forced;
    if (type === 'tree' && this.trees.length >= 40) type = 'play';
    if (type === 'sleep' && this.night > 0.5) type = 'play';
    this.wishType = type;
    this.lastWish = type;
    this.wishIdx = candidates[Math.floor(Math.random() * candidates.length)];
    this.wishAge = 0;
    this.wishHold = 0;
    if (type === 'water') {
      this.wishField = Math.floor(Math.random() * this.fields.length);
      const f = this.fields[this.wishField];
      f.wet = 0;
      f.growth = 0;
    }
    this.bubble.set(type);
    sfx.pick();
  }

  private grantWish(): void {
    const type = this.wishType;
    if (!type) return;
    const v = this.villagers[this.wishIdx];
    this.wishType = null;
    this.wishWait = 5;
    this.save.wishes++;
    this.persist();
    const n = this.save.wishes;
    if (type === 'water') {
      const f = this.fields[this.wishField];
      f.growth = 1;
      this.v3.copy(f.center).setY(GROUND_Y + 0.006);
    } else {
      if (v) v.hop = 1;
      this.v3.set(v.obj.position.x, v.obj.position.y + 0.008, v.obj.position.z);
    }
    this.fx.burst(this.v3, 0xff6f91, 12, { speed: 0.02, up: 0.05, gravity: 0.02, life: 1.0, size: 0.0008 });
    sfx.chime();
    if (n === UNLOCK_FLOWERS) this.wishMsg = `Wish granted! \u2665 ${n}. Wildflowers bloom across the island`;
    else if (n === UNLOCK_LANTERNS) this.wishMsg = `Wish granted! \u2665 ${n}. The villagers put up lanterns. Close your hand to see`;
    else if (n === UNLOCK_FESTIVAL) this.wishMsg = `\u2665 ${n}. Festival! Close your hand tonight for fireworks`;
    else {
      const next = n < UNLOCK_FLOWERS ? UNLOCK_FLOWERS : n < UNLOCK_LANTERNS ? UNLOCK_LANTERNS : n < UNLOCK_FESTIVAL ? UNLOCK_FESTIVAL : 0;
      this.wishMsg = next ? `Wish granted! \u2665 ${n} of ${next}` : `Wish granted! \u2665 ${n}`;
    }
    this.wishMsgT = n === UNLOCK_FLOWERS || n === UNLOCK_LANTERNS || n === UNLOCK_FESTIVAL ? 6 : 3;
    if (n === UNLOCK_FLOWERS || n === UNLOCK_LANTERNS || n === UNLOCK_FESTIVAL) sfx.grow();
  }

  private advance(): void {
    if (this.save.step >= STEPS.length - 1) return;
    this.save.step++;
    this.stepTimer = 0;
    if (this.save.step > 1) {
      sfx.chime();
      this.v3.set(0, GROUND_Y + 0.01, 0);
      this.fx.burst(this.v3, 0xffe08a, 18, { speed: 0.04, up: 0.06, gravity: 0.05, life: 1.1, size: 0.0008 });
    }
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
    // Local calendar days, so "tomorrow" means after the player's midnight.
    const dayOf = (t: number) => Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 86400000);
    const newDay = !!this.save.lastVisit && (dayOf(Date.now()) > dayOf(this.save.lastVisit) || NEXT_DAY);
    if (newDay) {
      this.save.days++;
      // Finished the first session? A new villager moves in each day.
      if (this.save.step >= 6 && this.save.villagers < MAX_VILLAGERS && !film) {
        this.save.villagers = Math.max(3, this.save.villagers) + 1;
        this.arrivalPending = true;
      }
    }
    if (PARAMS.has('wishes')) this.save.wishes = Number(PARAMS.get('wishes')) || 0;
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

