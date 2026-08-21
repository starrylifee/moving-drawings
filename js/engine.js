/* engine.js — 그림 캐릭터 애니메이션 엔진
 * 좌표계: 이미지 픽셀 좌표(원점 왼쪽 위, y 아래로 증가). 각도는 라디안.
 * 뼈 회전은 부모 사슬을 따라 전파되고, 정점은 가까운 뼈 2개의 가중 평균으로 움직인다(LBS).
 */
"use strict";

/* ---------- 스켈레톤 정의 ---------- */
const JOINT_NAMES = [
  "hips", "chest", "neck", "head",
  "shoulderL", "elbowL", "handL", "shoulderR", "elbowR", "handR",
  "hipL", "kneeL", "footL", "hipR", "kneeR", "footR",
];

/* radius: 캐릭터 키(H) 대비 뼈 영향 반경. 몸통은 넓게, 팔다리는 좁게. */
const BONES = [
  { name: "spine",  from: "hips",      to: "chest",  parent: null,    radius: 0.30 },
  { name: "neckB",  from: "chest",     to: "neck",   parent: "spine", radius: 0.10 },
  { name: "headB",  from: "neck",      to: "head",   parent: "neckB", radius: 0.26 },
  { name: "clavL",  from: "chest",     to: "shoulderL", parent: "spine", radius: 0.07 },
  { name: "uarmL",  from: "shoulderL", to: "elbowL", parent: "clavL", radius: 0.085 },
  { name: "farmL",  from: "elbowL",    to: "handL",  parent: "uarmL", radius: 0.085 },
  { name: "clavR",  from: "chest",     to: "shoulderR", parent: "spine", radius: 0.07 },
  { name: "uarmR",  from: "shoulderR", to: "elbowR", parent: "clavR", radius: 0.085 },
  { name: "farmR",  from: "elbowR",    to: "handR",  parent: "uarmR", radius: 0.085 },
  { name: "pelvL",  from: "hips",      to: "hipL",   parent: null,    radius: 0.10 },
  { name: "thighL", from: "hipL",      to: "kneeL",  parent: "pelvL", radius: 0.09 },
  { name: "shinL",  from: "kneeL",     to: "footL",  parent: "thighL", radius: 0.09 },
  { name: "pelvR",  from: "hips",      to: "hipR",   parent: null,    radius: 0.10 },
  { name: "thighR", from: "hipR",      to: "kneeR",  parent: "pelvR", radius: 0.09 },
  { name: "shinR",  from: "kneeR",     to: "footR",  parent: "thighR", radius: 0.09 },
];

/* 관절 초기 배치 템플릿 (잘라낸 그림의 가로·세로 비율 좌표) */
const JOINT_TEMPLATE = {
  hips: [0.50, 0.55], chest: [0.50, 0.35], neck: [0.50, 0.24], head: [0.50, 0.06],
  shoulderL: [0.34, 0.30], elbowL: [0.24, 0.44], handL: [0.17, 0.58],
  shoulderR: [0.66, 0.30], elbowR: [0.76, 0.44], handR: [0.83, 0.58],
  hipL: [0.42, 0.58], kneeL: [0.40, 0.76], footL: [0.39, 0.95],
  hipR: [0.58, 0.58], kneeR: [0.60, 0.76], footR: [0.61, 0.95],
};

/* 관절 한국어 이름 (UI 안내용) */
const JOINT_LABELS = {
  hips: "엉덩이", chest: "가슴", neck: "목", head: "머리 끝",
  shoulderL: "왼쪽 어깨", elbowL: "왼쪽 팔꿈치", handL: "왼손",
  shoulderR: "오른쪽 어깨", elbowR: "오른쪽 팔꿈치", handR: "오른손",
  hipL: "왼쪽 골반", kneeL: "왼쪽 무릎", footL: "왼발",
  hipR: "오른쪽 골반", kneeR: "오른쪽 무릎", footR: "오른발",
};

function defaultJoints(w, h) {
  const j = {};
  for (const k in JOINT_TEMPLATE) j[k] = [JOINT_TEMPLATE[k][0] * w, JOINT_TEMPLATE[k][1] * h];
  return j;
}

/* ---------- 리그(뼈대 결합) ---------- */
/* cutoutCanvas: 배경이 투명한 RGBA 캔버스, joints: {이름:[x,y]} (캔버스 픽셀 좌표) */
function buildRig(cutoutCanvas, joints) {
  const w = cutoutCanvas.width, h = cutoutCanvas.height;
  const ctx = cutoutCanvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h).data;

  /* 격자 메시: 알파가 있는 칸만 포함 */
  const COLS = 44;
  const cell = Math.max(2, Math.ceil(Math.max(w, h) / COLS));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);

  const cellHasInk = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * cell, y0 = gy * cell;
      const x1 = Math.min(w, x0 + cell), y1 = Math.min(h, y0 + cell);
      let ink = 0;
      for (let y = y0; y < y1 && !ink; y += 2)
        for (let x = x0; x < x1; x += 2)
          if (img[(y * w + x) * 4 + 3] > 12) { ink = 1; break; }
      cellHasInk[gy * gw + gx] = ink;
    }
  }

  /* 정점 인덱스 압축 */
  const vmap = new Int32Array((gw + 1) * (gh + 1)).fill(-1);
  const verts = []; // [x,y] 픽셀
  function vid(gx, gy) {
    const key = gy * (gw + 1) + gx;
    if (vmap[key] < 0) { vmap[key] = verts.length / 2; verts.push(Math.min(gx * cell, w), Math.min(gy * cell, h)); }
    return vmap[key];
  }
  const indices = [];
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++)
      if (cellHasInk[gy * gw + gx]) {
        const a = vid(gx, gy), b = vid(gx + 1, gy), c = vid(gx, gy + 1), d = vid(gx + 1, gy + 1);
        indices.push(a, b, c, b, d, c);
      }

  const nv = verts.length / 2;
  const restPos = new Float32Array(verts);
  const uvs = new Float32Array(nv * 2);
  for (let i = 0; i < nv; i++) { uvs[i * 2] = restPos[i * 2] / w; uvs[i * 2 + 1] = restPos[i * 2 + 1] / h; }

  /* 스키닝 가중치: 뼈 선분까지의 거리(영향 반경으로 정규화) 상위 2개 */
  const H = h;
  const boneIdx = new Int16Array(nv * 2);
  const boneW = new Float32Array(nv * 2);
  const nb = BONES.length;
  const segs = BONES.map((b) => {
    const p = joints[b.from], q = joints[b.to];
    return { px: p[0], py: p[1], dx: q[0] - p[0], dy: q[1] - p[1], r: b.radius * H };
  });
  for (let i = 0; i < nv; i++) {
    const x = restPos[i * 2], y = restPos[i * 2 + 1];
    let b1 = 0, w1 = 0, b2 = 0, w2 = 0;
    for (let bi = 0; bi < nb; bi++) {
      const s = segs[bi];
      const len2 = s.dx * s.dx + s.dy * s.dy || 1;
      let t = ((x - s.px) * s.dx + (y - s.py) * s.dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (s.px + s.dx * t), ey = y - (s.py + s.dy * t);
      const dn = Math.sqrt(ex * ex + ey * ey) / s.r; // 정규화 거리
      const wgt = 1 / (dn * dn * dn * dn + 0.02);
      if (wgt > w1) { b2 = b1; w2 = w1; b1 = bi; w1 = wgt; }
      else if (wgt > w2) { b2 = bi; w2 = wgt; }
    }
    const sum = w1 + w2 || 1;
    boneIdx[i * 2] = b1; boneIdx[i * 2 + 1] = b2;
    boneW[i * 2] = w1 / sum; boneW[i * 2 + 1] = w2 / sum;
  }

  /* 뼈 정적 정보: 부모 인덱스, 휴식 자세 방향각 */
  const parentIdx = BONES.map((b) => (b.parent ? BONES.findIndex((x) => x.name === b.parent) : -1));
  const restDir = BONES.map((b) => {
    const p = joints[b.from], q = joints[b.to];
    return Math.atan2(q[1] - p[1], q[0] - p[0]);
  });

  /* 발바닥 기준선(스쿼시용)과 기준점(발 가운데) */
  const groundY = h;
  const anchorX = ((joints.footL[0] + joints.footR[0]) / 2 + joints.hips[0]) / 2;

  return {
    canvas: cutoutCanvas, w, h, H, joints, restPos, uvs, indices: new Uint32Array(indices),
    boneIdx, boneW, parentIdx, restDir, groundY, anchorX, nv,
  };
}

/* ---------- 자세 계산 ----------
 * pose: { local:{뼈:라디안}, world:{뼈:월드 방향각(절대)}, root:[dx,dy](키 비율), squash:1.0 }
 * 반환: 뼈별 변환 {ang, fx0, fy0, fx1, fy1} — v' = from1 + R(ang)(v - from0)
 */
function computeBoneTransforms(rig, pose) {
  const local = pose.local || {}, world = pose.world || {};
  const rootDx = (pose.root ? pose.root[0] : 0) * rig.H;
  const rootDy = (pose.root ? pose.root[1] : 0) * rig.H;
  const J = rig.joints;
  const newPos = { hips: [J.hips[0] + rootDx, J.hips[1] + rootDy] };
  const worldRot = new Float32Array(BONES.length);
  const out = [];
  for (let bi = 0; bi < BONES.length; bi++) {
    const b = BONES[bi];
    const pRot = rig.parentIdx[bi] >= 0 ? worldRot[rig.parentIdx[bi]] : 0;
    let ang;
    if (world[b.name] != null) ang = world[b.name] - rig.restDir[bi]; // 절대 방향 지정
    else ang = pRot + (local[b.name] || 0);
    worldRot[bi] = ang;
    const p0 = J[b.from], p1 = J[b.to];
    const base = newPos[b.from] || p0;
    const c = Math.cos(ang), s = Math.sin(ang);
    const vx = p1[0] - p0[0], vy = p1[1] - p0[1];
    newPos[b.to] = [base[0] + c * vx - s * vy, base[1] + s * vx + c * vy];
    out.push({ c, s, fx0: p0[0], fy0: p0[1], fx1: base[0], fy1: base[1] });
  }
  return { transforms: out, newJoints: newPos };
}

/* 정점 변형: outArr(Float32Array nv*2)에 기록. squash는 발바닥 기준 세로 눌림. */
function deformVertices(rig, boneTr, squash, outArr) {
  const { restPos, boneIdx, boneW, nv, groundY } = rig;
  const T = boneTr.transforms;
  const sq = squash || 1;
  for (let i = 0; i < nv; i++) {
    const x = restPos[i * 2], y = restPos[i * 2 + 1];
    let ox = 0, oy = 0;
    for (let k = 0; k < 2; k++) {
      const t = T[boneIdx[i * 2 + k]], w = boneW[i * 2 + k];
      const rx = x - t.fx0, ry = y - t.fy0;
      ox += w * (t.fx1 + t.c * rx - t.s * ry);
      oy += w * (t.fy1 + t.s * rx + t.c * ry);
    }
    if (sq !== 1) {
      oy = groundY - (groundY - oy) * sq;
      const cx = rig.anchorX;
      ox = cx + (ox - cx) * (1 + (1 - sq) * 0.5);
    }
    outArr[i * 2] = ox; outArr[i * 2 + 1] = oy;
  }
}

/* ---------- WebGL 렌더러 ---------- */
function createGL(canvas) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) throw new Error("WebGL을 사용할 수 없습니다.");
  const vs = `attribute vec2 aPos; attribute vec2 aUV; uniform vec2 uView; varying vec2 vUV;
    void main(){ vUV=aUV; vec2 clip = vec2(aPos.x/uView.x*2.0-1.0, 1.0-aPos.y/uView.y*2.0);
    gl_Position = vec4(clip,0.0,1.0); }`;
  const fs = `precision mediump float; varying vec2 vUV; uniform sampler2D uTex;
    void main(){ gl_FragColor = texture2D(uTex, vUV); }`;
  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const ext = gl.getExtension("OES_element_index_uint");
  return {
    gl, prog, uView: gl.getUniformLocation(prog, "uView"),
    aPos: gl.getAttribLocation(prog, "aPos"), aUV: gl.getAttribLocation(prog, "aUV"),
    uintIndex: !!ext,
  };
}

/* 캐릭터 인스턴스: 리그 + 무대 위치/크기 + 동작 */
function createInstance(G, rig, opts) {
  const gl = G.gl;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, rig.canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, rig.nv * 2 * 4, gl.DYNAMIC_DRAW);
  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, rig.uvs, gl.STATIC_DRAW);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  const use32 = G.uintIndex && rig.nv > 65000;
  const idxArr = use32 ? rig.indices : new Uint16Array(rig.indices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxArr, gl.STATIC_DRAW);

  return {
    rig, tex, posBuf, uvBuf, idxBuf, idxCount: rig.indices.length, idxType: use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    scratch: new Float32Array(rig.nv * 2),
    x: opts.x || 0, y: opts.y || 0, scale: opts.scale || 1,
    motionId: opts.motionId || "dance1", phase: opts.phase || 0,
    name: opts.name || "",
  };
}

/* 한 프레임 그리기. instances 순서대로. timeSec: 초. */
function renderFrame(G, canvas, instances, timeSec) {
  const gl = G.gl;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(G.uView, canvas.width, canvas.height);

  for (const inst of instances) {
    const rig = inst.rig;
    const m = MOTIONS[inst.motionId] || MOTIONS.idle;
    const tn = ((timeSec + inst.phase) % m.period) / m.period;
    const pose = m.fn(tn);
    const boneTr = computeBoneTransforms(rig, pose);
    deformVertices(rig, boneTr, pose.squash, inst.scratch);

    /* 무대 배치: 기준점(발 가운데)을 (x, y)에 두고 scale 적용 */
    const s = inst.scale, ax = rig.anchorX, ay = rig.groundY;
    const arr = inst.scratch;
    for (let i = 0; i < rig.nv; i++) {
      arr[i * 2] = inst.x + (arr[i * 2] - ax) * s;
      arr[i * 2 + 1] = inst.y + (arr[i * 2 + 1] - ay) * s;
    }

    gl.bindTexture(gl.TEXTURE_2D, inst.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
    gl.enableVertexAttribArray(G.aPos);
    gl.vertexAttribPointer(G.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.uvBuf);
    gl.enableVertexAttribArray(G.aUV);
    gl.vertexAttribPointer(G.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, inst.idxBuf);
    gl.drawElements(gl.TRIANGLES, inst.idxCount, inst.idxType, 0);
  }
}

/* ---------- 배경 ---------- */
const BACKGROUNDS = {
  white:   { label: "하양" },
  stage:   { label: "무대" },
  grass:   { label: "잔디밭" },
  sky:     { label: "하늘" },
  night:   { label: "밤하늘" },
  space:   { label: "우주" },
};

function drawBackground(ctx, w, h, id) {
  ctx.clearRect(0, 0, w, h);
  if (id === "white") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); return; }
  if (id === "stage") {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#5b1220"); g.addColorStop(1, "#8c1d33");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    /* 커튼 주름 */
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let x = 0; x < w; x += w / 14) ctx.fillRect(x, 0, w / 40, h * 0.62);
    /* 무대 바닥 */
    ctx.fillStyle = "#6b4a2b"; ctx.fillRect(0, h * 0.72, w, h * 0.28);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    for (let x = 0; x < w; x += w / 9) ctx.fillRect(x, h * 0.72, 2, h * 0.28);
    /* 스포트라이트 */
    const sp = ctx.createRadialGradient(w / 2, h * 0.75, 10, w / 2, h * 0.75, w * 0.45);
    sp.addColorStop(0, "rgba(255,240,190,0.30)"); sp.addColorStop(1, "rgba(255,240,190,0)");
    ctx.fillStyle = sp; ctx.fillRect(0, 0, w, h);
    return;
  }
  if (id === "grass") {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#aee3ff"); g.addColorStop(0.66, "#dff4ff");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#7ec850"; ctx.fillRect(0, h * 0.68, w, h * 0.32);
    ctx.fillStyle = "#6ab43e";
    for (let x = 0; x < w; x += 14) ctx.fillRect(x, h * 0.68, 7, 6);
    ctx.fillStyle = "#ffd93d";
    ctx.beginPath(); ctx.arc(w * 0.85, h * 0.16, Math.min(w, h) * 0.07, 0, 7); ctx.fill();
    return;
  }
  if (id === "sky") {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#6db6ff"); g.addColorStop(1, "#cfeaff");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const [cx, cy, r] of [[0.2, 0.22, 0.05], [0.26, 0.20, 0.065], [0.32, 0.23, 0.05], [0.7, 0.34, 0.055], [0.76, 0.32, 0.07], [0.82, 0.35, 0.05]]) {
      ctx.beginPath(); ctx.arc(w * cx, h * cy, Math.min(w, h) * r, 0, 7); ctx.fill();
    }
    return;
  }
  if (id === "night" || id === "space") {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (id === "night") { g.addColorStop(0, "#0b1d3a"); g.addColorStop(1, "#1d3a6b"); }
    else { g.addColorStop(0, "#0b0b23"); g.addColorStop(1, "#26124d"); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    /* 고정 시드 별 */
    let seed = 42;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w, y = rnd() * h * (id === "night" ? 0.7 : 1), r = rnd() * 1.8 + 0.4;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    if (id === "night") {
      ctx.fillStyle = "#f4f1c1";
      ctx.beginPath(); ctx.arc(w * 0.82, h * 0.18, Math.min(w, h) * 0.06, 0, 7); ctx.fill();
      ctx.fillStyle = "#16305c"; ctx.fillRect(0, h * 0.86, w, h * 0.14);
    } else {
      ctx.fillStyle = "#e8734a";
      ctx.beginPath(); ctx.arc(w * 0.15, h * 0.25, Math.min(w, h) * 0.05, 0, 7); ctx.fill();
      ctx.strokeStyle = "#f2a25c"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(w * 0.15, h * 0.25, Math.min(w, h) * 0.09, Math.min(w, h) * 0.03, -0.3, 0, 7); ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
}
