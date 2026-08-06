// 오프라인 미리보기 렌더러 — 앱의 Body3DView와 같은 투영/셰이딩을 쓴다.
// mesh: { vertices: [{x,y,z}], tris: [{a,b,c,part}] }
const zlib = require('zlib');
const fs = require('fs');

const LIGHT = { x: -0.35, y: -0.45, z: 0.82 };
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

function bounds(pts) {
  const mn = { x: Infinity, y: Infinity, z: Infinity }, mx = { x: -Infinity, y: -Infinity, z: -Infinity };
  pts.forEach((v) => { for (const k of 'xyz') { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; } });
  return {
    center: { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 },
    size: { x: mx.x - mn.x, y: mx.y - mn.y, z: mx.z - mn.z },
  };
}

function rot3(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
  return [cy, 0, sy, sx * sy, cx, -sx * cy, -cx * sy, sx, cx * cy];
}

/** colorFn(tri, shade0to1) → [r,g,b]; 기본은 회색 마네킹 */
function render(mesh, { W = 300, H = 640, views = [0, Math.PI / 2, Math.PI], colorFn, out }) {
  const used = [];
  mesh.tris.forEach((t) => used.push(mesh.vertices[t.a], mesh.vertices[t.b], mesh.vertices[t.c]));
  const b = bounds(used);
  const canvasW = W * views.length;
  const buf = new Uint8Array(canvasW * H * 3).fill(255);
  const spanH = Math.max(b.size.x, b.size.z), spanV = Math.max(b.size.y, b.size.z);
  const span = Math.max(b.size.x, b.size.y, b.size.z);
  const cam = { cx: W / 2, cy: H / 2, scale: Math.min(W / (spanH * 1.12), H / (spanV * 1.06)), dist: span * 2.6, focal: span * 2.6 };

  views.forEach((yaw, vi) => {
    const m = rot3(yaw, 0);
    const n = mesh.vertices.length;
    const sx = new Float64Array(n), sy = new Float64Array(n), rx = new Float64Array(n), ry = new Float64Array(n), rz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = mesh.vertices[i];
      const px = v.x - b.center.x, py = v.y - b.center.y, pz = v.z - b.center.z;
      const qx = m[0] * px + m[1] * py + m[2] * pz, qy = m[3] * px + m[4] * py + m[5] * pz, qz = m[6] * px + m[7] * py + m[8] * pz;
      rx[i] = qx; ry[i] = qy; rz[i] = qz;
      const f = (cam.focal / Math.max(cam.dist - qz, 0.05)) * cam.scale;
      sx[i] = cam.cx + qx * f; sy[i] = cam.cy + qy * f;
    }
    const list = [];
    mesh.tris.forEach((t) => {
      const e1 = { x: rx[t.b] - rx[t.a], y: ry[t.b] - ry[t.a], z: rz[t.b] - rz[t.a] };
      const e2 = { x: rx[t.c] - rx[t.a], y: ry[t.c] - ry[t.a], z: rz[t.c] - rz[t.a] };
      let nn = cross(e1, e2);
      if (nn.z <= 0) return;
      nn = norm(nn);
      const shade = 0.32 + 0.68 * Math.max(0, nn.x * LIGHT.x + nn.y * LIGHT.y + nn.z * LIGHT.z);
      list.push({ t, d: (rz[t.a] + rz[t.b] + rz[t.c]) / 3, shade });
    });
    list.sort((p, q) => p.d - q.d);
    const ox = vi * W;
    list.forEach(({ t, shade }) => {
      const col = colorFn ? colorFn(t, shade) : [0xc9, 0xcd, 0xd4].map((c) => Math.min(255, Math.round(c * (0.5 + 0.6 * shade))));
      const xs3 = [sx[t.a], sx[t.b], sx[t.c]], ys3 = [sy[t.a], sy[t.b], sy[t.c]];
      const y0 = Math.max(0, Math.floor(Math.min(...ys3))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys3)));
      for (let y = y0; y <= y1; y++) {
        const xs = [];
        for (let i = 0; i < 3; i++) {
          const j = (i + 1) % 3, a = ys3[i], bb = ys3[j];
          if (a === bb) continue;
          const s = (y + 0.5 - a) / (bb - a);
          if (s < 0 || s > 1) continue;
          xs.push(xs3[i] + (xs3[j] - xs3[i]) * s);
        }
        if (xs.length < 2) continue;
        const xa = Math.max(0, Math.round(Math.min(...xs))), xb = Math.min(W - 1, Math.round(Math.max(...xs)));
        for (let x = xa; x <= xb; x++) {
          const o = (y * canvasW + x + ox) * 3;
          buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2];
        }
      }
    });
  });
  fs.writeFileSync(out, png(canvasW, H, buf));
}

const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgb.buffer, y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { render, bounds };
