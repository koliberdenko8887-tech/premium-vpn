// 3D-человечки Премиум VPN: настоящие 3D-модели на three.js (свет, объём, глянец), своё, ничего не скопировано.
// Берёт тот же объект героя, что avatar.js (avNormalize): age, build, face, skin, hair, hairColor, eyes, eyeColor, brows, beard,
// freckles, lips, earrings, glasses, hat, hatColor, top, topColor, bottom, bottomColor, shoes, shoeColor, extra.
// Hero3D.build(o) -> {root, height, update(t, state)}; state: 'off' | 'wait' | 'on'
(function (root) {
  'use strict';
  var T = root.THREE;
  if (!T) return;
  var PI = Math.PI;
  function V(x, y, z) { return new T.Vector3(x, y, z); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function col(h) { return new T.Color(h); }
  function hex(c) { return '#' + c.getHexString(); }
  function mixc(a, b, t) { return hex(col(a).lerp(col(b), t)); }
  function shade(a, f) { return f < 0 ? mixc(a, '#000000', -f) : mixc(a, '#ffffff', f); }

  // ---------- shared caches: materials, geometries and textures are reused by every hero ----------
  var MC = {}, GC = {}, TC = {}, faceKeys = [];
  function mat(kind, c) {
    var k = kind + c;
    if (MC[k]) return MC[k];
    var o = { color: col(c), roughness: .6, metalness: 0 };
    if (kind === 'skin') Object.assign(o, { roughness: .5, sheen: .5, sheenColor: col('#ff8f80'), sheenRoughness: .45, clearcoat: .06, clearcoatRoughness: .5 });
    else if (kind === 'cloth') Object.assign(o, { roughness: .88, sheen: 1, sheenColor: col(c).lerp(col('#ffffff'), .4), sheenRoughness: .7 });
    else if (kind === 'denim') Object.assign(o, { roughness: .92, sheen: .7, sheenColor: col(c).lerp(col('#ffffff'), .5), sheenRoughness: .8 });
    else if (kind === 'hair') Object.assign(o, { roughness: .36, sheen: .6, sheenColor: col(c).lerp(col('#ffffff'), .22), sheenRoughness: .4, clearcoat: .3, clearcoatRoughness: .3 });
    else if (kind === 'gloss') Object.assign(o, { roughness: .28, clearcoat: 1, clearcoatRoughness: .12 });
    else if (kind === 'leather') Object.assign(o, { roughness: .4, clearcoat: .6, clearcoatRoughness: .25 });
    else if (kind === 'metal') Object.assign(o, { roughness: .22, metalness: 1 });
    else if (kind === 'eye') Object.assign(o, { roughness: .08, clearcoat: 1, clearcoatRoughness: .02 });
    else if (kind === 'lens') Object.assign(o, { roughness: .05, transparent: true, opacity: .62, clearcoat: 1 });
    else if (kind === 'glass') Object.assign(o, { roughness: .02, transparent: true, opacity: .14, clearcoat: 1 });
    else if (kind === 'glow') { var m = new T.MeshBasicMaterial({ color: col(c) }); return MC[k] = m; }
    return MC[k] = new T.MeshPhysicalMaterial(o);
  }
  var BASE = {
    cyl: function () { return new T.CylinderGeometry(1, 1, 1, 24, 1); },
    tor: function () { return new T.TorusGeometry(1, .35, 12, 32); },
    ring: function () { return new T.TorusGeometry(1, .07, 10, 48); },
    caps: function () { return new T.CapsuleGeometry(1, 1, 8, 20); },
    plane: function () { return new T.PlaneGeometry(1, 1); },
    cone: function () { return new T.CylinderGeometry(0, 1, 1, 40, 1); },
    hpband: function () { return new T.TorusGeometry(1, .06, 12, 40, Math.PI); }
  };
  function geo(key, fn) { return GC[key] || (GC[key] = (fn || BASE[key])()); }
  function mesh(g, m, shadow) { var x = new T.Mesh(g, m); x.castShadow = shadow !== false; return x; }
  function sphere(r, m, sx, sy, sz, seg) {
    var s = mesh(geo('s' + (seg || 40), function () { return new T.SphereGeometry(1, seg || 40, Math.round((seg || 40) * .7)); }), m);
    s.scale.set(r * (sx || 1), r * (sy || 1), r * (sz || 1)); return s;
  }
  function canvasTex(w, h, draw) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t;
  }

  // a tube along a smooth curve whose radius changes from r0 to r1 (straps, spikes, lashes)
  function taper(pts, r0, r1, m, seg, pow) {
    var key = 'tp' + pts.map(function (p) { return p.toArray().map(function (v) { return v.toFixed(3); }).join(','); }).join(';') + r0.toFixed(4) + r1.toFixed(4) + (seg || 20) + (pow || 1);
    var g = geo(key, function () {
      var curve = new T.CatmullRomCurve3(pts), s = seg || 20, tg = new T.TubeGeometry(curve, s, 1, 12, false), pos = tg.attributes.position, p = V(), n = V();
      for (var i = 0; i <= s; i++) {
        var u = i / s, c = curve.getPointAt(u), r = r0 + (r1 - r0) * Math.pow(u, pow || 1);
        for (var j = 0; j <= 12; j++) { var k = i * 13 + j; p.fromBufferAttribute(pos, k); n.subVectors(p, c); p.copy(c).addScaledVector(n, r); pos.setXYZ(k, p.x, p.y, p.z); }
      }
      tg.computeVertexNormals(); return tg;
    });
    return mesh(g, m);
  }
  // a flat lock of hair: wide, thin, with soft ridges along it; out = the direction the lock's back faces (away from the head)
  function lock(pts, w0, w1, th, m, ridges, center) {
    center = center || V(0, 0, 0);
    var key = 'lk' + pts.map(function (p) { return p.toArray().map(function (v) { return v.toFixed(3); }).join(','); }).join(';') + [w0, w1, th, ridges].join(',') + center.toArray().join(',');
    var g = geo(key, function () {
      var curve = new T.CatmullRomCurve3(pts, false, 'centripetal'), S = 40, K = 24, P = [], idx = [], c, t, out = V(), b = V(), nn = V();
      for (var i = 0; i <= S; i++) {
        var u = i / S; c = curve.getPointAt(u); t = curve.getTangentAt(u);
        out.set(c.x - center.x, 0, c.z - center.z); if (out.lengthSq() < 1e-6) out.set(0, 0, -1); out.normalize();
        b.crossVectors(t, out).normalize(); nn.crossVectors(b, t).normalize();
        var w = (w0 + (w1 - w0) * u) * (u < .12 ? .55 + .45 * Math.sin(u / .12 * PI / 2) : 1) * (u > .8 ? Math.cos((u - .8) / .2 * PI / 2 * .85) : 1);
        var h = th * (u > .85 ? 1 - (u - .85) / .15 * .7 : 1);
        for (var j = 0; j < K; j++) {
          var a = j / K * PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          var rid = 1 + (ridges ? .28 * Math.pow(Math.abs(Math.cos(a * ridges)), 2) : 0);
          P.push(c.x + b.x * w * ca + nn.x * h * sa * rid, c.y + b.y * w * ca + nn.y * h * sa * rid, c.z + b.z * w * ca + nn.z * h * sa * rid);
        }
      }
      for (i = 0; i < S; i++) for (var j2 = 0; j2 < K; j2++) {
        var a0 = i * K + j2, a1 = i * K + (j2 + 1) % K, b0 = a0 + K, b1 = a1 + K; idx.push(a0, b0, a1, a1, b0, b1);
      }
      var bg = new T.BufferGeometry(); bg.setAttribute('position', new T.Float32BufferAttribute(P, 3)); bg.setIndex(idx); bg.computeVertexNormals(); return bg;
    });
    return mesh(g, m);
  }
  function lathe(prof, m, key, seg, phiS, phiL) {
    var g = geo('la' + key + (seg || 48) + (phiS || 0) + (phiL || 0), function () { return new T.LatheGeometry(prof.map(function (p) { return new T.Vector2(p[0], p[1]); }), seg || 48, phiS || 0, phiL || PI * 2); });
    var x = mesh(g, m); return x;
  }

  // ---------- proportions ----------
  var AGES = {
    kid: { R: .41, leg: .4, legR: .08, torso: .4, sh: .19, hip: .16, up: .17, lo: .16, armR: .06, neck: .045, eye: .3, shoe: 1.12 },
    teen: { R: .37, leg: .6, legR: .07, torso: .47, sh: .2, hip: .15, up: .22, lo: .2, armR: .055, neck: .07, eye: .28, shoe: 1 },
    adult: { R: .36, leg: .76, legR: .074, torso: .55, sh: .215, hip: .16, up: .26, lo: .24, armR: .058, neck: .09, eye: .27, shoe: 1 }
  };
  var BUILDS = { slim: .88, normal: 1, strong: 1.16 };

  // ---------- the head: one sphere, softly reshaped into a cute face ----------
  function deform(x, y, z, face) {
    var chin = face === 'square' ? .1 : face === 'oval' ? .2 : .2, front = sstep(-.3, .5, z);
    if (y < 0) {
      var t = -y;
      x *= 1 - chin * Math.pow(t, 2.2) * (.4 + .6 * front);
      z *= 1 - .08 * t * t;
      if (face === 'oval') y *= 1.08;
    }
    var cheek = Math.exp(-Math.pow((y + .38) / .3, 2)) * front;
    x *= 1 + .05 * cheek; z *= 1 + .03 * cheek;
    if (y > 0) { z *= 1 + .04 * y; }
    return V(x, y, z * .96);
  }
  function headGeo(face) {
    return geo('head' + face, function () {
      var g = new T.SphereGeometry(1, 96, 72), p = g.attributes.position, uv = g.attributes.uv, v = V();
      for (var i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        var d = deform(v.x, v.y, v.z, face);
        // planar UV from the front for the painted face; the back maps onto plain skin at the canvas edge
        if (v.z > 0) uv.setXY(i, .5 + v.x * .5, .5 + v.y * .5); else uv.setXY(i, v.x < 0 ? 0 : 1, 0);
        p.setXYZ(i, d.x, d.y, d.z);
      }
      g.computeVertexNormals(); return g;
    });
  }
  // a point on the face surface (unit head) and its outward normal
  function surf(x, y, face, out) {
    var z = Math.sqrt(Math.max(0, 1 - x * x - y * y)), p = deform(x, y, z, face);
    var q = deform(x * 1.01, y * 1.01, z * 1.01, face); if (out) out.copy(V(x, y, z).normalize());
    return p;
  }

  // ---------- painted face: brows, mouth, blush, freckles, beard ----------
  function faceTex(o, mouth) {
    var key = ['face', o.skin, o.lips, o.brows, o.hairColor, o.hair, o.freckles, o.beard, o.age, mouth].join('|');
    if (TC[key]) return TC[key];
    faceKeys.push(key);
    if (faceKeys.length > 40) { var old = faceKeys.shift(); if (TC[old]) { TC[old].dispose(); delete TC[old]; } }
    var S = 768;
    return TC[key] = canvasTex(S, S, function (g) {
      function X(x) { return (.5 + x * .5) * S; }
      function Y(y) { return (.5 - y * .5) * S; }
      g.fillStyle = o.skin; g.fillRect(0, 0, S, S);
      g.lineCap = 'round'; g.lineJoin = 'round';
      var kid = o.age === 'kid';
      // blush
      [-1, 1].forEach(function (d) {
        var gr = g.createRadialGradient(X(d * .5), Y(-.36), 0, X(d * .5), Y(-.36), S * .1);
        gr.addColorStop(0, 'rgba(255,105,120,' + (kid ? .5 : .38) + ')'); gr.addColorStop(1, 'rgba(255,105,120,0)'); g.fillStyle = gr;
        g.beginPath(); g.ellipse(X(d * .5), Y(-.36), S * .1, S * .075, 0, 0, 7); g.fill();
      });
      if (o.freckles) {
        g.fillStyle = shade(o.skin, -.35);
        [[.38, -.24], [.46, -.3], [.55, -.25], [.43, -.37], [.6, -.33], [.5, -.2]].forEach(function (p) { [-1, 1].forEach(function (d) { g.beginPath(); g.arc(X(d * p[0]), Y(p[1]), S * .0055, 0, 7); g.fill(); }); });
      }
      // beard / stubble
      var fun = ['#ff5c8a', '#3d7bf5', '#8e6cef', '#e3262f', '#2ec4b6'].indexOf(o.hairColor) >= 0;
      var bc = fun ? '#3a2a20' : o.hairColor;
      if (o.beard !== 'none' && !kid) {
        g.save();
        if (o.beard === 'stubble' || o.beard === 'full' || o.beard === 'goatee') {
          g.globalAlpha = o.beard === 'stubble' ? .22 : .9; g.fillStyle = bc;
          g.beginPath();
          if (o.beard === 'goatee') { g.ellipse(X(0), Y(-.82), S * .1, S * .11, 0, 0, 7); }
          else { g.moveTo(X(-.86), Y(-.1)); g.quadraticCurveTo(X(-.8), Y(-1.02), X(0), Y(-1.04)); g.quadraticCurveTo(X(.8), Y(-1.02), X(.86), Y(-.1)); g.lineTo(X(.7), Y(-.12)); g.quadraticCurveTo(X(.6), Y(-.62), X(0), Y(-.66)); g.quadraticCurveTo(X(-.6), Y(-.62), X(-.7), Y(-.12)); g.closePath(); }
          g.fill();
        }
        if (o.beard === 'mustache' || o.beard === 'full' || o.beard === 'goatee') {
          g.globalAlpha = .95; g.fillStyle = bc; g.beginPath();
          g.moveTo(X(-.27), Y(-.47)); g.quadraticCurveTo(X(-.16), Y(-.36), X(0), Y(-.39)); g.quadraticCurveTo(X(.16), Y(-.36), X(.27), Y(-.47)); g.quadraticCurveTo(X(.12), Y(-.43), X(0), Y(-.44)); g.quadraticCurveTo(X(-.12), Y(-.43), X(-.27), Y(-.47)); g.fill();
        }
        g.restore();
      }
      // brows
      var browC = o.hair === 'bald' ? shade(o.skin, -.4) : fun ? '#3a2a20' : shade(o.hairColor, col(o.hairColor).getHSL({}).l > .6 ? -.35 : -.1);
      var bw = { normal: .03, thin: .018, thick: .05, arched: .03 }[o.brows] || .03, arch = o.brows === 'arched' ? .08 : .045;
      var by = mouth === 'wait' ? .44 : .4;
      g.strokeStyle = browC;
      [-1, 1].forEach(function (d) {
        for (var k = 0; k < 6; k++) { // a soft brush stroke: thick near the nose, thin at the end
          var u0 = k / 6, u1 = (k + 1) / 6;
          g.lineWidth = S * bw * (1.05 - .55 * u0);
          g.beginPath();
          var bx = function (u) { return X(d * (.15 + .43 * u)); }, byy = function (u) { return Y(by + arch * Math.sin(u * PI * .9) - .04 * u); };
          g.moveTo(bx(u0), byy(u0)); g.lineTo(bx(u1), byy(u1)); g.stroke();
        }
      });
      // mouth
      var lip = o.lips || mixc(o.skin, '#d8566a', .55), line = shade(lip, -.35);
      if (mouth === 'open') {
        var y0 = -.47, w = kid ? .27 : .25;
        var path = function () {
          g.beginPath(); g.moveTo(X(-w), Y(y0 + .03));
          g.quadraticCurveTo(X(0), Y(y0 - .05), X(w), Y(y0 + .03));
          g.bezierCurveTo(X(w * .8), Y(y0 - .26), X(-w * .8), Y(y0 - .26), X(-w), Y(y0 + .03)); g.closePath();
        };
        g.save(); path(); g.fillStyle = '#5a1420'; g.fill(); g.clip();
        g.fillStyle = '#fffaf6'; g.beginPath(); g.moveTo(X(-w), Y(y0 + .03)); g.quadraticCurveTo(X(0), Y(y0 - .05), X(w), Y(y0 + .03)); g.lineTo(X(w), Y(y0 - .02)); g.quadraticCurveTo(X(0), Y(y0 - .12), X(-w), Y(y0 - .02)); g.fill();
        g.fillStyle = '#ef7d8c'; g.beginPath(); g.ellipse(X(0), Y(y0 - .22), S * w * .3, S * .05, 0, 0, 7); g.fill();
        g.restore();
        path(); g.lineWidth = S * .012; g.strokeStyle = line; g.stroke();
        g.globalAlpha = .55; g.strokeStyle = lip; g.lineWidth = S * .02; g.beginPath(); g.moveTo(X(-w * .5), Y(y0 - .22)); g.quadraticCurveTo(X(0), Y(y0 - .27), X(w * .5), Y(y0 - .22)); g.stroke(); g.globalAlpha = 1;
        [-1, 1].forEach(function (d) { g.lineWidth = S * .008; g.strokeStyle = shade(o.skin, -.25); g.beginPath(); g.arc(X(d * (w + .03)), Y(y0 + .01), S * .02, d > 0 ? -1 : 2.2, d > 0 ? 1 : 4.2); g.stroke(); });
      } else if (mouth === 'wait') {
        g.fillStyle = '#5a1420'; g.beginPath(); g.ellipse(X(0), Y(-.5), S * .035, S * .04, 0, 0, 7); g.fill();
        g.lineWidth = S * .01; g.strokeStyle = line; g.stroke();
      } else {
        g.globalAlpha = .7; g.fillStyle = lip; g.beginPath(); g.ellipse(X(0), Y(-.54), S * .05, S * .018, 0, 0, 7); g.fill(); g.globalAlpha = 1;
        g.strokeStyle = line; g.lineWidth = S * .014; g.beginPath(); g.moveTo(X(-.15), Y(-.45)); g.quadraticCurveTo(X(0), Y(-.55), X(.15), Y(-.45)); g.stroke();
      }
    });
  }

  // iris painted around the eyeball's front pole (sphere UV rows = distance from the pole)
  function irisTex(c) {
    var key = 'iris' + c;
    if (TC[key]) return TC[key];
    return TC[key] = canvasTex(256, 512, function (g, w, h) {
      var IR = .2 * h, PU = .1 * h;
      g.fillStyle = '#fbf9f7'; g.fillRect(0, 0, w, h);
      var gr = g.createLinearGradient(0, 0, 0, IR);
      gr.addColorStop(0, '#060404'); gr.addColorStop(PU / IR - .02, '#060404'); gr.addColorStop(PU / IR + .02, shade(c, .15));
      gr.addColorStop(.7, c); gr.addColorStop(.93, shade(c, -.5)); gr.addColorStop(1, '#1a100c');
      g.fillStyle = gr; g.fillRect(0, 0, w, IR);
      g.globalAlpha = .22; g.fillStyle = shade(c, .55);
      for (var i = 0; i < 40; i++) g.fillRect(i / 40 * w, PU + 4, 2, IR - PU - 12);
      g.globalAlpha = 1;
      var g2 = g.createLinearGradient(0, IR, 0, IR + .05 * h); g2.addColorStop(0, 'rgba(120,100,100,.25)'); g2.addColorStop(1, 'rgba(120,100,100,0)'); g.fillStyle = g2; g.fillRect(0, IR, w, .05 * h);
    });
  }

  // ---------- hair ----------
  // hairline in unit head coords: hair covers a point when y > hl
  var HAIR = {
    short: { f: .52, c: .5, b: -.62, th: .1, ear: 1 }, side: { f: .5, c: .45, b: -.62, th: .1, ear: 1 }, buzz: { f: .55, c: .5, b: -.62, th: .035, ear: 1 },
    spiky: { f: .52, c: .5, b: -.62, th: .08, ear: 1 }, curly: { f: .5, c: .5, b: -.6, th: .14, ear: 1 }, afro: { f: .5, c: .45, b: -.55, th: .5, ear: 1 },
    long: { f: .48, c: .6, b: -.75, th: .08 }, wavy: { f: .48, c: .6, b: -.75, th: .09 }, bob: { f: .5, c: .6, b: -.75, th: .09 },
    ponytail: { f: .5, c: .55, b: -.6, th: .045, ear: 1 }, bun: { f: .5, c: .55, b: -.6, th: .045, ear: 1 }, pigtails: { f: .5, c: .55, b: -.6, th: .05, ear: 1 },
    mohawk: { f: .55, c: .5, b: -.62, th: .025, ear: 1 }, balding: { f: .55, c: .5, b: -.62, th: .04, ear: 1, top: .62 }, bald: null
  };
  function capGeo(style, face) {
    var H = HAIR[style];
    return geo('cap' + style + face, function () {
      var g = new T.SphereGeometry(1, 128, 96), p = g.attributes.position, v = V();
      for (var i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        var x = v.x, y = v.y, z = v.z, w = sstep(.35, -.25, z), front = H.f - H.c * x * x;
        if (H.ear) front = Math.max(front, .25 - .8 * (1 - Math.abs(x)) * 0); // keep the ears out
        var hl = front * (1 - w) + H.b * w;
        if (H.ear) hl = Math.max(hl, .05 * Math.exp(-Math.pow(z / .35, 2)) * sstep(.75, .95, Math.abs(x)) - .02);
        var s = sstep(-.05, .07, y - hl);
        if (H.top) s *= 1 - sstep(H.top - .1, H.top + .05, y) * sstep(-.6, .1, z) * .98;
        var groove = 0;
        if (H.th > .03) {
          var ang = Math.atan2(x, -z);
          groove = .018 * Math.sin(ang * 28 + Math.sin(y * 6) * .8) * s * sstep(.2, -.2, y - .95);
          if (style === 'long' || style === 'wavy' || style === 'bob') groove -= .035 * Math.exp(-Math.pow(x / .05, 2)) * sstep(.3, .6, z) * sstep(.5, .8, y);
        }
        if (style === 'afro' || style === 'curly') groove = H.th * .08 * Math.sin(x * 19) * Math.sin(y * 17) * Math.sin(z * 21) * s;
        var r = .96 + (H.th + .02) * s + groove, d = deform(x, y, z, face);
        // afro: lift the volume upwards a bit
        if (style === 'afro') { d.y += .22 * s * sstep(-.6, .9, y); r -= (H.th) * s * .45 * sstep(.2, -.6, y); }
        p.setXYZ(i, d.x * r, d.y * r, d.z * r);
      }
      g.computeVertexNormals(); return g;
    });
  }
  function hairOf(o, A, hm, R, shY) {
    var G = new T.Group(), st = o.hair, H = HAIR[st];
    if (!H) return G;
    var cap = mesh(capGeo(st, o.face), hm); cap.scale.setScalar(R); G.add(cap);
    var kid = o.age === 'kid', C = V(0, 0, 0);
    function P(rr, y, a) { return V(Math.sin(a) * rr * R, y * R, Math.cos(a) * rr * R); }
    if (st === 'long' || st === 'wavy' || st === 'bob') {
      var bob = st === 'bob', wav = st === 'wavy' ? 1 : st === 'long' ? .35 : .2;
      var len = bob ? 0 : kid ? .7 : 1.6; // below the shoulders, in head radii
      var sy = shY / R;
      for (var i = 0; i < 16; i++) {
        var side = i < 8 ? -1 : 1, k = i % 8, a = side * (PI * .36 + k / 7 * PI * .64), fr = Math.abs(a) < PI * .62;
        var pts = [P(.86, .62 - .1 * (k / 7), a), P(1.1, .1, a), P(1.12, -.45, a * (bob ? 1 : .98))];
        if (bob) {
          pts.push(P(1.05, -.85, a), P(.9, -.98, a * .97));
        } else {
          var sx = Math.sin(a), cz = Math.cos(a);
          var bx = side * (fr ? .62 : Math.abs(sx) * .7 + .1), bz = fr ? .25 + .1 * cz : -.42 + cz * .25;
          pts.push(V(bx * R + side * .04, (sy + .25) * R, bz * R));
          for (var s2 = 1; s2 <= 3; s2++) {
            var yy = sy + .25 - len * s2 / 3, wv = wav * .12 * Math.sin(s2 * 2.1 + k) * (s2 / 3);
            pts.push(V((bx + side * wv + (s2 === 3 ? side * wav * .14 : 0)) * R, yy * R, (bz + (fr ? .05 : -.06) * s2 / 3) * R));
          }
        }
        G.add(lock(pts, .2 * R, bob ? .17 * R : .13 * R, .085 * R, hm, 3, C));
      }
      // face-framing locks from the middle part
      [-1, 1].forEach(function (d) {
        var fp = [V(d * .04 * R, 1.02 * R, .25 * R), V(d * .45 * R, .92 * R, .62 * R), V(d * .9 * R, .42 * R, .5 * R), V(d * 1.04 * R, -.25 * R, .3 * R)];
        if (bob) fp.push(V(d * .96 * R, -.82 * R, .22 * R), V(d * .82 * R, -.95 * R, .18 * R));
        else {
          fp.push(V(d * .95 * R, -.85 * R, .26 * R), V(d * .62 * R, (sy + .2) * R, .32 * R));
          for (var s3 = 1; s3 <= 3; s3++) fp.push(V(d * (.6 + wav * .1 * Math.sin(s3 * 2.3)) * R, (sy + .2 - len * .85 * s3 / 3) * R, (.34 + .02 * s3) * R));
        }
        G.add(lock(fp, .17 * R, .14 * R, .1 * R, hm, 3, C));
      });
      if (kid && bob) for (var b = -2; b <= 2; b++) G.add(lock([V(b * .16 * R, .98 * R, .3 * R), V(b * .2 * R, .82 * R, .78 * R), V(b * .22 * R, .5 * R, .96 * R)], .16 * R, .12 * R, .07 * R, hm, 2, V(0, .3 * R, 0)));
    }
    if (st === 'short' || st === 'side' || st === 'spiky' || st === 'mohawk') {
      if (st === 'short' || st === 'side') {
        var n = st === 'side' ? 5 : 6;
        for (var f = 0; f < n; f++) {
          var u = f / (n - 1) - .5, x0 = u * .9;
          var lp = st === 'side'
            ? [V((x0 - .15) * R, 1.0 * R, .05 * R), V((x0 + .1) * R, 1.0 * R, .5 * R), V((x0 + .45) * R, .78 * R, .78 * R), V((x0 + .75) * R, .6 * R, .8 * R)]
            : [V(x0 * R, 1.02 * R, -.15 * R), V(x0 * 1.05 * R, 1.04 * R, .35 * R), V((x0 * 1.1 + .06) * R, .86 * R, .78 * R), V((x0 * 1.1 + .16) * R, .74 * R, .92 * R)];
          G.add(lock(lp, .22 * R, .12 * R, .07 * R, hm, 2, V(0, .2 * R, 0)));
        }
      } else {
        var spikes = st === 'mohawk' ? 7 : 10;
        for (var q = 0; q < spikes; q++) {
          var a2, el;
          if (st === 'mohawk') { a2 = 0; el = -.9 + q / (spikes - 1) * 1.6; } else { a2 = (q % 5 - 2) * .42; el = q < 5 ? .55 : -.15; }
          var base = V(Math.sin(a2) * Math.cos(el), Math.cos(a2) * Math.cos(el) * .9 + .1, Math.sin(el) * 1).normalize();
          var tip = base.clone().multiplyScalar(st === 'mohawk' ? 1.45 : 1.4).add(V(0, .18, -.05));
          G.add(taper([base.clone().multiplyScalar(.95 * R), base.clone().multiplyScalar(1.15 * R).add(V(0, .05 * R, 0)), tip.multiplyScalar(R)], .2 * R, .015 * R, hm, 16, .8));
        }
      }
    }
    if (st === 'curly') {
      for (var c = 0; c < 46; c++) {
        var ph = c * 2.399, yy2 = 1 - (c + .5) / 46 * 1.35, rr2 = Math.sqrt(Math.max(0, 1 - yy2 * yy2));
        var dir = V(Math.sin(ph) * rr2, yy2, Math.cos(ph) * rr2);
        var hl2 = (.5 - .5 * dir.x * dir.x) * (1 - sstep(.35, -.25, dir.z)) + -.55 * sstep(.35, -.25, dir.z);
        if (dir.y < hl2 + .08) continue;
        var bsz = (.2 + .05 * Math.sin(c * 3.7)) * R;
        var cb = sphere(bsz, hm, 1, 1, 1, 24); cb.position.copy(dir.multiplyScalar(1.08 * R)); G.add(cb);
      }
    }
    if (st === 'ponytail') {
      var pt = mesh(geo('tor'), mat('gloss', '#e3262f')); pt.position.set(0, .55 * R, -.92 * R); pt.scale.setScalar(.1 * R); pt.rotation.x = .6; G.add(pt);
      G.add(lock([V(0, .6 * R, -.9 * R), V(0, .5 * R, -1.25 * R), V(0, -.1 * R, -1.3 * R), V(.08 * R, -.7 * R, -1.15 * R), V(-.05 * R, -1.15 * R, -1.1 * R), V(.12 * R, -1.45 * R, -1.15 * R)], .2 * R, .1 * R, .14 * R, hm, 3, V(0, 0, -.6 * R)));
    }
    if (st === 'pigtails') {
      [-1, 1].forEach(function (d) {
        var tor = mesh(geo('tor'), mat('gloss', '#e3262f')); tor.scale.setScalar(.09 * R); tor.position.set(d * .92 * R, .35 * R, -.25 * R); tor.rotation.y = PI / 2; tor.rotation.x = .4 * d; G.add(tor);
        if (kid) { // low pigtails with soft wavy ends, like a cute doll
          tor.position.set(d * .9 * R, -.18 * R, -.42 * R); tor.rotation.set(.3, PI / 2, -d * .5); tor.scale.setScalar(.085 * R);
          G.add(lock([V(d * .7 * R, .45 * R, -.6 * R), V(d * .92 * R, -.12 * R, -.45 * R), V(d * 1.12 * R, -.42 * R, -.42 * R), V(d * 1.2 * R, -.8 * R, -.32 * R), V(d * 1.08 * R, -1.12 * R, -.22 * R), V(d * 1.18 * R, -1.32 * R, -.18 * R)], .19 * R, .12 * R, .15 * R, hm, 3, V(d * .9 * R, -.4 * R, -.4 * R)));
          G.add(lock([V(d * .95 * R, -.2 * R, -.45 * R), V(d * 1.25 * R, -.5 * R, -.5 * R), V(d * 1.3 * R, -.9 * R, -.4 * R), V(d * 1.22 * R, -1.2 * R, -.3 * R)], .15 * R, .08 * R, .12 * R, hm, 2, V(d * .9 * R, -.4 * R, -.6 * R)));
          // a loose strand in front of the ear
          G.add(lock([V(d * .8 * R, .5 * R, .4 * R), V(d * .98 * R, .05 * R, .38 * R), V(d * 1.02 * R, -.35 * R, .3 * R), V(d * .95 * R, -.62 * R, .32 * R)], .09 * R, .05 * R, .05 * R, hm, 2, V(0, 0, 0)));
        }
        else G.add(lock([V(d * .9 * R, .4 * R, -.25 * R), V(d * 1.2 * R, .3 * R, -.3 * R), V(d * 1.3 * R, -.3 * R, -.25 * R), V(d * 1.18 * R, -.9 * R, -.15 * R), V(d * 1.25 * R, -1.3 * R, -.1 * R)], .18 * R, .09 * R, .13 * R, hm, 3, V(d * .9 * R, 0, -.25 * R)));
      });
    }
    if (kid && st === 'pigtails') for (var bb2 = -3; bb2 <= 3; bb2++) { var bx2 = bb2 * .15 * R; G.add(lock([V(bx2 * .5, 1.03 * R, -.1 * R), V(bx2 * .85, .93 * R, .55 * R), V(bx2 * 1.02, .66 * R, .84 * R), V(bx2 * 1.06 + (bb2 % 2) * .02 * R, .47 * R, .93 * R)], .21 * R, .15 * R, .05 * R, hm, 2, V(0, .3 * R, -.4 * R))); }
    if (st === 'bun') {
      var bun = mesh(capGeo('curly', 'round'), hm); bun.scale.setScalar(.36 * R); bun.position.set(0, 1.0 * R, -.3 * R); G.add(bun);
      var tb = mesh(geo('tor', function () { return new T.TorusGeometry(1, .35, 12, 24); }), mat('gloss', '#e3262f')); tb.scale.setScalar(.2 * R); tb.position.set(0, .86 * R, -.25 * R); tb.rotation.x = PI / 2 - .5; G.add(tb);
    }
    return G;
  }

  // ---------- body pieces ----------
  var LONG = { hoodie: 1, sweater: 1, jacket: 1, sport: 1, puffer: 1, suit: 1 };
  function torsoProf(H, sh, hip, kid, puff) {
    var p = [[0, -.07], [hip * .92, -.07], [hip * 1.02, 0], [hip * 1.0, H * .18], [hip * (kid ? 1 : .9), H * .42], [sh * (kid ? .98 : .92), H * .72], [sh * 1.0, H * .86], [sh * .9, H * .96], [sh * .55, H * 1.01], [.1, H * 1.03], [0, H * 1.03]];
    if (puff) p = p.map(function (q) { return [q[0] ? q[0] + puff : 0, q[1]]; });
    return p;
  }

  // ---------- moves: every move returns joint angles; the hero blends smoothly between them ----------
  var KEYS = ['bx', 'by', 'bz', 'brx', 'bry', 'brz', 'yaw', 'yx', 'spx', 'spy', 'spz', 'hx', 'hy', 'hz', 'lsx', 'lsy', 'lsz', 'lex', 'ley', 'lez', 'rsx', 'rsy', 'rsz', 'rex', 'rey', 'rez', 'lhx', 'lhy', 'lhz', 'lk', 'la', 'rhx', 'rhy', 'rhz', 'rk', 'ra'];
  function base() { var p = {}; KEYS.forEach(function (k) { p[k] = 0; }); p.lsz = -.14; p.rsz = .14; p.lez = -.12; p.rez = .12; return p; }
  function bend(p, a, M) { p.lhx = p.rhx = -a; p.lk = p.rk = 2 * a; p.la = p.ra = -a; p.by -= 2 * M.hL * (1 - Math.cos(a)); }
  function lerpP(a, b, k) { var r = {}; for (var q in a) r[q] = a[q] + (b[q] - a[q]) * k; return r; }
  function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function danceSeg(i, b, M) {
    var p = base(), bb = b % 8, s = Math.sin(PI * b / 2);
    bend(p, .16 * (.5 + .5 * Math.cos(2 * PI * b)), M);
    if (i === 0) { // arms up, swaying
      p.rsz = 2.05 + .22 * s; p.lsz = -2.05 + .22 * s; p.rsx = p.lsx = -.25; p.rez = .3; p.lez = -.3; p.spz = .12 * s; p.hz = .15 * s; p.bx = .04 * s; p.brz = -.03 * s;
    } else if (i === 1) { // disco point, left and right
      var side = Math.floor(b / 2) % 2 ? 1 : -1, e = ease((b % 2) / .35);
      var up = 2.15, hipS = .75, hipE = 1.8;
      if (side > 0) { p.rsz = .14 + (up - .14) * e; p.rsx = -.35 * e; p.rez = 0; p.lsz = -hipS; p.lez = hipE; }
      else { p.lsz = -.14 - (up - .14) * e; p.lsx = -.35 * e; p.lez = 0; p.rsz = hipS; p.rez = -hipE; }
      p.hz = side * .12; p.hy = side * .25; p.spz = -side * .08; p.brz = side * .04;
      if (side > 0) { p.lhx -= .25; p.lk += .45; } else { p.rhx -= .25; p.rk += .45; }
    } else if (i === 2) { // side steps and claps
      var lift = Math.pow(Math.max(0, Math.sin(PI * b)), 1.5), which = Math.floor(b) % 2;
      p.bx = .1 * Math.sin(PI * b / 2);
      if (which) { p.lhx -= .55 * lift; p.lk += 1.1 * lift; } else { p.rhx -= .55 * lift; p.rk += 1.1 * lift; }
      var cl = Math.pow(Math.abs(Math.cos(PI * b)), 6);
      p.rsx = p.lsx = -1.25; p.rsz = .38 - .3 * cl; p.lsz = -.38 + .3 * cl; p.rex = p.lex = -.55; p.rez = p.lez = 0;
      p.hz = .1 * Math.sin(PI * b); p.spy = .12 * Math.sin(PI * b / 2);
    } else { // spin, then shoulder shimmy with hands up
      if (bb < 2) { var e2 = ease(bb / 2); p.bry = 2 * PI * e2; p.rsz = 1.4; p.lsz = -1.4; p.rez = p.lez = 0; p.by += .05 * Math.sin(PI * e2); }
      else { var w = Math.sin(4 * PI * b); p.rsz = 2.0 + .22 * w; p.lsz = -2.0 + .22 * w; p.rez = -.7; p.lez = .7; p.spy = .18 * Math.sin(2 * PI * b); p.hz = .1 * w; p.spz = .05 * w; }
    }
    return p;
  }
  var MOVES = {
    pose: function () { var p = base(); p.rsz = .32; p.lsz = -.32; p.rez = .2; p.lez = -.2; return p; },
    sleep: function (t) { var p = base(); p.hx = .22; p.hz = .14 + Math.sin(t * .8) * .03; p.brz = Math.sin(t * .8) * .015; return p; },
    stretch: function (t) {
      var p = base(), s = Math.sin(t * 1.6);
      p.rsz = 2.2; p.lsz = -2.2; p.rsx = p.lsx = -.2; p.rez = .3; p.lez = -.3; p.spz = .16 * s; p.hz = .1 * s; p.hx = -.05; return p;
    },
    still: function (t) {
      var p = base(), s = Math.sin(t * 2.1) * .03; p.rsz = .14 + s; p.lsz = -.14 - s; p.hz = Math.sin(t * 1.3) * .05; p.hx = -.04; return p;
    },
    wave: function (t, M, hop) {
      var p = base(); p.hx = -.04 + Math.sin(t * 3) * .03; p.hy = Math.sin(t * 1.4) * .12; p.hz = Math.sin(t * 2.6) * .07;
      p.rsz = 1.95 + Math.sin(t * 7) * .15; p.rsx = -.3; p.rez = .05 + Math.sin(t * 7 + 1) * .4; p.lsz = -.55 - Math.sin(t * 3.4) * .15; p.lez = -.6;
      if (hop) p.by = Math.pow(Math.max(0, Math.sin(t * 3.4)), 2) * .07;
      return p;
    },
    dance: function (t, M) {
      var b = t * 2, seg = Math.floor(b / 8) % 4, bb = b % 8, p = danceSeg(seg, b, M);
      if (bb < .6) p = lerpP(danceSeg((seg + 3) % 4, b, M), p, ease(bb / .6));
      return p;
    },
    run: function (t, M) {
      var p = base(), ph = t * 2 * PI * 1.45, s = Math.sin(ph);
      p.lhx = -.8 * s - .1; p.rhx = .8 * s - .1;
      p.lk = .45 + .95 * Math.max(0, -s); p.rk = .45 + .95 * Math.max(0, s);
      p.la = -.2; p.ra = -.2;
      p.by = -.04 + .06 * Math.abs(Math.cos(ph));
      p.rsx = -.9 * s; p.lsx = .9 * s; p.rex = p.lex = -1.5; p.rsz = .2; p.lsz = -.2; p.rez = p.lez = 0;
      p.spx = .14; p.hx = -.1; p.spy = .1 * s; return p;
    },
    squat: function (t, M) {
      var p = base(), u = (1 - Math.cos(2 * PI * t / 2.2)) / 2, a = 1.1 * u;
      bend(p, a, M); p.spx = .5 * u; p.hx = -.42 * u;
      p.rsx = p.lsx = -1.45 * u - .05; p.rsz = .14 * (1 - u) + .06; p.lsz = -p.rsz; p.rez = p.lez = 0; return p;
    },
    pushup: function (t, M) {
      var p = base(), c = (1 - Math.cos(2 * PI * t / 1.8)) / 2, beta = .15 + 1.25 * c;
      var arm = Math.sqrt(M.up * M.up + M.lo * M.lo + 2 * M.up * M.lo * Math.cos(beta)), reach = arm + M.hand;
      var th = Math.acos(clamp(reach / M.shH, 0, 1)), a1 = Math.acos(clamp((M.up * M.up + arm * arm - M.lo * M.lo) / (2 * M.up * arm), -1, 1));
      p.yaw = PI / 2 * .92; p.yx = -M.shH * .42; p.brx = th;
      p.rsx = p.lsx = -th + a1; p.rex = p.lex = -beta; p.rsz = .12; p.lsz = -.12; p.rez = p.lez = 0;
      p.hx = -.75; p.la = p.ra = .55; return p;
    }
  };

  function build(o) {
    if (root.avNormalize) o = root.avNormalize(o);
    // ready-made models (a sculpted girl from an FBX) build themselves
    if (o.model && root.Hero3DModels && root.Hero3DModels[o.model]) return root.Hero3DModels[o.model](o);
    var A = AGES[o.age] || AGES.adult, B = BUILDS[o.build] || 1, kid = o.age === 'kid';
    var R = A.R, legL = A.leg, sh = A.sh * B, hip = A.hip * B, legR = A.legR * (B > 1 ? 1.08 : B < 1 ? .92 : 1), armR = A.armR * (B > 1 ? 1.12 : B < 1 ? .92 : 1);
    var root2 = new T.Group(), yawG = new T.Group(), body = new T.Group(); root2.add(yawG); yawG.add(body);
    var skin = mat('skin', o.skin);
    var top = o.top, bot = o.bottom, dress = top === 'dress', overalls = top === 'overalls';
    var topC = o.topColor, botC = overalls ? o.topColor : o.bottomColor;
    var botKind = (bot === 'jeans' || overalls) ? 'denim' : 'cloth';
    var topM = mat(top === 'jacket' && false ? 'leather' : 'cloth', topC);
    var tee = overalls ? '#ffffff' : topC, teeM = mat('cloth', tee);
    var botM = mat(botKind, botC);
    var soleY = .05, hipY = soleY + .06 + legL, H = A.torso, shY = hipY + H * .88;
    // legs: hip -> knee -> ankle joints, so the hero can run, squat and dance
    var hL = legL / 2, rk = legR * .84, legs = [];
    var full = !(bot === 'shorts' || bot === 'skirt' || dress) || overalls, lk = bot === 'jeans' || overalls ? 1.12 : 1.18;
    var pv = new T.Group(); pv.position.y = hipY; body.add(pv);
    [-1, 1].forEach(function (d) {
      var hipJ = new T.Group(); hipJ.position.set(d * hip * .5, 0, 0); pv.add(hipJ);
      var knee = new T.Group(); knee.position.y = -hL; hipJ.add(knee);
      var ank = new T.Group(); ank.position.y = -hL; knee.add(ank);
      var thP = [[0, -hL - .01], [rk, -hL - .01], [legR * .92, -legL * .3], [legR * 1.02, -.05], [legR * 1.05, .04], [0, .06]];
      var shP = [[0, -hL - .02], [legR * .62, -hL - .02], [legR * .64, -legL * .82 + hL], [rk, -.01], [rk * .6, .01], [0, .015]];
      var lm = full ? botM : skin, f = full ? lk : 1;
      var sc = function (pr) { return pr.map(function (q) { return [q[0] * f, q[1]]; }); };
      hipJ.add(lathe(sc(thP), lm, 'th' + legL + legR + f, 24));
      knee.add(lathe(sc(shP), lm, 'sh' + legL + legR + f, 24));
      knee.add(sphere(rk * f * 1.0, lm, 1, 1, 1, 20));
      if (full) {
        if (bot === 'joggers' && !overalls) { var cf = mesh(geo('tor'), mat('cloth', shade(botC, -.15))); cf.rotation.x = PI / 2; cf.scale.set(legR * .58, legR * .58, legR * .58); cf.position.y = -hL + .03; knee.add(cf); }
        if (bot === 'jeans' || overalls) { var cuff = mesh(geo('cyl'), mat('denim', shade(botC, .12))); cuff.scale.set(legR * .78, .035, legR * .78); cuff.position.y = -hL + .03; knee.add(cuff); }
      } else if (bot === 'shorts' && !dress) {
        hipJ.add(lathe([[0, -legL * .42], [legR * 1.25, -legL * .42], [legR * 1.25, -legL * .2], [legR * 1.2, .05], [0, .07]], botM, 'shorts' + legL + legR, 24));
      }
      // shoe hangs from the ankle
      var sg = new T.Group(); sg.position.set(0, -(soleY + .06), .02); ank.add(sg);
      var ss = A.shoe * (legR / .074) * .95, sm = mat(o.shoes === 'boots' ? 'leather' : 'gloss', o.shoeColor);
      var toe = sphere(.1 * ss, sm, .9, .62, 1.55); toe.position.set(0, .075 * ss, .045 * ss); sg.add(toe);
      var sole = mesh(geo('cyl'), mat('gloss', o.shoes === 'boots' ? '#3a2a22' : '#f4f4f4'));
      sole.scale.set(.095 * ss, .045, .16 * ss); sole.position.set(0, .025, .045 * ss); sg.add(sole);
      if (o.shoes === 'high' || o.shoes === 'boots') { var hi = mesh(geo('cyl'), sm); hi.scale.set(legR * (o.shoes === 'boots' ? 1.0 : .95), o.shoes === 'boots' ? .2 : .13, legR * 1.0); hi.position.y = (o.shoes === 'boots' ? .17 : .13); sg.add(hi); }
      if (o.shoes === 'sneakers' || o.shoes === 'high') { var lace = sphere(.035 * ss, mat('cloth', o.shoeColor === '#ffffff' ? '#e3262f' : '#ffffff'), 1, .4, 1.2, 16); lace.position.set(0, .125 * ss, .07 * ss); lace.rotation.x = -.5; sg.add(lace); }
      legs.push({ h: hipJ, k: knee, a: ank, d: d });
    });
    // torso
    var tg = new T.Group(); pv.add(tg);
    var puff = top === 'puffer' ? .03 : 0;
    var tp = torsoProf(H, sh, hip, kid, puff);
    var torso = lathe(tp, dress ? topM : LONG[top] || top === 'tee' ? topM : teeM, 'torso' + [H, sh, hip, kid, puff].join(','), 64); torso.scale.z = .74; tg.add(torso);
    // lower part of the torso in the bottoms colour (unless a dress or a long top covers it)
    if (!dress && top !== 'puffer' && top !== 'suit') {
      var pel = [[0, -.075], [hip * 1.0, -.075], [hip * 1.06, 0], [hip * 1.04, H * .2], [0, H * .21]];
      var pm = lathe(pel, botM, 'pel' + H + hip, 48); pm.scale.z = .76; tg.add(pm);
      var hem = mesh(geo('ring'), (top === 'hoodie' || top === 'sweater' || top === 'jacket' || top === 'sport') ? mat('cloth', shade(topC, -.12)) : topM);
      hem.rotation.x = PI / 2; hem.scale.set(hip * 1.04, hip * 1.04 * .76, .25); hem.position.y = H * .22; tg.add(hem);
    }
    if (dress || bot === 'skirt') {
      var skC = dress ? topC : botC, skL = kid ? legL * .65 : legL * .48;
      var skirt = lathe([[hip * 1.02, .06], [hip * 1.1, 0], [hip * 1.5, -skL * .6], [hip * 1.75, -skL], [hip * 1.7, -skL - .015], [hip * 1.05, -.02]], mat('cloth', skC), 'skirt' + hip + skL, 48);
      skirt.scale.z = .85; skirt.position.y = H * .12; tg.add(skirt);
    }
    if (overalls) {
      var rAt = function (y) { for (var i = 1; i < tp.length; i++) if (tp[i][1] >= y) { var a0 = tp[i - 1], a1 = tp[i]; return a0[0] + (a1[0] - a0[0]) * (y - a0[1]) / Math.max(1e-6, a1[1] - a0[1]); } return 0; };
      var bib = lathe(tp.filter(function (q) { return q[1] <= H * .72; }).concat([[rAt(H * .74), H * .74], [0, H * .74]]), botM, 'bib' + [H, sh, hip, kid].join(','), 48, -PI * .27, PI * .54); bib.scale.set(1.06, 1, .82); tg.add(bib);
      var fz = function (y) { return rAt(y) * .82 + .006; };
      [-1, 1].forEach(function (d) {
        var strap = taper([V(d * hip * .55, H * .72, fz(H * .72) - .004), V(d * sh * .55, H * .9, fz(H * .9) * .9), V(d * sh * .5, H * 1.03, 0), V(d * sh * .52, H * .85, -fz(H * .85) * .95), V(d * hip * .5, H * .6, -fz(H * .6))], .02, .02, botM, 24); strap.scale.x = 1.4; tg.add(strap);
        var btn = sphere(.024, mat('metal', '#e9edf2'), 1, 1, .5, 16); btn.position.set(d * hip * .55, H * .69, fz(H * .69) + .004); tg.add(btn);
      });
      var pz = fz(H * .52);
      var pk = mesh(geo('box', function () { return new T.BoxGeometry(1, 1, 1, 1, 1, 1); }), mat('denim', shade(botC, -.08))); pk.scale.set(hip * .8, H * .18, .01); pk.position.set(0, H * .52, pz); tg.add(pk);
      var st2 = mesh(geo('box'), mat('cloth', '#e8b04a')); st2.scale.set(hip * .7, .005, .005); st2.position.set(0, H * .58, pz + .006); tg.add(st2);
      [-1, 1].forEach(function (d) { var sd = mesh(geo('box'), mat('cloth', '#e8b04a')); sd.scale.set(.005, H * .6, .005); sd.position.set(d * hip * .78, H * .42, fz(H * .42) - .012); sd.rotation.y = d * .5; tg.add(sd); });
    }
    if (top === 'hoodie') {
      var hood = mesh(geo('tor'), topM); hood.scale.set(sh * .62, sh * .5, .26); hood.rotation.x = PI / 2 - .35; hood.position.set(0, H * .99, -sh * .18); tg.add(hood);
      [-1, 1].forEach(function (d) { tg.add(taper([V(d * .045, H * .97, sh * .55), V(d * .05, H * .8, sh * .74), V(d * .045, H * .66, sh * .74)], .009, .009, mat('cloth', '#ffffff'), 8)); });
      var pocket = sphere(1, mat('cloth', shade(topC, -.08)), hip * .7, H * .12, .04, 24); pocket.position.set(0, H * .32, hip * .78); tg.add(pocket);
    }
    if (top === 'jacket' || top === 'sport' || top === 'suit') {
      var jc = top === 'suit' ? topC : topC, jm = mat(top === 'jacket' ? 'leather' : 'cloth', jc);
      var jtp = torsoProf(H, sh * 1.06, hip * 1.08, kid, 0);
      var jk = lathe(jtp, jm, 'jacket' + [H, sh, hip, kid].join(','), 64, .3, PI * 2 - .6); jk.scale.z = .8; jk.material = jm; tg.add(jk);
      jk.material.side = T.DoubleSide;
      var inner = top === 'suit' ? '#ffffff' : top === 'sport' ? shade(topC, .1) : '#f4f1ea';
      var shirt = lathe(tp, mat('cloth', inner), 'torso' + [H, sh, hip, kid, 0].join(','), 64); shirt.scale.z = .74; tg.remove(torso); tg.add(shirt);
      if (top === 'suit') { var tie = taper([V(0, H * .97, sh * .72), V(0, H * .7, sh * .82), V(0, H * .45, sh * .8)], .025, .045, mat('gloss', '#e3262f'), 10); tg.add(tie); }
      if (top === 'jacket' || top === 'sport') { var col2 = mesh(geo('tor'), mat('cloth', shade(jc, -.15))); col2.rotation.x = PI / 2; col2.scale.set(sh * .58, sh * .45, .2); col2.scale.z = .25; col2.position.y = H * .98; tg.add(col2); }
    }
    if (top === 'puffer') {
      var pp = [];
      for (var rq = 0; rq <= 40; rq++) { var yy = -.08 + rq / 40 * (H * .9 + .08), base = yy < 0 ? hip : yy < H * .42 ? hip + (sh * .95 - hip) * yy / (H * .42) * .3 : hip * .7 + sh * .3 + (sh - hip * .7 - sh * .3) * (yy - H * .42) / (H * .48); pp.push([base + .03 + .022 * Math.abs(Math.sin((yy + .08) / (H * .98) * PI * 4.5)), yy]); }
      pp.unshift([0, -.08]); pp.push([sh * .6, H * .97], [.11, H * 1.02], [0, H * 1.02]);
      var pf = lathe(pp, topM, 'puffer' + [H, sh, hip].join(','), 64); pf.scale.z = .8; tg.remove(torso); tg.add(pf);
      var pc = mesh(geo('tor'), topM); pc.rotation.x = PI / 2; pc.scale.set(.1, .09, .14); pc.position.y = H * 1.0; tg.add(pc);
    }
    if (top === 'sweater') { var neckR = mesh(geo('tor'), mat('cloth', shade(topC, -.12))); neckR.rotation.x = PI / 2; neckR.scale.set(.085, .07, .08); neckR.position.y = H * 1.01; tg.add(neckR); }
    if (top === 'tee' || overalls || dress) { var nl = mesh(geo('ring'), mat('cloth', shade(tee, -.1))); nl.rotation.x = PI / 2; nl.scale.set(.08, .066, .15); nl.position.y = H * 1.0; tg.add(nl); }
    // neck and arms
    var neck = mesh(geo('cyl'), skin); neck.scale.set(.065 * (kid ? 1.1 : 1), A.neck + .08, .062); neck.position.y = H * 1.0 + A.neck / 2; tg.add(neck);
    var arms = [];
    [-1, 1].forEach(function (d) {
      var s = new T.Group(); s.position.set(d * sh * .93, H * .87, 0); tg.add(s);
      var longS = LONG[top], sleeveM = top === 'jacket' ? mat('leather', topC) : longS || top === 'tee' ? topM : teeM;
      var shoulder = sphere(armR * 1.18 + puff, sleeveM, 1, 1, 1, 24); s.add(shoulder);
      var up = mesh(geo('caps', function () { return new T.CapsuleGeometry(1, 1, 8, 20); }), longS || !dress ? sleeveM : skin);
      var ur = armR * (longS ? 1.12 : 1) + puff;
      up.scale.set(ur, A.up / 2 + ur * 0, ur); up.position.y = -A.up / 2; s.add(up);
      if (!longS) { var sl = sphere(armR * 1.35, sleeveM, 1, 1.1, 1, 24); sl.position.y = -A.up * .32; s.add(sl); var arm2 = mesh(geo('caps'), skin); arm2.scale.set(armR * .9, A.up * .3, armR * .9); arm2.position.y = -A.up * .72; s.add(arm2); }
      var el = new T.Group(); el.position.y = -A.up; s.add(el);
      var lo = mesh(geo('caps'), longS ? sleeveM : skin), lr = longS ? ur * .95 : armR * .88;
      lo.scale.set(lr, A.lo / 2, lr); lo.position.y = -A.lo / 2; el.add(lo);
      if (top === 'sport') { var str = mesh(geo('caps'), mat('cloth', '#ffffff')); str.scale.set(lr * .25, A.lo / 2, lr * .25); str.position.set(d * lr * .85, -A.lo / 2, 0); el.add(str); var str2 = str.clone(); str2.scale.y = A.up / 2; str2.position.set(d * ur * .85, -A.up / 2, 0); s.add(str2); }
      if (longS) { var cuff2 = mesh(geo('tor'), mat('cloth', shade(topC, -.12))); cuff2.rotation.x = PI / 2; cuff2.scale.set(lr * .95, lr * .95, lr * .5); cuff2.position.y = -A.lo * .98; el.add(cuff2); }
      var hand = new T.Group(); hand.position.y = -A.lo - armR * .55; el.add(hand);
      hand.add(sphere(armR * 1.12, skin, .95, 1.15, .78, 24));
      var th = sphere(armR * .42, skin, 1, 1.4, 1, 16); th.position.set(-d * armR * .75, armR * .3, armR * .35); th.rotation.z = d * .5; hand.add(th);
      arms.push({ s: s, el: el, d: d });
    });
    // head
    var neckTop = hipY + H * 1.0 + A.neck, headY = neckTop + R * .82;
    var head = new T.Group(); head.position.y = headY - hipY; tg.add(head);
    var faceMats = {};
    function faceMat(m) { return faceMats[m] || (faceMats[m] = new T.MeshPhysicalMaterial({ map: faceTex(o, m), roughness: .5, sheen: .5, sheenColor: col('#ff8f80'), sheenRoughness: .45, clearcoat: .06, clearcoatRoughness: .5 })); }
    var hd = mesh(headGeo(o.face), faceMat('calm')); hd.scale.setScalar(R); head.add(hd);
    // ears
    [-1, 1].forEach(function (d) { var e = sphere(R * .2, skin, .45, 1, .75, 24); var ep = surf(d * .97, -.08, o.face); e.position.copy(ep.multiplyScalar(R)); e.position.z -= R * .05; e.rotation.y = d * .3; head.add(e); });
    // nose
    var np = surf(0, -.26, o.face); var nose = sphere(R * .085, mat('skin', mixc(o.skin, '#ff9c8c', .1)), 1.15, .85, .85, 24); nose.position.copy(np.multiplyScalar(R)); nose.position.z -= R * .02; head.add(nose);
    // eyes
    var eyes = [], ER = R * A.eye * (kid ? 1 : 1), ex = kid ? .37 : .36, ey = -.06;
    var lidOpen = { round: -.8, almond: -.5, lashes: -.68, sleepy: -.2 }[o.eyes] || -.68, lowRest = { round: .75, almond: .45, lashes: .62, sleepy: .55 }[o.eyes] || .62;
    [-1, 1].forEach(function (d) {
      var n = V(), sp = surf(d * ex, ey, o.face, n).multiplyScalar(R);
      var eg = new T.Group(); eg.position.copy(sp).addScaledVector(n, -ER * .74); eg.rotation.y = d * .1; head.add(eg);
      var ball = new T.Group(); eg.add(ball);
      var eb = mesh(geo('eyeball', function () { var g = new T.SphereGeometry(1, 48, 48); g.rotateX(PI / 2); return g; }), new T.MeshPhysicalMaterial({ map: irisTex(o.eyeColor), roughness: .06, clearcoat: 1, clearcoatRoughness: .02 }), false);
      eb.scale.setScalar(ER); ball.add(eb);
      var hl1 = sphere(ER * .13, mat('glow', '#ffffff'), 1, 1, .4, 16); hl1.position.set(ER * .3, ER * .32, ER * .93); ball.add(hl1);
      var hl2 = sphere(ER * .06, mat('glow', '#ffffff'), 1, 1, .4, 12); hl2.position.set(-ER * .25, -ER * .3, ER * .95); ball.add(hl2);
      var up = new T.Group(); eg.add(up);
      var lidG = geo('lid', function () { return new T.SphereGeometry(1, 40, 20, 0, PI * 2, 0, PI * .5); });
      var lid = mesh(lidG, skin); lid.scale.setScalar(ER * 1.035); up.add(lid);
      var lash = mesh(geo('lash', function () { var g = new T.TorusGeometry(1, .07, 8, 40, PI * 1.04); g.rotateZ(-PI * .02); g.rotateX(PI / 2); return g; }), mat('gloss', '#1a1210'));
      lash.scale.setScalar(ER * 1.045); up.add(lash);
      if (o.eyes === 'lashes' || o.eyes === 'round') {
        for (var l = 0; l < (o.eyes === 'lashes' ? 3 : 1); l++) {
          var aa = (.12 + l * .17), px = d * Math.cos(aa) * ER * 1.05, pz = Math.sin(aa) * ER * 1.05;
          up.add(taper([V(px, 0, pz), V(px + d * ER * .18, ER * .08, pz + ER * .02), V(px + d * ER * .3, ER * .22, pz)], ER * .07, ER * .01, mat('gloss', '#1a1210'), 8));
        }
      }
      var low = new T.Group(); eg.add(low);
      var ll = mesh(geo('lowlid', function () { return new T.SphereGeometry(1, 40, 20, 0, PI * 2, PI * .5, PI * .5); }), skin); ll.scale.setScalar(ER * 1.03); low.add(ll);
      eyes.push({ g: eg, ball: ball, up: up, low: low });
    });
    // hair
    var hm = mat('hair', o.hairColor);
    var hair = hairOf(o, A, hm, R, (shY - headY));
    head.add(hair);
    // earrings
    if (o.earrings) [-1, 1].forEach(function (d) { var ep = surf(d * .96, -.32, o.face).multiplyScalar(R); var er = sphere(R * .05, mat('metal', '#f5c84c'), 1, 1, 1, 16); er.position.copy(ep); er.position.z -= R * .05; er.position.x += d * R * .02; head.add(er); });

    var acc = { head: head, R: R, eyes: eyes, ex: ex, ey: ey, ER: ER, o: o, tg: tg, H: H, sh: sh, hip: hip, A: A, kid: kid };
    if (root.Hero3DExtras) root.Hero3DExtras(acc);

    // contact shadow under the feet
    var sh2 = mesh(geo('plane', function () { return new T.PlaneGeometry(1, 1); }), shadowMat(), false); sh2.rotation.x = -PI / 2; sh2.scale.set(hip * 5, hip * 3.6, 1); sh2.position.y = .003; sh2.renderOrder = -1; root2.add(sh2);
    body.traverse(function (m) { if (m.isMesh) m.receiveShadow = true; });

    var seed = root.H3D_SEED != null ? root.H3D_SEED : Math.random() * 10, lastMouth = 'calm';
    var M = { hL: hL, shH: hipY + H * .87, up: A.up, lo: A.lo, hand: armR * 1.7 };
    var cur = null, from = null, chT = 0, lastKey = '';
    function update(t, state, noHop, move) {
      t += seed;
      var pose = state === 'pose', off = state === 'off', wait = state === 'wait';
      if (move === 'charleston' || move === 'twist' || move === 'lambada') move = 'dance'; // mocap dances of the 3D girl
      var mv = pose ? 'pose' : off ? 'sleep' : wait ? 'stretch' : (MOVES[move] ? move : 'wave');
      var P = MOVES[mv](pose ? 0 : t, M, !noHop);
      if (mv !== lastKey) { from = cur ? Object.assign({}, cur) : P; chT = t; lastKey = mv; }
      var k = pose ? 1 : sstep(0, .6, t - chT);
      if (k >= 1) cur = P; else { cur = {}; for (var q in P) cur[q] = from[q] + (P[q] - from[q]) * k; }
      var c = cur;
      var br = Math.sin(t * 2.1);
      tg.scale.set(1 + br * .006, 1 + br * .01, 1 + br * .006);
      yawG.rotation.y = c.yaw; yawG.position.x = c.yx;
      body.position.set(c.bx, c.by, c.bz); body.rotation.set(c.brx, c.bry, c.brz);
      tg.rotation.set(c.spx, c.spy, c.spz); head.rotation.set(c.hx, c.hy, c.hz);
      var L = arms[0], Rr = arms[1];
      L.s.rotation.set(c.lsx, c.lsy, c.lsz); L.el.rotation.set(c.lex, c.ley, c.lez);
      Rr.s.rotation.set(c.rsx, c.rsy, c.rsz); Rr.el.rotation.set(c.rex, c.rey, c.rez);
      legs[0].h.rotation.set(c.lhx, c.lhy, c.lhz); legs[0].k.rotation.x = c.lk; legs[0].a.rotation.x = c.la;
      legs[1].h.rotation.set(c.rhx, c.rhy, c.rhz); legs[1].k.rotation.x = c.rk; legs[1].a.rotation.x = c.ra;
      // face: asleep, warming up or happy
      var happy = !off && !wait;
      var blink = !off && !pose && ((t * 1000 % 4300) < 140);
      var lid = off ? 1.35 : blink ? 1.3 : happy ? lidOpen - .05 : lidOpen, low = happy ? lowRest - .3 : off ? .1 : lowRest;
      eyes.forEach(function (e) {
        e.up.rotation.x = lid; e.low.rotation.x = low;
        e.ball.rotation.y = wait ? Math.sin(t * 1.9) * .45 : 0; e.ball.rotation.x = wait ? -.08 : 0;
      });
      var m = happy ? 'open' : wait ? 'wait' : 'calm';
      if (m !== lastMouth) { hd.material = faceMat(m); lastMouth = m; }
      if (acc.update) acc.update(t, off ? 'off' : wait ? 'wait' : 'on');
    }
    update(0, 'pose');
    var height = headY + R * 1.15;
    return { root: root2, update: update, height: height, width: sh * 2 + .25, headY: headY, R: R };
  }
  function shadowMat() {
    if (MC.shadow) return MC.shadow;
    var tx = canvasTex(128, 128, function (g) { var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(.6, 'rgba(0,0,0,.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    return MC.shadow = new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false });
  }

  root.Hero3D = { MOVES: MOVES, base: base, bend: bend, build: build, mat: mat, geo: geo, sphere: sphere, taper: taper, lock: lock, mesh: mesh, surf: surf, shade: shade, mixc: mixc, V: V, sstep: sstep, canvasTex: canvasTex, MC: MC, GC: GC, TC: TC };
})(window);
// glasses, hats and extras for Hero3D
(function (root) {
  'use strict';
  var T = root.THREE, H = root.Hero3D;
  if (!T || !H) return;
  var PI = Math.PI, V = H.V, mat = H.mat, geo = H.geo, mesh = H.mesh, sphere = H.sphere, taper = H.taper, shade = H.shade;

  function shapeOf(kind, w, h) {
    var s = new T.Shape();
    if (kind === 'heart') {
      s.moveTo(0, -h * .5); s.bezierCurveTo(-w * .2, -h * .3, -w * .55, -h * .05, -w * .5, h * .2);
      s.bezierCurveTo(-w * .45, h * .55, -w * .05, h * .55, 0, h * .25); s.bezierCurveTo(w * .05, h * .55, w * .45, h * .55, w * .5, h * .2);
      s.bezierCurveTo(w * .55, -h * .05, w * .2, -h * .3, 0, -h * .5);
    } else if (kind === 'star') {
      for (var i = 0; i < 10; i++) { var a = PI / 2 + i * PI / 5, r = (i % 2 ? .42 : 1) * w * .55; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    } else if (kind === 'round') {
      s.absellipse(0, 0, w / 2, h / 2, 0, PI * 2, false, 0);
    } else {
      var r2 = Math.min(w, h) * .32, x = -w / 2, y = -h / 2;
      s.moveTo(x + r2, y); s.lineTo(x + w - r2, y); s.quadraticCurveTo(x + w, y, x + w, y + r2); s.lineTo(x + w, y + h - r2); s.quadraticCurveTo(x + w, y + h, x + w - r2, y + h);
      s.lineTo(x + r2, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r2); s.lineTo(x, y + r2); s.quadraticCurveTo(x, y, x + r2, y);
    }
    return s;
  }
  function frameGeo(kind, w, h, t) {
    return geo('fr' + [kind, w, h, t].map(String).join(','), function () {
      var outer = shapeOf(kind, w + t * 2, h + t * 2), inner = shapeOf(kind, w, h);
      outer.holes.push(new T.Path(inner.getPoints(48).reverse()));
      var g = new T.ExtrudeGeometry(outer, { depth: t * .7, bevelEnabled: true, bevelThickness: t * .25, bevelSize: t * .25, bevelSegments: 3, curveSegments: 32 });
      g.translate(0, 0, -t * .35); return g;
    });
  }
  function lensGeo(kind, w, h) { return geo('ln' + [kind, w, h].join(','), function () { return new T.ShapeGeometry(shapeOf(kind, w, h), 32); }); }

  function glasses(acc) {
    var o = acc.o, g = o.glasses;
    if (g === 'none') return;
    var ER = acc.ER, R = acc.R, G = new T.Group(), up = g === 'up'; if (up) g = 'sun2';
    var kind = { sun2: 'round', round: 'round', square: 'rect', nerd: 'rect', sun: 'rect', star: 'star', heart: 'heart' }[g];
    var fc = { sun2: '#050507', round: '#c9a24a', square: '#2b2b33', nerd: '#121214', sun: '#121214', star: '#ff5c8a', heart: '#e3262f' }[g];
    var fm = mat(g === 'round' ? 'metal' : 'gloss', fc), t = { sun2: .14, round: .05, square: .08, nerd: .17, sun: .12, star: .1, heart: .1 }[g] * ER;
    var w = (g === 'star' ? 2.6 : g === 'heart' ? 2.6 : 2.45) * ER, h = (g === 'round' || g === 'sun2' ? 2.25 : g === 'star' || g === 'heart' ? 2.35 : 1.9) * ER;
    w = Math.min(w, 2 * acc.ex * R - 2.6 * t - .03 * R);
    if (g === 'sun2') h = w;
    var lensM = g === 'sun2' ? mat('lens', '#0a0a10') : g === 'sun' ? mat('lens', '#15151c') : g === 'star' ? mat('lens', '#ffb3d1') : g === 'heart' ? mat('lens', '#ff6b8a') : mat('glass', '#ffffff');
    if (g === 'star' || g === 'heart') { lensM = lensM.clone(); lensM.opacity = .35; }
    if (g === 'sun' || g === 'sun2') { lensM = lensM.clone(); lensM.opacity = up ? 1 : .92; if (up) { lensM.roughness = .3; lensM.clearcoat = .4; lensM.envMapIntensity = .5; } }
    var zs = [];
    acc.eyes.forEach(function (e, i) {
      var d = i ? 1 : -1, f = new T.Group();
      f.position.copy(e.g.position); f.position.z += ER * 1.32; f.position.y += ER * .05; f.rotation.y = d * .14;
      f.add(mesh(frameGeo(kind, w, h, t), fm));
      var l = mesh(lensGeo(kind, w, h), lensM, false); l.position.z = -t * .1; f.add(l);
      G.add(f); zs.push(f.position);
      // temple arm back to the ear
      var ex = f.position.x + d * (w / 2 + t * .6);
      if (!up) G.add(taper([V(ex, f.position.y + h * .2, f.position.z - ER * .2), V(d * R * .98, f.position.y + h * .15, R * .2), V(d * R * .98, f.position.y - ER * .2, -R * .2)], t * .45, t * .4, fm, 10));
    });
    var bridgeY = zs[0].y + h * .18;
    G.add(taper([V(zs[0].x + w / 2 - t, bridgeY, zs[0].z + ER * .05), V(0, bridgeY + ER * .12, zs[0].z + ER * .2), V(zs[1].x - w / 2 + t, bridgeY, zs[1].z + ER * .05)], t * .5, t * .5, fm, 10));
    if (up) { // pushed up onto the hair, like the reference girl
      var P = new T.Group(); P.add(G); P.rotation.x = -.8; P.scale.setScalar(1.1); P.position.set(0, 0, -R * .04); acc.head.add(P); return;
    }
    acc.head.add(G);
  }

  var LIFT = { afro: .5, curly: .16, spiky: .08, side: .04, short: .04, wavy: .03, long: .02, bob: .03 };
  function hats(acc) {
    var o = acc.o, h = o.hat, R = acc.R, hc = o.hatColor;
    if (h === 'none') return;
    var G = new T.Group(), lift = (LIFT[o.hair] || 0) * R, S = 1 + (o.hair === 'afro' ? .35 : o.hair === 'curly' ? .12 : 0);
    G.position.y = lift * .5; G.scale.setScalar(S); acc.head.add(G);
    var cm = mat('cloth', hc), gm = mat('gloss', hc);
    function dome(r, phiLen, m, rx) { var d = mesh(geo('dome' + phiLen, function () { return new T.SphereGeometry(1, 48, 24, 0, PI * 2, 0, PI * phiLen); }), m); d.scale.setScalar(r); d.rotation.x = rx || 0; d.material.side = T.DoubleSide; return d; }
    if (h === 'cap') {
      var c = dome(R * 1.13, .5, cm, -.28); c.position.y = R * .08; G.add(c);
      var brim = mesh(geo('brim', function () { var g = new T.CylinderGeometry(1, 1, 1, 40, 1, false, -PI / 2, PI); return g; }), gm);
      brim.scale.set(R * .78, R * .04, R * .62); brim.position.set(0, R * .5, R * .78); brim.rotation.x = .2; brim.rotation.y = PI; G.add(brim);
      var bt = sphere(R * .08, cm, 1, .6, 1, 16); bt.position.set(0, R * 1.2, -R * .2); G.add(bt);
    } else if (h === 'beanie') {
      var b = dome(R * 1.16, .5, cm, -.15); b.scale.y *= 1.12; b.position.y = R * .22; G.add(b);
      var cuff = mesh(geo('tor'), mat('cloth', shade(hc, -.1))); cuff.rotation.x = PI / 2 - .15; cuff.scale.set(R * 1.12, R * 1.1, R * .5); cuff.position.y = R * .3; G.add(cuff);
      var pom = mesh(geo('pomgeo', function () { var g = new T.IcosahedronGeometry(1, 3), p = g.attributes.position, v = V(); for (var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + .12 * Math.sin(v.x * 13) * Math.sin(v.y * 11) * Math.sin(v.z * 12)); p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; }), mat('cloth', '#ffffff'));
      pom.scale.setScalar(R * .26); pom.position.set(0, R * 1.5, -R * .2); G.add(pom);
    } else if (h === 'headband') {
      var hb = mesh(geo('tor'), gm); hb.scale.set(R * 1.08, R * 1.02, R * .25); hb.rotation.x = PI / 2 - .55; hb.position.set(0, R * .55, -R * .05); G.add(hb);
    } else if (h === 'bow') {
      var bw = new T.Group(); bw.position.set(R * .55, R * .92, R * .25); bw.rotation.set(.3, .3, -.5); G.add(bw);
      [-1, 1].forEach(function (d) { var l = sphere(R * .28, gm, 1, .62, .35, 24); l.position.x = d * R * .24; l.rotation.z = d * .35; bw.add(l); });
      bw.add(sphere(R * .1, gm, 1, 1, .7, 16));
    } else if (h === 'flowers') {
      var cols = ['#ff7ab6', '#ffffff', '#f2c14e', '#8e6cef', '#ff8a3d'];
      for (var i = 0; i < 9; i++) {
        var a = -PI * .55 + i / 8 * PI * 1.1, f = new T.Group();
        f.position.set(Math.sin(a) * R * 1.02, R * (.86 - .2 * Math.cos(a)), Math.cos(a) * R * .62 - R * .08); f.lookAt(f.position.clone().multiplyScalar(2)); G.add(f);
        for (var k = 0; k < 5; k++) { var pt = sphere(R * .1, mat('gloss', cols[i % 5]), 1, .62, .35, 12); var b2 = k / 5 * PI * 2; pt.position.set(Math.cos(b2) * R * .09, Math.sin(b2) * R * .09, 0); pt.rotation.z = b2; f.add(pt); }
        var ce = sphere(R * .06, mat('gloss', '#f2c14e'), 1, 1, .6, 12); ce.position.z = R * .03; f.add(ce);
      }
    } else if (h === 'headphones') {
      var band = mesh(geo('hpband', function () { return new T.TorusGeometry(1, .06, 12, 40, PI); }), gm); band.scale.setScalar(R * 1.16); band.position.y = R * .02; G.add(band);
      [-1, 1].forEach(function (d) {
        var cup = mesh(geo('cyl'), gm); cup.rotation.z = PI / 2; cup.scale.set(R * .32, R * .16, R * .32); cup.position.set(d * R * 1.08, -R * .02, 0); G.add(cup);
        var pad = mesh(geo('tor'), mat('leather', '#1c1c22')); pad.rotation.y = PI / 2; pad.scale.setScalar(R * .24); pad.position.set(d * R * .98, -R * .02, 0); G.add(pad);
      });
    } else if (h === 'party') {
      var cone = mesh(geo('cone', function () { return new T.CylinderGeometry(0, 1, 1, 40, 1); }), gm); cone.scale.set(R * .42, R * .95, R * .42); cone.position.set(R * .15, R * 1.3, 0); cone.rotation.z = -.25; G.add(cone);
      var pp = sphere(R * .14, mat('cloth', '#ffffff'), 1, 1, 1, 16); pp.position.set(R * .27, R * 1.78, 0); G.add(pp);
      for (var s2 = 0; s2 < 3; s2++) { var dot = sphere(R * .06, mat('gloss', '#ffffff'), 1, 1, .4, 12); dot.position.set(R * (.1 + s2 * .06) + Math.sin(s2 * 2) * R * .08, R * (1.05 + s2 * .2), R * (.35 - s2 * .08)); G.add(dot); }
    } else if (h === 'ears') {
      [-1, 1].forEach(function (d) {
        var e = mesh(geo('cone'), gm); e.scale.set(R * .3, R * .45, R * .14); e.position.set(d * R * .58, R * 1.05, -R * .05); e.rotation.z = -d * .45; G.add(e);
        var inn = mesh(geo('cone'), mat('gloss', '#ffb3c8')); inn.scale.set(R * .17, R * .3, R * .08); inn.position.set(d * R * .6, R * 1.03, R * .03); inn.rotation.z = -d * .45; G.add(inn);
      });
      var hb2 = mesh(geo('hpband'), gm); hb2.scale.setScalar(R * 1.08); hb2.position.y = R * .1; G.add(hb2);
    } else if (h === 'cowboy') {
      var lm = mat('leather', hc);
      var crown = H.mesh(geo('cbcrown', function () { return new T.LatheGeometry([[0, 0], [.62, 0], [.6, .45], [.5, .62], [.2, .6], [0, .52]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 40); }), lm);
      crown.scale.set(R, R, R * .9); crown.position.y = R * .72; G.add(crown);
      var brim2 = H.mesh(geo('cbbrim', function () { var g = new T.LatheGeometry([[.5, 0], [1.0, .01], [1.25, .12], [1.3, .16], [1.22, .1], [.95, -.03], [.5, -.03]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 48); var p = g.attributes.position; for (var i = 0; i < p.count; i++) { var x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); if (r > .9) p.setY(i, p.getY(i) + Math.pow(Math.abs(x) / 1.3, 2) * .35 * (r - .9) / .4); } g.computeVertexNormals(); return g; }), lm);
      brim2.scale.setScalar(R); brim2.position.y = R * .74; brim2.material.side = T.DoubleSide; G.add(brim2);
      var bandc = mesh(geo('ring'), mat('cloth', '#3a2a22')); bandc.rotation.x = PI / 2; bandc.scale.set(R * .61, R * .55, R * .6); bandc.position.y = R * .8; G.add(bandc);
    } else if (h === 'crown') {
      var gold = mat('metal', '#f5c84c'), cr = new T.Group(); cr.position.y = R * .86; cr.rotation.x = -.12; G.add(cr);
      var bd = mesh(geo('crb', function () { return new T.CylinderGeometry(1, .95, .3, 40, 1, true); }), gold); bd.scale.set(R * .62, R, R * .62); bd.material.side = T.DoubleSide; cr.add(bd);
      for (var q = 0; q < 7; q++) { var aa = q / 7 * PI * 2, pk = mesh(geo('cone'), gold); pk.scale.set(R * .12, R * .32, R * .12); pk.position.set(Math.sin(aa) * R * .6, R * .3, Math.cos(aa) * R * .6); cr.add(pk); var ball = sphere(R * .05, gold, 1, 1, 1, 12); ball.position.set(Math.sin(aa) * R * .6, R * .48, Math.cos(aa) * R * .6); cr.add(ball); }
      var gem = sphere(R * .09, mat('gloss', '#e3262f'), 1, 1, .5, 16); gem.position.set(0, R * .02, R * .63); cr.add(gem);
    }
  }

  function extras(acc) {
    var o = acc.o, e = o.extra, tg = acc.tg, Hh = acc.H, sh = acc.sh, hip = acc.hip;
    if (e === 'backpack') {
      var bc = o.hatColor === o.topColor ? '#f2c14e' : o.hatColor, bm = mat('cloth', bc);
      var bp = sphere(1, bm, sh * .85, Hh * .45, sh * .4, 32); bp.position.set(0, Hh * .55, -sh * .78); tg.add(bp);
      var pk = sphere(1, mat('cloth', shade(bc, -.12)), sh * .55, Hh * .18, sh * .2, 24); pk.position.set(0, Hh * .4, -sh * 1.0); tg.add(pk);
      [-1, 1].forEach(function (d) { tg.add(taper([V(d * sh * .45, Hh * .78, -sh * .6), V(d * sh * .55, Hh * 1.0, 0), V(d * sh * .5, Hh * .7, sh * .72), V(d * sh * .48, Hh * .38, sh * .7)], .022, .022, mat('cloth', shade(bc, -.25)), 14)); });
    } else if (e === 'cape') {
      var cape = new T.Group(); cape.position.set(0, Hh * .95, -sh * .45); tg.add(cape);
      var len = acc.A.leg * .8 + Hh * .9;
      var cg = mesh(geo('cape' + len.toFixed(3) + sh.toFixed(3), function () {
        var g = new T.CylinderGeometry(sh * .8, sh * 1.6, len, 40, 12, true, PI * .55, PI * .9), p = g.attributes.position;
        for (var i = 0; i < p.count; i++) { var y = p.getY(i), x = p.getX(i), u = (len / 2 - y) / len; p.setZ(i, p.getZ(i) * .6 - u * .08); p.setY(i, y + Math.sin(x * 25) * .015 * u); }
        g.translate(0, -len / 2, 0); g.computeVertexNormals(); return g;
      }), mat('cloth', '#e3262f'));
      cg.material = cg.material.clone(); cg.material.side = T.DoubleSide; cape.add(cg);
      var clasp = sphere(.035, mat('metal', '#f5c84c'), 1, 1, .5, 16); clasp.position.set(0, Hh * .97, sh * .62); tg.add(clasp);
      acc.cape = cape;
    } else if (e === 'wings') {
      var wm = mat('gloss', '#ffffff'), wings = [];
      [-1, 1].forEach(function (d) {
        var w = new T.Group(); w.position.set(d * sh * .25, Hh * .75, -sh * .6); tg.add(w);
        for (var f = 0; f < 4; f++) {
          var fe = sphere(1, wm, .07 + f * .012, .3 - f * .045, .03, 24); fe.position.set(d * (.16 + f * .07), .1 - f * .08, -f * .01); fe.rotation.z = d * (1.0 + f * .25); w.add(fe);
        }
        wings.push({ g: w, d: d });
      });
      acc.wings = wings;
    }
  }

  root.Hero3DExtras = function (acc) {
    glasses(acc); hats(acc); extras(acc);
    acc.update = function (t, state) {
      var on = state === 'on';
      if (acc.cape) acc.cape.rotation.x = -.08 - (on ? .25 + Math.sin(t * 5) * .1 : Math.sin(t * 1.5) * .04);
      if (acc.wings) acc.wings.forEach(function (w) { w.g.rotation.y = w.d * (on ? .5 + Math.sin(t * 9) * .45 : .25 + Math.sin(t * 1.5) * .05); });
    };
  };
})(window);
// Сцена для 3D-человечков: герой на красной кнопке-платформе, друзья рядом, снимки для превью.
// Hero3D.ok — есть ли WebGL; new Hero3D.Stage({platform, drag}) -> .canvas, .set(me, friends, state, {hop, pop}); Hero3D.snap(o, view, cb)
(function (root) {
  'use strict';
  var T = root.THREE, H = root.Hero3D;
  if (!T || !H) return;
  var PI = Math.PI;
  H.ok = (function () { try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();

  function renderer(canvas, w, h) {
    var r = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!w });
    r.setPixelRatio(w ? (root.H3D_SNAP_DPR || 1) : Math.min(root.H3D_MAX_DPR || 2, root.devicePixelRatio || 1));
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1; r.outputColorSpace = T.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    if (w) r.setSize(w, h, false);
    return r;
  }
  function lights(scene, r) {
    var pm = new T.PMREMGenerator(r); scene.environment = pm.fromScene(new root.RoomEnvironment(r), .04).texture; pm.dispose();
    var key = new T.DirectionalLight(0xfff0e4, 2); key.position.set(2, 4.5, 5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 4; key.shadow.camera.bottom = -1; key.shadow.radius = 4; key.shadow.bias = -.0006; scene.add(key);
    var rim = new T.DirectionalLight(0xffc9d2, 1.5); rim.position.set(-3, 3, -3); scene.add(rim);
    var hemi = new T.HemisphereLight(0xffffff, 0x5a2a30, .5); scene.add(hemi);
    return { key: key, rim: rim, hemi: hemi };
  }
  function spriteTex(kind) {
    var k = 'sp' + kind; if (H.TC[k]) return H.TC[k];
    return H.TC[k] = H.canvasTex(128, 128, function (g) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (kind === 'z') { g.font = '900 96px system-ui,Segoe UI,sans-serif'; g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(160,190,255,.9)'; g.shadowBlur = 14; g.fillText('Z', 64, 70); }
      else if (kind === 'heart') { g.fillStyle = '#ff4d6d'; g.shadowColor = 'rgba(255,80,110,.9)'; g.shadowBlur = 16; g.beginPath(); g.moveTo(64, 104); g.bezierCurveTo(10, 66, 22, 18, 64, 40); g.bezierCurveTo(106, 18, 118, 66, 64, 104); g.fill(); }
      else { g.fillStyle = '#ffd34d'; g.shadowColor = 'rgba(255,210,80,.9)'; g.shadowBlur = 16; g.beginPath(); for (var i = 0; i < 10; i++) { var a = -PI / 2 + i * PI / 5, r = i % 2 ? 18 : 46; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } g.fill(); }
    });
  }
  // colours of the button platform and of the hero's red parts, per app theme (Hero3D.setTheme)
  var TH = H.theme = { on: '#e3262f', off: '#5c1c22', glow: '#ff2030', ring: '#ffffff' };
  H.tint = { value: new T.Color('#ffffff') }; H.tintOn = { value: 0 };
  H.setTheme = function (o) { for (var k in o) TH[k] = o[k]; H.tintOn.value = o.tint ? 1 : 0; if (o.tint) H.tint.value.set(o.tint); };
  function platform() {
    var G = new T.Group();
    var body = H.mesh(H.geo('plat', function () { return new T.LatheGeometry([[0, 0], [.86, 0], [.9, .03], [.9, .15], [.86, .19], [0, .19]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 72); }), new T.MeshPhysicalMaterial({ color: '#e3262f', roughness: .22, clearcoat: 1, clearcoatRoughness: .08, emissive: new T.Color('#ff2030'), emissiveIntensity: 0 }));
    body.receiveShadow = true; G.add(body);
    var ringM = new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .9 });
    var ring = new T.Mesh(H.geo('pring', function () { return new T.TorusGeometry(.76, .012, 8, 96); }), ringM); ring.rotation.x = PI / 2; ring.position.y = .193; G.add(ring);
    var icon = new T.Group(); icon.position.set(0, .194, .56); G.add(icon);
    var arc = new T.Mesh(H.geo('parc', function () { return new T.TorusGeometry(.085, .016, 8, 40, PI * 1.55); }), ringM); arc.rotation.x = -PI / 2; arc.rotation.z = -PI / 2 + PI * .225 + PI; icon.add(arc);
    var bar = new T.Mesh(H.geo('pbar', function () { return new T.CapsuleGeometry(.016, .07, 4, 8); }), ringM); bar.rotation.x = PI / 2; bar.position.z = -.06; icon.add(bar);
    return { g: G, body: body, ringM: ringM };
  }

  var stages = [], last = 0, t0 = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden || root.H3D_STILL || now - last < 31) return; // ~30 fps is plenty and keeps the PC cool
    last = now;
    var t = (now - t0) / 1000;
    stages.forEach(function (s) { if (s.canvas.isConnected && s.canvas.offsetParent !== null) s.frame(t); });
  }
  var looping = false;

  function Stage(opt) {
    opt = opt || {};
    var self = this, canvas = this.canvas = document.createElement('canvas');
    canvas.className = 'h3d';
    var r = renderer(canvas), scene = new T.Scene(), L = lights(scene, r), cam = new T.PerspectiveCamera(26, 1, .1, 60);
    var plat = opt.platform ? platform() : null; if (plat) scene.add(plat.g);
    var chars = [], key = '', move = 'dance', state = 'off', hop = true, pops = [], fx = [], yaw = 0, drag = null, w0 = 0, h0 = 0, fit = { y: 1, d: 6 };
    for (var i = 0; i < 7; i++) { var sp = new T.Sprite(new T.SpriteMaterial({ map: spriteTex('z'), transparent: true, depthWrite: false })); sp.visible = false; scene.add(sp); fx.push(sp); }
    if (opt.drag) {
      canvas.style.touchAction = 'pan-y'; canvas.style.cursor = 'grab';
      canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: yaw }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
      canvas.addEventListener('pointermove', function (e) { if (drag) yaw = drag.y + (e.clientX - drag.x) / 90; });
      canvas.addEventListener('pointerup', function () { drag = null; canvas.style.cursor = 'grab'; });
    }
    this.set = function (me, friends, st, o) {
      o = o || {}; state = st; hop = o.hop !== false; move = o.move || 'dance';
      var k = JSON.stringify([me, friends, move === 'pushup']);
      if (k !== key) {
        key = k;
        chars.forEach(function (c) { scene.remove(c.root); }); chars = [];
        var spots = [[0, 0, 0], [-.92, 0, -.55], [.92, 0, -.55], [-1.7, 0, -1.1], [1.7, 0, -1.1], [-2.4, 0, -1.6], [2.4, 0, -1.6]];
        // with friends everybody stands on one wide platform; alone the hero stands on the button
        var crowd = !!(friends && friends.length), platR = 0;
        // friends stand evenly around the hero on one round platform (0.17.2)
        if (crowd && plat) spots = [[0, 0, .4], [-.85, 0, .1], [.85, 0, .1], [-.46, 0, -.45], [.46, 0, -.45], [-1.02, 0, -.38], [1.02, 0, -.38]];
        [me].concat(friends || []).slice(0, spots.length).forEach(function (a, i) {
          var c = H.build(a), sp = spots[i]; c.root.position.set(sp[0], (i === 0 || crowd) && plat ? .19 : 0, sp[2]); c.root.rotation.y = -sp[0] * .12;
          c.base = c.root.position.clone(); c.i = i; scene.add(c.root); chars.push(c);
        });
        if (plat && crowd) {
          var x0 = 0, x1 = 0, z0 = 0, z1 = 0; chars.forEach(function (c) { x0 = Math.min(x0, c.base.x); x1 = Math.max(x1, c.base.x); z0 = Math.min(z0, c.base.z); z1 = Math.max(z1, c.base.z); });
          var pr = 0; chars.forEach(function (c) { pr = Math.max(pr, Math.hypot(c.base.x, c.base.z + .02) + .42); });
          plat.g.position.set(0, 0, -.02); plat.g.scale.set(pr / .9, 1, pr / .9); platR = pr;
        } else if (plat) { var pw = chars[0].width * 1.6; plat.g.position.set(0, 0, 0); plat.g.scale.set(Math.max(.75, pw), 1, Math.max(.75, pw)); }
        // camera fit: everybody from head to toe
        var minX = 0, maxX = 0, top = 0;
        chars.forEach(function (c) { var k = 1 / (1 + -c.base.z * .12); minX = Math.min(minX, (c.base.x - c.width * .8) * k); maxX = Math.max(maxX, (c.base.x + c.width * .8) * k); top = Math.max(top, c.base.y + c.height * k + .1); });
        // push-ups lie along the platform, so leave room for the whole body
        if (plat && crowd) { minX = Math.min(minX, -platR - .05); maxX = Math.max(maxX, platR + .05); } // the whole round platform stays in view
        if (move === 'pushup') { minX = Math.min(minX, -chars[0].height * .75); maxX = Math.max(maxX, chars[0].height * .75); }
        fit = { y: top * .5 - .02, hgt: Math.max(top + (top > 1.5 ? .12 : .3), 1.85), wid: (maxX - minX) + .2, cx: (minX + maxX) / 2 };
        pops = [];
        if (o.pop >= 0) chars.forEach(function (c) { if (c.i > 0) pops[c.i] = performance.now() + (c.i - 1) * 120; });
        resize(true);
      }
      if (!looping) { looping = true; requestAnimationFrame(loop); }
      self.frame((performance.now() - t0) / 1000);
    };
    function resize(force) {
      var w = canvas.clientWidth || 300, h = canvas.clientHeight || 240;
      if (!force && w === w0 && h === h0) return; w0 = w; h0 = h;
      r.setSize(w, h, false); cam.aspect = w / h;
      var vf = 2 * Math.tan(cam.fov * PI / 360), d = Math.max(fit.hgt / vf, fit.wid / (vf * cam.aspect)) * 1.04;
      cam.position.set(fit.cx || 0, fit.y + d * .07, d + (chars.length > 1 ? .4 : 0)); cam.lookAt(fit.cx || 0, fit.y - .02, 0); cam.updateProjectionMatrix();
    }
    this.frame = function (t) {
      resize(false);
      var on = state === 'on', off = state === 'off', wait = state === 'wait', now = performance.now();
      L.key.intensity = off ? 1.1 : on ? 2.1 : 1.6; L.hemi.intensity = off ? .28 : .55; L.rim.intensity = off ? .9 : 1.6;
      L.key.color.set(off ? 0xc9d4ff : 0xfff0e4); r.toneMappingExposure = off ? .82 : 1;
      if (plat) {
        var m = plat.body.material; m.color.set(off ? TH.off : TH.on); m.emissive.set(TH.glow); m.envMapIntensity = TH.env == null ? 1 : TH.env; m.clearcoat = TH.coat == null ? 1 : TH.coat; plat.ringM.color.set(TH.ring);
        m.emissiveIntensity = (on ? .18 + .1 * Math.sin(t * 3) : wait ? .1 + .1 * Math.sin(t * 8) : 0) * (TH.gi == null ? 1 : TH.gi);
        plat.ringM.opacity = off ? .35 : wait ? .5 + .4 * Math.sin(t * 8) : .95;
      }
      chars.forEach(function (c) {
        var cs = c.i === 0 ? state : (state === 'wait' ? 'on' : state);
        c.update(t + c.i * 1.7, cs, !hop, c.i === 0 || move !== 'pushup' ? move : 'squat');
        var p = pops[c.i];
        if (p) { var u = Math.min(1, Math.max(0, (now - p) / 600)), s = u <= 0 ? .001 : 1 + Math.sin(u * PI * 2.2) * (1 - u) * .35 - (1 - u) * (1 - u) * .9; c.root.scale.setScalar(Math.max(.001, s)); if (u >= 1) { pops[c.i] = 0; c.root.scale.setScalar(1); } }
        if (c.i === 0 && opt.drag) { if (!drag) yaw *= .96; c.root.rotation.y = yaw; }
      });
      // floating Zz while asleep, hearts and stars when protected
      fx.forEach(function (sp, i) {
        var c = chars[i % Math.max(1, chars.length)];
        if (!c || wait || (on && i >= Math.min(7, chars.length * 2 + 1))) { sp.visible = false; return; }
        var period = off ? 3.2 : 2.4, u = ((t + i * period / fx.length * 1.7) % period) / period;
        if (off && i > 2) { sp.visible = false; return; }
        c = off ? chars[0] : c; if (!c) return;
        var kind = off ? 'z' : i % 2 ? 'star' : 'heart'; if (sp.material.map !== spriteTex(kind)) { sp.material.map = spriteTex(kind); sp.material.needsUpdate = true; }
        sp.visible = true; sp.material.opacity = Math.sin(u * PI);
        var hx = c.root.position.x + (off ? c.R * .9 + u * .25 : Math.sin(i * 2.3) * c.R * 2.2), hy = c.root.position.y + c.headY + (off ? c.R * .7 : c.R * .4) + u * (off ? .5 : .6);
        sp.position.set(hx + (off ? Math.sin(u * 6 + i) * .05 : 0), hy, c.root.position.z + .2);
        var sc = (off ? .1 + i * .04 : .12) * (.6 + .4 * Math.sin(u * PI)); sp.scale.set(sc, sc, 1);
      });
      r.render(scene, cam);
    };
    stages.push(this);
    this.debug = function () { return { chars: chars.length, fit: fit, cam: cam.position.toArray(), w: w0, h: h0, state: state }; };
    this.dispose = function () { stages.splice(stages.indexOf(self), 1); r.dispose(); };
  }
  H.Stage = Stage; H.stages = stages;

  // ---------- snapshots for buttons and lists: one hidden renderer, a queue, a cache ----------
  var snapR = null, snapS = null, snapCam = null, cache = {}, order = [], queue = [], busy = false;
  function snapKey(o, view) { return view + (H.tintOn.value ? H.tint.value.getHexString() : '') + JSON.stringify(o); } // the theme recolours the ninja
  H.snapCached = function (o, view) { return cache[snapKey(o, view)] || ''; };
  // alive(): is anybody still waiting for this picture (the button may be gone already)
  H.snap = function (o, view, cb, alive) {
    var k = snapKey(o, view);
    if (cache[k]) { cb(cache[k], k); return k; }
    queue.push({ o: o, view: view, k: k, cb: cb, alive: alive });
    if (!busy) { busy = true; setTimeout(work, 0); }
    return k;
  };
  function work() {
    var job = queue.shift();
    if (!job) { busy = false; return; }
    if (!cache[job.k] && job.alive && !job.alive() && !queue.some(function (q) { return q.k === job.k && (!q.alive || q.alive()); })) { setTimeout(work, 0); return; }
    if (!cache[job.k]) {
      try {
        var head = job.view === 'head', W = head ? 160 : 160, Hh = head ? 160 : 240;
        if (!snapR) { var cv = document.createElement('canvas'); snapR = renderer(cv, 160, 240); snapS = new T.Scene(); lights(snapS, snapR); snapCam = new T.PerspectiveCamera(24, 1, .1, 40); }
        snapR.setSize(W, Hh, false); snapCam.aspect = W / Hh;
        var c = H.build(job.o); c.update(0, 'pose', true); snapS.add(c.root);
        var vf = 2 * Math.tan(snapCam.fov * PI / 360);
        if (head) { var hy = c.headY + c.R * .12, d = (c.R * 2.9) / vf; snapCam.position.set(0, hy + .05, d); snapCam.lookAt(0, hy, 0); }
        else { var tall = c.height + .12, d2 = Math.max(tall / vf, (c.width * 1.12) / (vf * snapCam.aspect)) * .98; snapCam.position.set(0, tall * .5 + .1, d2); snapCam.lookAt(0, tall * .48, 0); }
        snapCam.updateProjectionMatrix();
        snapR.render(snapS, snapCam);
        snapS.remove(c.root);
        cache[job.k] = snapR.domElement.toDataURL('image/png'); order.push(job.k);
        if (order.length > 400) delete cache[order.shift()];
      } catch (e) { cache[job.k] = ''; }
    }
    // everybody waiting for the same picture gets it
    var url = cache[job.k];
    job.cb(url, job.k);
    for (var i = queue.length - 1; i >= 0; i--) if (queue[i].k === job.k) { queue[i].cb(url, job.k); queue.splice(i, 1); }
    setTimeout(work, 0);
  }
})(window);

// ---------- Hero3DModels.meshy: the user's rigged Meshy people (Mixamo skeleton) with their own Meshy animations ----------
(function (root) {
  var T = root.THREE, H = root.Hero3D;
  if (!T || !H) return;
  var PI = Math.PI, sstep = H.sstep;
  function make(D) {
  if (D.static) return makeStatic(D);
  var S = null, clips = {}, HT = (D.rig.box[1][1] - D.rig.box[0][1]) / 100;
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
  // the skin texture starts loading at once, so snapshots taken later are not black
  var img = new Image(), tex = new T.Texture(img); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = true;
  img.onload = function () { tex.needsUpdate = true; }; img.src = D.jpg;
  var mat = new T.MeshStandardMaterial({ map: tex, roughness: .6, metalness: 0, envMapIntensity: .85 });
  function decode() {
    if (S) return S;
    var buf = b64(D.bin), h = new Float32Array(buf, 0, 8), nv = h[0], nt = h[1], mn = [h[2], h[3], h[4]], mx = [h[5], h[6], h[7]], o = 32;
    var q = new Uint16Array(buf, o, nv * 3); o += nv * 6;
    var qu = new Uint16Array(buf, o, nv * 2); o += nv * 4;
    var sk = new Uint8Array(buf, o, nv * 8); o += nv * 8;
    var qn = new Int8Array(buf, o, nv * 3); o += nv * 3; if (o % 2) o++;
    var ix = nv < 65536 ? new Uint16Array(buf, o, nt * 3) : new Uint32Array(buf.slice(o), 0, nt * 3);
    var pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), nor = new Float32Array(nv * 3), si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
    for (var i = 0; i < nv; i++) {
      for (var k = 0; k < 3; k++) { pos[3 * i + k] = mn[k] + q[3 * i + k] / 65535 * (mx[k] - mn[k]); nor[3 * i + k] = qn[3 * i + k] / 127; }
      uv[2 * i] = qu[2 * i] / 65535; uv[2 * i + 1] = qu[2 * i + 1] / 65535;
      for (k = 0; k < 4; k++) { si[4 * i + k] = sk[8 * i + k]; sw[4 * i + k] = sk[8 * i + 4 + k] / 255; }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new T.BufferAttribute(sw, 4));
    g.setIndex(new T.BufferAttribute(nv < 65536 ? new Uint16Array(ix) : new Uint32Array(ix), 1));
    g.computeBoundingSphere();
    for (var c in D.clips) {
      var C = D.clips[c], a = new Int16Array(b64(C.d)), f = new Float32Array(a.length);
      for (i = 0; i < a.length; i++) f[i] = a[i] / 32000;
      var keys = C.keys.map(function (s, j) { var p = s.split('.'); return { b: +p[0], pos: p[1] === 'position', sc: C.sc[j] }; });
      var ki = C.borrowed ? keys.map(function (k, j) { return k.pos ? -1 : j; }).filter(function (j) { return j >= 0; }) : null;
      clips[c] = { n: C.n, f: f, keys: keys, rate: C.n / C.dur, skip: !!C.borrowed, ground: C.ground != null ? C.ground : D.rig.box[0][1] };
    }
    return (S = { g: g, m: mat });
  }
  var qa = new T.Quaternion(), qb = new T.Quaternion();
  function build(o) {
    decode();
    var R = D.rig, root2 = new T.Group(), yawG = new T.Group(), holder = new T.Group(); root2.add(yawG); yawG.add(holder);
    var bones = R.names.map(function (n, i) { var b = new T.Bone(); b.name = n; b.position.fromArray(R.pos[i]); b.quaternion.fromArray(R.quat[i]); b.scale.fromArray(R.scl[i]); return b; });
    var top = new T.Group(); top.matrixAutoUpdate = false; top.matrix.fromArray(R.top); holder.add(top);
    bones.forEach(function (b, i) { (R.parent[i] < 0 ? top : bones[R.parent[i]]).add(b); });
    var mesh = new T.SkinnedMesh(S.g, S.m); mesh.frustumCulled = false; mesh.castShadow = true; mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(R.mesh);
    holder.add(mesh);
    var inv = R.inv.map(function (e) { return new T.Matrix4().fromArray(e); });
    mesh.bind(new T.Skeleton(bones, inv), new T.Matrix4().fromArray(R.bind));
    // scale to height, feet on the floor (the model is 1.7 tall in its own units)
    var k0 = HT / (D.rig.box[1][1] - D.rig.box[0][1]); holder.scale.setScalar(k0); holder.position.y = -D.rig.box[0][1] * k0;
    var rest = bones.map(function (b) { return { p: b.position.clone(), q: b.quaternion.clone() }; });
    var head = R.names.indexOf('mixamorigHead'), restQ = bones.map(function (b) { return b.quaternion.clone(); }), restP = bones.map(function (b) { return b.position.clone(); });
    var sc = document.createElement('canvas'); sc.width = sc.height = 64; var cx = sc.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    var shm = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shm.rotation.x = -PI / 2; shm.scale.set(HT * .6, HT * .42, 1); shm.position.y = .003; shm.renderOrder = -1; root2.add(shm);
    function frame(c, t, out) {
      var x = ((t * c.rate) % c.n + c.n) % c.n, i0 = Math.floor(x), i1 = (i0 + 1) % c.n, u = x - i0, w = c.keys.length * 4, f = c.f;
      c.keys.forEach(function (k, j) {
        if (c.skip && k.pos) return;
        var a = i0 * w + 4 * j, b = i1 * w + 4 * j, r = out[k.b] || (out[k.b] = {});
        if (k.pos) r.p = new T.Vector3(f[a] + (f[b] - f[a]) * u, f[a + 1] + (f[b + 1] - f[a + 1]) * u, f[a + 2] + (f[b + 2] - f[a + 2]) * u).multiplyScalar(k.sc);
        else { qa.set(f[a], f[a + 1], f[a + 2], f[a + 3]).normalize(); qb.set(f[b], f[b + 1], f[b + 2], f[b + 3]).normalize(); r.q = qa.clone().slerp(qb, u); }
      });
      return out;
    }
    var seed = root.H3D_SEED != null ? root.H3D_SEED : Math.random() * 10, cur = '', prev = null, chT = 0, gy0 = null, lastT = 0;
    var spine = R.names.indexOf('mixamorigSpine2'), chest = R.names.indexOf('mixamorigSpine1');
    function update(t, state, noHop, move) {
      t += seed;
      var off = state === 'off', wait = state === 'wait', pose = state === 'pose';
      var mv = D.alias[move] || move; if (!clips[mv]) mv = move === 'idle' ? 'none' : D.alias.walk;
      var key = pose || off || wait ? D.alias.idle : mv;
      if (key !== cur && clips[key]) { prev = cur ? { k: cur, t: t } : null; cur = key; chT = t; }
      if (!clips[key]) { bones.forEach(function (b, i) { b.quaternion.copy(restQ[i]); b.position.copy(restP[i]); }); key = null; }
      // feet on the floor for this very move: each clip carries its own lowest point
    var gy = -(key ? clips[key].ground : D.rig.box[0][1]) * k0;
    holder.position.y = gy0 == null ? gy : gy0 + (gy - gy0) * Math.min(1, Math.max(0, (t - lastT) * 6)); gy0 = holder.position.y; lastT = t;
    var A = key ? frame(clips[key], (pose || off || wait) && !/Idle/.test(key) ? 0 : t - chT, {}) : {}, k = sstep(0, .5, t - chT);
      var Bp = prev && k < 1 ? frame(clips[prev.k], t - prev.t, {}) : null;
      bones.forEach(function (b, i) {
        var r = A[i]; if (!r) return;
        if (r.q) { b.quaternion.copy(r.q); if (Bp && Bp[i] && Bp[i].q) b.quaternion.copy(Bp[i].q).slerp(r.q, k); }
        if (r.p) { b.position.copy(r.p); if (Bp && Bp[i] && Bp[i].p) b.position.copy(Bp[i].p).lerp(r.p, k); }
      });
      // standing is one calm pose; only a slow breath moves the chest
      if (key && /Idle/.test(key)) {
        var br = Math.sin(t * 1.5) * .012;
        if (spine >= 0) bones[spine].quaternion.multiply(qa.setFromEuler(new T.Euler(-br, 0, 0)));
        if (chest >= 0) bones[chest].quaternion.multiply(qa.setFromEuler(new T.Euler(-br * .5, 0, 0)));
      }
      if (off || wait) {
        var e = off ? new T.Euler(.3, 0, .08) : new T.Euler(-.05, Math.sin(t * 1.7) * .5, 0);
        bones[head].quaternion.multiply(qa.setFromEuler(e));
        
      }
    }
    update(0, 'pose');
    return { root: root2, update: update, height: HT, width: HT * .3, headY: HT * .87, R: HT * .07, model: true };
  }
  return build;
  }

  // ---------- a static (skeleton-less) Meshy figure: the head bends around the neck and the chest breathes in the vertex shader ----------
  // meshoptimizer reference decoder (MIT, (C) 2016-2024 Arseny Kapoulkine; decoder by Jasper St. Pierre): synchronous, for the compressed figures (mz)
  var MZ = (function () {
// This file is part of meshoptimizer library and is distributed under the terms of MIT License.
// Copyright (C) 2016-2024, by Arseny Kapoulkine (arseny.kapoulkine@gmail.com)

// This is the reference decoder implementation by Jasper St. Pierre.
// It follows the decoder interface and should be a drop-in replacement for the actual decoder from meshopt_decoder.js
// It is provided for educational value and is not recommended for use in production because it's not performance-optimized.

const MeshoptDecoder = {};
MeshoptDecoder.supported = true;

function assert(cond) {
    if (!cond) {
        throw new Error("Assertion failed");
    }
}

function dezig(v) {
    return ((v & 1) !== 0) ? ~(v >>> 1) : v >>> 1;
}

MeshoptDecoder.decodeVertexBuffer = (target, elementCount, byteStride, source, filter) => {
    assert(source[0] === 0xA0);

    const maxBlockElements = Math.min((0x2000 / byteStride) & ~0x000F, 0x100);

    const deltas = new Uint8Array(0x10);

    const tailDataOffs = source.length - byteStride;

    // What deltas are stored relative to
    const tempData = source.slice(tailDataOffs, tailDataOffs + byteStride);

    let srcOffs = 0x01;

    // Attribute Blocks
    for (let dstElemBase = 0; dstElemBase < elementCount; dstElemBase += maxBlockElements) {
        const attrBlockElementCount = Math.min(elementCount - dstElemBase, maxBlockElements);
        const groupCount = ((attrBlockElementCount + 0x0F) & ~0x0F) >>> 4;
        const headerByteCount = ((groupCount + 0x03) & ~0x03) >>> 2;

        // Data blocks
        for (let byte = 0; byte < byteStride; byte++) {
            let headerBitsOffs = srcOffs;

            srcOffs += headerByteCount;
            for (let group = 0; group < groupCount; group++) {
                const mode = (source[headerBitsOffs] >>> ((group & 0x03) << 1)) & 0x03;
                // If this is the last group, move to the next byte of header bits.
                if ((group & 0x03) === 0x03)
                    headerBitsOffs++;

                const dstElemGroup = dstElemBase + (group << 4);

                if (mode === 0) {
                    // bits 0: All 16 byte deltas are 0; the size of the encoded block is 0 bytes
                    deltas.fill(0x00);
                } else if (mode === 1) {
                    // bits 1: Deltas are using 2-bit sentinel encoding; the size of the encoded block is [4..20] bytes
                    const srcBase = srcOffs;
                    srcOffs += 0x04;
                    for (let m = 0; m < 0x10; m++) {
                        // 0 = >>> 6, 1 = >>> 4, 2 = >>> 2, 3 = >>> 0
                        const shift = (6 - ((m & 0x03) << 1));
                        let delta = (source[srcBase + (m >>> 2)] >>> shift) & 0x03;
                        if (delta === 3)
                            delta = source[srcOffs++];
                        deltas[m] = delta;
                    }
                } else if (mode === 2) {
                    // bits 2: Deltas are using 4-bit sentinel encoding; the size of the encoded block is [8..24] bytes
                    const srcBase = srcOffs;
                    srcOffs += 0x08;
                    for (let m = 0; m < 0x10; m++) {
                        // 0 = >>> 6, 1 = >>> 4, 2 = >>> 2, 3 = >>> 0
                        const shift = (m & 0x01) ? 0 : 4;
                        let delta = (source[srcBase + (m >>> 1)] >>> shift) & 0x0f;
                        if (delta === 0xf)
                            delta = source[srcOffs++];
                        deltas[m] = delta;
                    }
                } else {
                    // bits 3: All 16 byte deltas are stored verbatim; the size of the encoded block is 16 bytes
                    deltas.set(source.subarray(srcOffs, srcOffs + 0x10));
                    srcOffs += 0x10;
                }

                // Go through and apply deltas to data
                for (let m = 0; m < 0x10; m++) {
                    const dstElem = dstElemGroup + m;
                    if (dstElem >= elementCount)
                        break;

                    const delta = dezig(deltas[m]);
                    const dstOffs = dstElem * byteStride + byte;
                    target[dstOffs] = (tempData[byte] += delta);
                }
            }
        }
    }

    // Filters - only applied if filter isn't undefined or NONE
    if (filter === 'OCTAHEDRAL') {
        assert(byteStride === 4 || byteStride === 8);

        let dst, maxInt;
        if (byteStride === 4) {
            dst = new Int8Array(target.buffer);
            maxInt = 127;
        } else {
            dst = new Int16Array(target.buffer);
            maxInt = 32767;
        }

        for (let i = 0; i < 4 * elementCount; i += 4) {
            let x = dst[i + 0], y = dst[i + 1], one = dst[i + 2];
            x /= one;
            y /= one;
            const z = 1.0 - Math.abs(x) - Math.abs(y);
            const t = Math.max(-z, 0.0);
            x -= (x >= 0) ? t : -t;
            y -= (y >= 0) ? t : -t;
            const h = maxInt / Math.hypot(x, y, z);
            dst[i + 0] = Math.round(x * h);
            dst[i + 1] = Math.round(y * h);
            dst[i + 2] = Math.round(z * h);
            // keep dst[i + 3] as is
        }
    } else if (filter === 'QUATERNION') {
        assert(byteStride === 8);

        const dst = new Int16Array(target.buffer);

        for (let i = 0; i < 4 * elementCount; i += 4) {
            const inputW = dst[i + 3];
            const maxComponent = inputW & 0x03;
            const s = Math.SQRT1_2 / (inputW | 0x03);
            let x = dst[i + 0] * s;
            let y = dst[i + 1] * s;
            let z = dst[i + 2] * s;
            let w = Math.sqrt(Math.max(0.0, 1.0 - x**2 - y**2 - z**2));
            dst[i + (maxComponent + 1) % 4] = Math.round(x * 32767);
            dst[i + (maxComponent + 2) % 4] = Math.round(y * 32767);
            dst[i + (maxComponent + 3) % 4] = Math.round(z * 32767);
            dst[i + (maxComponent + 0) % 4] = Math.round(w * 32767);
        }
    } else if (filter === 'EXPONENTIAL') {
        assert((byteStride & 0x03) === 0x00);

        const src = new Int32Array(target.buffer);
        const dst = new Float32Array(target.buffer);
        for (let i = 0; i < (byteStride * elementCount) / 4; i++) {
            const v = src[i], exp = v >> 24, mantissa = (v << 8) >> 8;
            dst[i] = 2.0**exp * mantissa;
        }
    }
};

function pushfifo(fifo, n) {
    for (let i = fifo.length - 1; i > 0; i--)
        fifo[i] = fifo[i - 1];
    fifo[0] = n;
}

MeshoptDecoder.decodeIndexBuffer = (target, count, byteStride, source) => {
    assert(source[0] === 0xE1);
    assert(count % 3 === 0);
    assert(byteStride === 2 || byteStride === 4);

    let dst;
    if (byteStride === 2)
        dst = new Uint16Array(target.buffer);
    else
        dst = new Uint32Array(target.buffer);

    const triCount = count / 3;

    let codeOffs = 0x01;
    let dataOffs = codeOffs + triCount;
    let codeauxOffs = source.length - 0x10;

    function readLEB128() {
        let n = 0;
        for (let i = 0; ; i += 7) {
            const b = source[dataOffs++];
            n |= (b & 0x7F) << i;

            if (b < 0x80)
                return n;
        }
    }

    let next = 0, last = 0;
    const edgefifo = new Uint32Array(32);
    const vertexfifo = new Uint32Array(16);

    function decodeIndex(v) {
        return (last += dezig(v));
    }

    let dstOffs = 0;
    for (let i = 0; i < triCount; i++) {
        const code = source[codeOffs++];
        const b0 = code >>> 4, b1 = code & 0x0F;

        if (b0 < 0x0F) {
            const a = edgefifo[(b0 << 1) + 0], b = edgefifo[(b0 << 1) + 1];
            let c = -1;

            if (b1 === 0x00) {
                c = next++;
                pushfifo(vertexfifo, c);
            } else if (b1 < 0x0D) {
                c = vertexfifo[b1];
            } else if (b1 === 0x0D) {
                c = --last;
                pushfifo(vertexfifo, c);
            } else if (b1 === 0x0E) {
                c = ++last;
                pushfifo(vertexfifo, c);
            } else if (b1 === 0x0F) {
                const v = readLEB128();
                c = decodeIndex(v);
                pushfifo(vertexfifo, c);
            }

            // fifo pushes happen backwards
            pushfifo(edgefifo, b); pushfifo(edgefifo, c);
            pushfifo(edgefifo, c); pushfifo(edgefifo, a);

            dst[dstOffs++] = a;
            dst[dstOffs++] = b;
            dst[dstOffs++] = c;
        } else { // b0 === 0x0F
            let a = -1, b = -1, c = -1;

            if (b1 < 0x0E) {
                const e = source[codeauxOffs + b1];
                const z = e >>> 4, w = e & 0x0F;

                a = next++;

                if (z === 0x00)
                    b = next++;
                else
                    b = vertexfifo[z - 1];

                if (w === 0x00)
                    c = next++;
                else
                    c = vertexfifo[w - 1];

                pushfifo(vertexfifo, a);
                if (z === 0x00)
                    pushfifo(vertexfifo, b);
                if (w === 0x00)
                    pushfifo(vertexfifo, c);
            } else {
                const e = source[dataOffs++];
                if (e === 0x00)
                    next = 0;

                const z = e >>> 4, w = e & 0x0F;

                if (b1 === 0x0E)
                    a = next++;
                else
                    a = decodeIndex(readLEB128());

                if (z === 0x00)
                    b = next++;
                else if (z === 0x0F)
                    b = decodeIndex(readLEB128());
                else
                    b = vertexfifo[z - 1];

                if (w === 0x00)
                    c = next++;
                else if (w === 0x0F)
                    c = decodeIndex(readLEB128());
                else
                    c = vertexfifo[w - 1];

                pushfifo(vertexfifo, a);
                if (z === 0x00 || z === 0x0F)
                    pushfifo(vertexfifo, b);
                if (w === 0x00 || w === 0x0F)
                    pushfifo(vertexfifo, c);
            }

            pushfifo(edgefifo, a); pushfifo(edgefifo, b);
            pushfifo(edgefifo, b); pushfifo(edgefifo, c);
            pushfifo(edgefifo, c); pushfifo(edgefifo, a);

            dst[dstOffs++] = a;
            dst[dstOffs++] = b;
            dst[dstOffs++] = c;
        }
    }
};

MeshoptDecoder.decodeIndexSequence = (target, count, byteStride, source) => {
    assert(source[0] === 0xD1);
    assert(byteStride === 2 || byteStride === 4);

    let dst;
    if (byteStride === 2)
        dst = new Uint16Array(target.buffer);
    else
        dst = new Uint32Array(target.buffer);

    let dataOffs = 0x01;

    function readLEB128() {
        let n = 0;
        for (let i = 0; ; i += 7) {
            const b = source[dataOffs++];
            n |= (b & 0x7F) << i;

            if (b < 0x80)
                return n;
        }
    }

    const last = new Uint32Array(2);

    for (let i = 0; i < count; i++) {
        const v = readLEB128();
        const b = (v & 0x01);
        const delta = dezig(v >>> 1);
        dst[i] = (last[b] += delta);
    }
};

MeshoptDecoder.decodeGltfBuffer = (target, count, size, source, mode, filter) => {
    var table = {
        ATTRIBUTES: MeshoptDecoder.decodeVertexBuffer,
        TRIANGLES: MeshoptDecoder.decodeIndexBuffer,
        INDICES: MeshoptDecoder.decodeIndexSequence,
    };
    assert(table[mode] !== undefined);
    table[mode](target, count, size, source, filter);
};
    return MeshoptDecoder;
  })();
  function makeStatic(D) {
    var cfg = D.cfg, S = null, HT = cfg.ht;
    function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
    var img = new Image(), tex = new T.Texture(img); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = true;
    img.onload = function () { tex.needsUpdate = true; }; img.src = D.jpg;
    var uni = null;
    function fx(v) { return v.toFixed(2); }
    var mat = new T.MeshStandardMaterial({ map: tex, roughness: cfg.rough, metalness: 0, envMapIntensity: .85 });
    mat.onBeforeCompile = function (sh) {
      if (D.id === 'ninja') { // the red button and headband take the theme's colour
        sh.uniforms.uTint = H.tint; sh.uniforms.uTintOn = H.tintOn;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint;uniform float uTintOn;')
          .replace('#include <map_fragment>', '#include <map_fragment>\nif(uTintOn>0.5){vec3 c0=diffuseColor.rgb;float rd=clamp((c0.r-max(c0.g,c0.b))/max(c0.r,1e-3),0.0,1.0);' +
            'float tw=smoothstep(0.45,0.8,rd);diffuseColor.rgb=mix(c0,uTint*(c0.r*1.15+0.02),tw);}');
      }
      sh.uniforms.uHead = { value: new T.Vector3() }; sh.uniforms.uBr = { value: 0 }; sh.uniforms.uPiv = { value: new T.Vector3(cfg.px || 0, cfg.neck, cfg.pz || 0) }; uni = sh.uniforms;
      var hw = 'smoothstep(' + fx(cfg.n0) + ',' + fx(cfg.n1) + ',position.y)*(1.0-smoothstep(' + fx(cfg.a0) + ',' + fx(cfg.a1) + ',abs(position.x)))';
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uHead;uniform float uBr;uniform vec3 uPiv;\n' +
        'mat3 rotE(vec3 a){float cx=cos(a.x),sx=sin(a.x),cy=cos(a.y),sy=sin(a.y),cz=cos(a.z),sz=sin(a.z);mat3 X=mat3(1,0,0,0,cx,sx,0,-sx,cx),Y=mat3(cy,0,-sy,0,1,0,sy,0,cy),Z=mat3(cz,sz,0,-sz,cz,0,0,0,1);return Y*X*Z;}')
        .replace('#include <begin_vertex>', 'vec3 transformed=position;float hw=' + hw + ';transformed=uPiv+rotE(uHead*hw)*(position-uPiv);' +
          'float cw=smoothstep(' + fx(cfg.c0) + ',' + fx(cfg.c1) + ',position.y)*(1.0-smoothstep(' + fx(cfg.c2) + ',' + fx(cfg.c3) + ',position.y));transformed.xz*=1.0+uBr*cw;')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal=normal;objectNormal=rotE(uHead*(' + hw + '))*objectNormal;');
    };
    mat.customProgramCacheKey = function () { return 'st' + (D.id || '') + JSON.stringify(cfg); }; // each figure has its own shader
    function decode() {
      if (S) return S;
      if (D.mz) return (S = decodeMz());
      var buf = b64(D.bin), h = new Float32Array(buf, 0, 8), nv = h[0], nt = h[1], mn = [h[2], h[3], h[4]], mx = [h[5], h[6], h[7]], o = 32;
      var qp = new Uint16Array(buf, o, nv * 3); o += nv * 6; var qu = new Uint16Array(buf, o, nv * 2); o += nv * 4; var qn = new Int8Array(buf, o, nv * 3); o += nv * 3; if (o % 2) o++;
      var ix = nv < 65536 ? new Uint16Array(buf, o, nt * 3) : new Uint32Array(buf.slice(o), 0, nt * 3);
      var P = new Float32Array(nv * 3), U = new Float32Array(nv * 2), N = new Float32Array(nv * 3);
      for (var i = 0; i < nv; i++) { for (var k = 0; k < 3; k++) { P[3 * i + k] = mn[k] + qp[3 * i + k] / 65535 * (mx[k] - mn[k]); N[3 * i + k] = qn[3 * i + k] / 127; } U[2 * i] = qu[2 * i] / 65535; U[2 * i + 1] = qu[2 * i + 1] / 65535; }
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setAttribute('normal', new T.BufferAttribute(N, 3)); g.setAttribute('uv', new T.BufferAttribute(U, 2)); g.setIndex(new T.BufferAttribute(ix, 1));
      g.computeBoundingSphere(); return (S = g);
    }
    // mz = header (8 floats) + u32 vertex stream length + meshopt vertex stream (16 B: pos u16x3, pad, uv u16x2, normal i8x3, pad) + meshopt index stream (u32)
    function decodeMz() {
      var buf = b64(D.mz), h = new Float32Array(buf, 0, 8), nv = h[0], nt = h[1], mn = [h[2], h[3], h[4]], mx = [h[5], h[6], h[7]], vl = new Uint32Array(buf, 32, 1)[0];
      var V = new Uint8Array(nv * 16), ix = new Uint32Array(nt * 3);
      MZ.decodeVertexBuffer(V, nv, 16, new Uint8Array(buf, 36, vl));
      MZ.decodeIndexBuffer(new Uint8Array(ix.buffer), nt * 3, 4, new Uint8Array(buf, 36 + vl));
      var q = new Uint16Array(V.buffer), n8 = new Int8Array(V.buffer), P = new Float32Array(nv * 3), U = new Float32Array(nv * 2), N = new Float32Array(nv * 3);
      for (var i = 0; i < nv; i++) { for (var k = 0; k < 3; k++) { P[3 * i + k] = mn[k] + q[8 * i + k] / 65535 * (mx[k] - mn[k]); N[3 * i + k] = n8[16 * i + 12 + k] / 127; } U[2 * i] = q[8 * i + 4] / 65535; U[2 * i + 1] = q[8 * i + 5] / 65535; }
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(P, 3)); g.setAttribute('normal', new T.BufferAttribute(N, 3)); g.setAttribute('uv', new T.BufferAttribute(U, 2));
      g.setIndex(new T.BufferAttribute(nv < 65536 ? new Uint16Array(ix) : ix, 1)); g.computeBoundingSphere(); return g;
    }
    function build() {
      var g = decode(), root2 = new T.Group(), holder = new T.Group(), k0 = HT / 20;
      var mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; mesh.castShadow = true; holder.add(mesh); holder.scale.setScalar(k0); root2.add(holder);
      var sc = document.createElement('canvas'); sc.width = sc.height = 64; var cx = sc.getContext('2d'), gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
      var shm = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sc), transparent: true, depthWrite: false }));
      shm.rotation.x = -PI / 2; shm.scale.set(HT * cfg.shw, HT * cfg.shw * .7, 1); shm.position.y = .003; shm.renderOrder = -1; root2.add(shm);
      var seed = root.H3D_SEED != null ? root.H3D_SEED : Math.random() * 10, st0 = 0, lastS = '';
      function update(t, state, nohop) {
        t += seed;
        var off = state === 'off', wait = state === 'wait', pose = state === 'pose', p = (t * 1.7) % 100;
        if (state !== lastS) { st0 = t; lastS = state; }
        var yaw = 0, pit = 0, rol = 0, br, amp, bob = 0;
        if (off) { br = Math.sin(t * 1.1); amp = .012; pit = .42 + .03 * br; rol = -.1; }
        else if (wait) { br = Math.sin(t * 1.6); amp = .014; yaw = Math.sin(t * 1.5) * .5; pit = -.03; }
        else if (pose) { br = Math.sin(t * 1.9); amp = .014; yaw = .12; }
        else { br = Math.sin(t * 1.9); amp = .016; yaw = Math.sin(t * .7) * .18; rol = Math.sin(t * 1.1) * .07; pit = -.04 + Math.max(0, Math.sin(t * 5.6)) * .05;
          bob = Math.abs(Math.sin(t * 3.0)) * (.5 + .35 * Math.sin(t * .4)) * (1 - Math.min(1, (t - st0) / 1.5) * .55) * k0; }
        if (cfg.still) { pit = yaw = rol = bob = 0; amp *= .6; }
        if (nohop) bob = 0; // «Прыжки героя» off // people just stand and breathe (0.17.2)
        if (uni) { uni.uHead.value.set(pit, yaw, rol); uni.uBr.value = br * amp; }
        holder.position.y = bob;
      }
      update(0, 'pose');
      return { root: root2, update: update, height: HT, width: HT * cfg.w, headY: HT * cfg.hy, R: HT * cfg.r, model: true };
    }
    return build;
  }
  root.Hero3DModels = root.Hero3DModels || {};
  var made = {}, DATA = null;
  // registers the people once window.GIRLS3D = {models:{id:{bin,jpg,rig,clips,alias}}} is there
  root.Hero3DLoadModels = function () {
    if (DATA || !root.GIRLS3D || !root.GIRLS3D.models) return; DATA = root.GIRLS3D.models;
    Object.keys(DATA).forEach(function (id) { DATA[id].id = id; });
    Object.keys(DATA).forEach(function (id) { made[id] = make(DATA[id]); });
    root.Hero3DModels.meshy = function (o) { var id = DATA[o.char] ? o.char : Object.keys(DATA)[0]; return (made[id] = made[id] || make(DATA[id]))(o); };
  };
  root.Hero3DLoadModels();
})(typeof window !== 'undefined' ? window : this);
