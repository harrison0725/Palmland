import {
  BufferAttribute,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  BoxGeometry,
  Object3D,
} from '@iwsdk/core';

/** Island radius in metres. Sized to sit on an adult palm. */
export const R = 0.048;

const mat = (color: number, opts: Partial<MeshStandardMaterial> = {}) =>
  new MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, ...opts });

export const M = {
  grass: mat(0x7cc45a),
  dirt: mat(0x8a5a3b),
  dirtLight: mat(0xa8744a),
  cloud: mat(0xffffff, { roughness: 1 } as Partial<MeshStandardMaterial>),
  chimney: mat(0x8c7b6b),
  rock: mat(0x6e6a73),
  trunk: mat(0x6b4226),
  leaf: mat(0x3f9a4a),
  leaf2: mat(0x5fb85a),
  water: mat(0x4fb3ff, {
    roughness: 0.2,
    transparent: true,
    opacity: 0.85,
  } as Partial<MeshStandardMaterial>),
  wall: mat(0xf2e2c4),
  roof: mat(0xc65a3a),
  fieldDry: mat(0xb8955a),
  fieldWet: mat(0x6b4a2e),
  crop: mat(0xe8c94a),
  lantern: new MeshStandardMaterial({
    color: 0xffd27a,
    emissive: 0xffa53a,
    emissiveIntensity: 0,
  }),
  skin: mat(0xf0c49b),
};

const villagerColors = [0xe85d75, 0x4a7fe8, 0xf2b134, 0x8a5ce8, 0x2fbf9f, 0xf07a3a, 0x5cb85c, 0xd96ad1];

/** Deterministic pseudo-random so every player gets the same island. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildIslandBase(): Group {
  const g = new Group();
  // Grass top, gently domed.
  const topGeo = new CylinderGeometry(R, R * 0.96, 0.006, 28, 2);
  const top = new Mesh(topGeo, M.grass);
  top.position.y = 0.003;
  g.add(top);
  const rim = new Mesh(new CylinderGeometry(R * 0.985, R * 0.95, 0.004, 28), M.dirtLight);
  rim.position.y = -0.0005;
  g.add(rim);
  // Hanging roots under the rock.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const len = 0.008 + ((i * 37) % 10) * 0.0012;
    const root = new Mesh(new ConeGeometry(0.0009, len, 4), M.trunk);
    root.rotation.x = Math.PI;
    root.position.set(Math.cos(a) * R * 0.7, -0.012 - len / 2, Math.sin(a) * R * 0.7);
    g.add(root);
  }
  // Floating-island rock underside: a jagged inverted cone.
  const under = new ConeGeometry(R * 0.97, 0.05, 14, 3);
  const pos = under.getAttribute('position') as BufferAttribute;
  const r = rng(7);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.024) {
      const k = 1 + (r() - 0.5) * 0.35;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
  }
  under.computeVertexNormals();
  const underMesh = new Mesh(under, M.dirt);
  underMesh.rotation.x = Math.PI;
  underMesh.position.y = -0.025;
  g.add(underMesh);
  // A few rocks on the rim.
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const rock = new Mesh(new IcosahedronGeometry(0.0018 + r() * 0.0018, 0), M.rock);
    rock.position.set(Math.cos(a) * R * 0.9, 0.0065, Math.sin(a) * R * 0.9);
    rock.rotation.set(r() * 3, r() * 3, 0);
    g.add(rock);
  }
  return g;
}

export function buildPond(): Mesh {
  const pond = new Mesh(new CircleGeometry(0.011, 20), M.water);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(0.004, 0.0062, -0.006);
  return pond;
}

export function buildTree(seed: number): Group {
  const r = rng(seed);
  const g = new Group();
  const h = 0.006 + r() * 0.004;
  const trunk = new Mesh(new CylinderGeometry(0.0008, 0.001, h * 0.5, 5), M.trunk);
  trunk.position.y = h * 0.25;
  g.add(trunk);
  if (r() > 0.45) {
    const crown = new Mesh(new ConeGeometry(0.0032 + r() * 0.0012, h, 6), r() > 0.5 ? M.leaf : M.leaf2);
    crown.position.y = h * 0.5 + h * 0.4;
    g.add(crown);
  } else {
    const leafMat = r() > 0.5 ? M.leaf2 : M.leaf;
    for (let i = 0; i < 3; i++) {
      const blob = new Mesh(new IcosahedronGeometry(0.0026 + r() * 0.001, 0), leafMat);
      blob.position.set((r() - 0.5) * 0.003, h * 0.55 + i * 0.0018, (r() - 0.5) * 0.003);
      g.add(blob);
    }
  }
  g.rotation.y = r() * Math.PI * 2;
  return g;
}

export function buildHouse(withLantern = true): Group {
  const g = new Group();
  const wall = new Mesh(new BoxGeometry(0.009, 0.0065, 0.008), M.wall);
  wall.position.y = 0.00325;
  g.add(wall);
  const roof = new Mesh(new ConeGeometry(0.0078, 0.0055, 4), M.roof);
  roof.position.y = 0.0092;
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.85;
  g.add(roof);
  const chimney = new Mesh(new BoxGeometry(0.0014, 0.004, 0.0014), M.chimney);
  chimney.position.set(-0.0022, 0.0105, 0.0012);
  g.add(chimney);
  const door = new Mesh(new BoxGeometry(0.0022, 0.0034, 0.0004), M.trunk);
  door.position.set(0, 0.0017, 0.0041);
  g.add(door);
  if (withLantern) {
    const lamp = new Mesh(new SphereGeometry(0.0009, 6, 4), M.lantern);
    lamp.position.set(0.0028, 0.0042, 0.0046);
    g.add(lamp);
    const light = new PointLight(0xffb050, 0, 0.05, 2);
    light.position.copy(lamp.position);
    light.name = 'lantern-light';
    g.add(light);
  }
  return g;
}

export function buildField(): Group {
  const g = new Group();
  const soil = new Mesh(new BoxGeometry(0.011, 0.0012, 0.008), M.fieldDry);
  soil.name = 'soil';
  soil.position.y = 0.0006;
  g.add(soil);
  const crops = new Group();
  crops.name = 'crops';
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z += 2) {
      const c = new Mesh(new ConeGeometry(0.001, 0.0042, 4), M.crop);
      c.position.set(x * 0.0035, 0.0021, z * 0.002);
      crops.add(c);
    }
  }
  crops.scale.setScalar(0.001);
  g.add(crops);
  return g;
}

export function buildVillager(i: number): Object3D {
  const g = new Group();
  const body = new Mesh(
    new CylinderGeometry(0.0011, 0.0016, 0.0035, 6),
    mat(villagerColors[i % villagerColors.length]),
  );
  body.position.y = 0.00175;
  g.add(body);
  const head = new Mesh(new SphereGeometry(0.0013, 8, 6), M.skin);
  head.position.y = 0.0045;
  g.add(head);
  return g;
}

export function buildCloud(seed: number): Group {
  const r = rng(seed);
  const g = new Group();
  for (let i = 0; i < 4; i++) {
    const puff = new Mesh(new IcosahedronGeometry(0.0035 + r() * 0.002, 1), M.cloud);
    puff.position.set((i - 1.5) * 0.0045, r() * 0.0015, (r() - 0.5) * 0.003);
    puff.scale.y = 0.7;
    g.add(puff);
  }
  return g;
}

export function lerpColor(out: Color, a: number, b: number, t: number) {
  out.set(a).lerp(new Color(b), t);
}
