import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from '@iwsdk/core';
import { M, R, rng } from './island.js';
import { GROUND_Y } from './fx.js';

export type WishType = 'tree' | 'water' | 'sleep' | 'friend' | 'play';
export const WISH_TYPES: WishType[] = ['play', 'tree', 'sleep', 'friend', 'water'];
export const WISH_TEXT: Record<WishType, string> = {
  tree: 'A villager wants shade. Poke the grass next to them to plant a tree',
  water: 'A field has dried out. Tilt your hand to pour the pond onto it',
  sleep: 'A villager is sleepy. Slowly close your hand to bring the night',
  friend: 'A villager misses a friend. Pinch them and set them down beside another',
  play: 'A villager wants to play. Give them a gentle poke',
};
/** Wishes granted needed for each village unlock. */
export const UNLOCK_FLOWERS = 3;
export const UNLOCK_LANTERNS = 6;
export const UNLOCK_FESTIVAL = 10;

/** A thought bubble with a simple drawn icon, floating over the wishing villager. */
export class WishBubble {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly tex: CanvasTexture;
  private shown: WishType | null = null;

  constructor() {
    this.canvas.width = this.canvas.height = 128;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.sprite = new Sprite(
      new SpriteMaterial({ map: this.tex, transparent: true, depthTest: false }),
    );
    this.sprite.renderOrder = 9;
    this.sprite.visible = false;
  }

  set(type: WishType): void {
    if (type === this.shown) return;
    this.shown = type;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 128, 128);
    // Bubble with a little tail.
    c.fillStyle = 'rgba(255,255,255,0.96)';
    c.strokeStyle = 'rgba(40,44,60,0.55)';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(64, 54, 46, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.arc(52, 112, 8, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.save();
    c.translate(64, 54);
    if (type === 'tree') {
      c.fillStyle = '#6b4226';
      c.fillRect(-5, 12, 10, 18);
      c.fillStyle = '#3f9a4a';
      c.beginPath();
      c.moveTo(0, -32);
      c.lineTo(24, 14);
      c.lineTo(-24, 14);
      c.closePath();
      c.fill();
    } else if (type === 'water') {
      c.fillStyle = '#3fa4f2';
      c.beginPath();
      c.moveTo(0, -30);
      c.bezierCurveTo(26, 4, 20, 28, 0, 28);
      c.bezierCurveTo(-20, 28, -26, 4, 0, -30);
      c.fill();
    } else if (type === 'sleep') {
      c.fillStyle = '#5b5fc7';
      c.beginPath();
      c.arc(0, 0, 26, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.96)';
      c.beginPath();
      c.arc(11, -9, 22, 0, Math.PI * 2);
      c.fill();
    } else if (type === 'friend') {
      c.fillStyle = '#e85d75';
      c.beginPath();
      c.moveTo(0, 26);
      c.bezierCurveTo(-40, -2, -22, -34, 0, -12);
      c.bezierCurveTo(22, -34, 40, -2, 0, 26);
      c.fill();
    } else {
      c.fillStyle = '#f2b134';
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 12 : 30;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
    }
    c.restore();
    this.tex.needsUpdate = true;
  }
}

const FLOWER_COLORS = [0xffffff, 0xffd84a, 0xff8fb3, 0xc79bff, 0xff7a59];

/** Wildflowers scattered on open grass. `ok` rejects spots under buildings, fields and the pond. */
export function buildFlowers(ok: (x: number, z: number) => boolean): InstancedMesh {
  const n = 46;
  const mesh = new InstancedMesh(
    new IcosahedronGeometry(0.0007, 0),
    new MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
    n,
  );
  const r = rng(321);
  const m = new Matrix4();
  const c = new Color();
  let placed = 0;
  for (let tries = 0; placed < n && tries < 600; tries++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * R * 0.9;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!ok(x, z)) continue;
    m.makeScale(1, 0.7, 1).setPosition(x, GROUND_Y + 0.0005, z);
    mesh.setMatrixAt(placed, m);
    mesh.setColorAt(placed, c.set(FLOWER_COLORS[Math.floor(r() * FLOWER_COLORS.length)]));
    placed++;
  }
  mesh.count = placed;
  mesh.frustumCulled = false;
  return mesh;
}

/** A ring of small lantern posts around the rim; they glow with the houses at night. */
export function buildLanternRing(): Group {
  const g = new Group();
  const postGeo = new CylinderGeometry(0.00025, 0.00025, 0.006, 4);
  const lampGeo = new SphereGeometry(0.0009, 6, 4);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.15;
    const post = new Mesh(postGeo, M.trunk);
    post.position.set(Math.cos(a) * R * 0.86, GROUND_Y + 0.003, Math.sin(a) * R * 0.86);
    const lamp = new Mesh(lampGeo, M.lantern);
    lamp.position.y = 0.0036;
    post.add(lamp);
    g.add(post);
  }
  return g;
}
