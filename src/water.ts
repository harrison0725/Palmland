import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from '@iwsdk/core';

const SEG = 18;

/**
 * The stream that runs from the pond to the island rim when the palm tilts.
 * A ribbon that tapers, meanders gently and carries flecks of foam downstream,
 * so the water reads as flowing rather than as a bar that switches on.
 */
export class Stream {
  readonly mesh: Mesh;
  readonly foam: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly attr: BufferAttribute;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private static readonly FOAM = 7;

  constructor(material: Material) {
    this.pos = new Float32Array((SEG + 1) * 2 * 3);
    const geo = new BufferGeometry();
    this.attr = new BufferAttribute(this.pos, 3);
    this.attr.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    const normals = new Float32Array((SEG + 1) * 2 * 3);
    for (let i = 0; i < (SEG + 1) * 2; i++) normals[i * 3 + 1] = 1;
    geo.setAttribute('normal', new BufferAttribute(normals, 3));
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    geo.setIndex(idx);
    this.mesh = new Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    const dot = new CircleGeometry(1, 8);
    dot.rotateX(-Math.PI / 2);
    this.foam = new InstancedMesh(
      dot,
      new MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.85, depthWrite: false }),
      Stream.FOAM,
    );
    this.foam.instanceMatrix.setUsage(DynamicDrawUsage);
    this.foam.frustumCulled = false;
    this.foam.visible = false;
    this.foam.renderOrder = 3;
  }

  /**
   * @param k 0..1 how established the flow is (eases in when pouring starts and out when it stops)
   * @param reach 0..1 how far the head of the stream has run toward the rim
   */
  update(start: Vector3, end: Vector3, k: number, reach: number, time: number, y: number): void {
    const show = k > 0.01;
    this.mesh.visible = show;
    this.foam.visible = show;
    if (!show) return;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    for (let i = 0; i <= SEG; i++) {
      const u = (i / SEG) * reach;
      // Meander that travels downstream, pinned at the pond and at the rim.
      const sway = Math.sin(u * 8 - time * 4.5) * 0.0007 * Math.sin(Math.min(1, u) * Math.PI);
      const cx = start.x + dx * u + nx * sway;
      const cz = start.z + dz * u + nz * sway;
      // Wide where it leaves the pond, narrowing as it runs; a rounded head while it advances.
      let half = 0.0026 * (1 - 0.4 * u) * k * (1 + 0.1 * Math.sin(u * 13 - time * 7));
      if (reach < 0.999) half *= Math.min(1, (1 - i / SEG) * 5);
      const o = i * 6;
      this.pos[o] = cx + nx * half;
      this.pos[o + 1] = y;
      this.pos[o + 2] = cz + nz * half;
      this.pos[o + 3] = cx - nx * half;
      this.pos[o + 4] = y;
      this.pos[o + 5] = cz - nz * half;
    }
    this.attr.needsUpdate = true;
    for (let j = 0; j < Stream.FOAM; j++) {
      const u = (time * 0.55 + j / Stream.FOAM + (j % 2) * 0.07) % 1;
      const side = ((j * 0.618) % 1) - 0.5;
      const sway = Math.sin(u * 8 - time * 4.5) * 0.0007 * Math.sin(u * Math.PI);
      const off = side * 0.003 * (1 - 0.4 * u) + sway;
      this.p.set(start.x + dx * u + nx * off, y + 0.00015, start.z + dz * u + nz * off);
      // Fade in at the pond, out at the rim, and hide anything beyond the head.
      const fade = Math.sin(u * Math.PI) * k * (u < reach ? 1 : 0);
      const sz = 0.00055 * fade;
      this.m.makeScale(sz, 1, sz).setPosition(this.p);
      this.foam.setMatrixAt(j, this.m);
    }
    this.foam.instanceMatrix.needsUpdate = true;
  }
}
