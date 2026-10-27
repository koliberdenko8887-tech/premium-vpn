// FBX (Meshy) -> mz blob for hero3d.js makeStatic: height 20, feet at y=0, centred, ~40k triangles
import fs from 'fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
globalThis.window = { URL: { createObjectURL: () => '' } };
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
const [src, out, target] = [process.argv[2], process.argv[3], +(process.argv[4] || 40000)];
const buf = fs.readFileSync(src);
const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '');
obj.updateMatrixWorld(true);
const P = [], N = [], U = [];
obj.traverse(m => {
  if (!m.isMesh) return;
  let g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); U.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0); }
});
let nv0 = P.length / 3; console.log('tris', nv0 / 3);
// weld identical vertices
const key = new Map(), remap = new Uint32Array(nv0), VP = [], VN = [], VU = [];
for (let i = 0; i < nv0; i++) {
  const k = [P[3*i], P[3*i+1], P[3*i+2], U[2*i], U[2*i+1]].map(x => Math.round(x * 1e5)).join(',');
  let j = key.get(k);
  if (j === undefined) { j = VP.length / 3; key.set(k, j); VP.push(P[3*i], P[3*i+1], P[3*i+2]); VN.push(N[3*i], N[3*i+1], N[3*i+2]); VU.push(U[2*i], U[2*i+1]); }
  remap[i] = j;
}
await MeshoptSimplifier.ready; await MeshoptEncoder.ready; MeshoptSimplifier.useExperimentalFeatures = true;
const pos = new Float32Array(VP), nv = pos.length / 3;
const attr = new Float32Array(nv * 2); for (let i = 0; i < nv * 2; i++) attr[i] = VU[i];
const [ix, err] = MeshoptSimplifier.simplifyWithAttributes(remap, pos, 3, attr, 2, [0.5, 0.5], null, target * 3, 0.02, []);
console.log('welded verts', nv, '-> tris', ix.length / 3, 'err', err);
// compact
const used = new Int32Array(nv).fill(-1); let c = 0; const ord = [];
for (const v of ix) if (used[v] < 0) { used[v] = c++; ord.push(v); }
let I = new Uint32Array(ix.length); for (let i = 0; i < ix.length; i++) I[i] = used[ix[i]];
I = MeshoptEncoder.reorderMesh ? I : I;
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const v of ord) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], VP[3*v+k]); mx[k] = Math.max(mx[k], VP[3*v+k]); }
const s = 20 / (mx[1] - mn[1]), cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
const Q = [], A = [(mn[0]-cx)*s, 0, (mn[2]-cz)*s], B = [(mx[0]-cx)*s, 20, (mx[2]-cz)*s];
const V = new Uint8Array(c * 16), q = new Uint16Array(V.buffer), n8 = new Int8Array(V.buffer);
ord.forEach((v, i) => {
  const p = [(VP[3*v]-cx)*s, (VP[3*v+1]-mn[1])*s, (VP[3*v+2]-cz)*s];
  for (let k = 0; k < 3; k++) q[8*i+k] = Math.round((p[k]-A[k]) / (B[k]-A[k]) * 65535);
  q[8*i+4] = Math.round(Math.min(1, Math.max(0, VU[2*v])) * 65535); q[8*i+5] = Math.round(Math.min(1, Math.max(0, VU[2*v+1])) * 65535);
  const L = Math.hypot(VN[3*v], VN[3*v+1], VN[3*v+2]) || 1; for (let k = 0; k < 3; k++) n8[16*i+12+k] = Math.round(VN[3*v+k] / L * 127);
});
const vs = MeshoptEncoder.encodeVertexBuffer(V, c, 16), is = MeshoptEncoder.encodeIndexBuffer(new Uint8Array(I.buffer), I.length, 4);
const h = new Float32Array([c, I.length / 3, ...A, ...B]), out8 = new Uint8Array(36 + vs.length + is.length);
out8.set(new Uint8Array(h.buffer), 0); new Uint32Array(out8.buffer, 32, 1)[0] = vs.length; out8.set(vs, 36); out8.set(is, 36 + vs.length);
fs.writeFileSync(out, out8); console.log('size', A, B, 'bytes', out8.length);
