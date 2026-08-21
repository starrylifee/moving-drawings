/* cutout.js — 종이 사진에서 그림만 오려내기
 * 흰 종이 배경을 테두리에서부터 물들이기(BFS)로 지운다. 학생이 브러시로 손질할 수 있다.
 */
"use strict";

/* 파일/데이터URL → 캔버스 (최대 한 변 maxSide로 축소) */
function imageToCanvas(imgEl, maxSide) {
  const w0 = imgEl.naturalWidth || imgEl.width, h0 = imgEl.naturalHeight || imgEl.height;
  const sc = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(imgEl, 0, 0, w, h);
  return c;
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 열 수 없습니다.")); };
    img.src = url;
  });
}

/* 자동 배경 판정 — mask(Uint8Array): 1=그림, 0=배경 */
function autoMask(srcCanvas, brightness) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const d = srcCanvas.getContext("2d").getImageData(0, 0, w, h).data;
  const thr = brightness == null ? 200 : brightness;
  const n = w * h;
  const bgLike = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    bgLike[i] = lum > thr && mx - mn < 70 ? 1 : 0;
  }
  /* 테두리의 배경색 픽셀에서 안쪽으로 번지기 */
  const mask = new Uint8Array(n).fill(1);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  const seen = new Uint8Array(n);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !bgLike[i]) continue;
    seen[i] = 1; mask[i] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  /* 자잘한 먼지 제거: 아주 작은 그림 조각은 배경 취급 */
  removeSpecks(mask, w, h, Math.max(24, (n * 0.0004) | 0));
  return mask;
}

/* 작은 연결 조각 제거 — 단, 가장 큰 조각(그림 본체)은 절대 지우지 않는다.
 * 멀리서 찍어 그림이 아주 작아도 본체가 "먼지"로 삭제되는 사고 방지. */
function removeSpecks(mask, w, h, minSize) {
  const n = w * h;
  const lab = new Int32Array(n).fill(-1);
  const stack = [];
  const comps = []; // {members, count}
  for (let i = 0; i < n; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const members = [];
    stack.push(i); lab[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      members.push(j);
      const x = j % w, y = (j / w) | 0;
      if (x > 0 && mask[j - 1] && lab[j - 1] < 0) { lab[j - 1] = 1; stack.push(j - 1); }
      if (x < w - 1 && mask[j + 1] && lab[j + 1] < 0) { lab[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && mask[j - w] && lab[j - w] < 0) { lab[j - w] = 1; stack.push(j - w); }
      if (y < h - 1 && mask[j + w] && lab[j + w] < 0) { lab[j + w] = 1; stack.push(j + w); }
    }
    comps.push(members);
  }
  const biggest = comps.reduce((a, b) => (b.length > a.length ? b : a), []);
  for (const members of comps) {
    if (members !== biggest && members.length < minSize)
      for (const j of members) mask[j] = 0;
  }
}

/* 마스크를 알파로 적용해 미리보기 캔버스에 그리기 */
function paintMasked(srcCanvas, mask, outCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  outCanvas.width = w; outCanvas.height = h;
  const sctx = srcCanvas.getContext("2d");
  const octx = outCanvas.getContext("2d");
  const id = sctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < w * h; i++) d[i * 4 + 3] = mask[i] ? 255 : 0;
  octx.putImageData(id, 0, 0);
}

/* 마스크 영역으로 잘라 최종 캐릭터 캔버스 만들기 (여백 포함)
 * 반환: { canvas, x0, y0 } — x0,y0은 원본에서 잘라낸 시작 좌표(관절 좌표 변환용) */
function cropCutout(srcCanvas, mask) {
  const w = srcCanvas.width, h = srcCanvas.height;
  let x0 = w, y0 = h, x1 = 0, y1 = 0, any = false;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        any = true;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (!any) return null;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03) + 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

  const masked = document.createElement("canvas");
  paintMasked(srcCanvas, mask, masked);
  const out = document.createElement("canvas");
  out.width = cw; out.height = ch;
  out.getContext("2d").drawImage(masked, x0, y0, cw, ch, 0, 0, cw, ch);
  return { canvas: out, x0, y0 };
}

/* 브러시: cx,cy 중심 반지름 r을 지우기(0) 또는 살리기(1) */
function brushMask(mask, w, h, cx, cy, r, value) {
  const r2 = r * r;
  const yA = Math.max(0, Math.floor(cy - r)), yB = Math.min(h - 1, Math.ceil(cy + r));
  const xA = Math.max(0, Math.floor(cx - r)), xB = Math.min(w - 1, Math.ceil(cx + r));
  for (let y = yA; y <= yB; y++)
    for (let x = xA; x <= xB; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) mask[y * w + x] = value;
    }
}

/* ---------- 예시 그림 (크레용 느낌 캐릭터) ---------- */
function drawSampleCharacter() {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 800;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 640, 800);
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  /* 살짝 흔들리는 선 — 손그림 느낌 */
  function wob(x, y, k) { return [x + Math.sin(y * 0.05 + k) * 2.5, y + Math.cos(x * 0.05 + k) * 2.5]; }
  function stroke(pts, color, width, k) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const [wx, wy] = wob(x, y, k || 0);
      i ? ctx.lineTo(wx, wy) : ctx.moveTo(wx, wy);
    });
    ctx.stroke();
  }

  /* 머리 */
  ctx.fillStyle = "#ffe0b8";
  ctx.strokeStyle = "#e8a13c"; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(320, 150, 105, 0, 7); ctx.fill(); ctx.stroke();
  /* 머리카락 */
  ctx.strokeStyle = "#6b4423"; ctx.lineWidth = 12;
  for (let a = -2.6; a < -0.5; a += 0.28) {
    ctx.beginPath();
    ctx.arc(320, 140, 108, a, a + 0.22); ctx.stroke();
  }
  /* 눈, 볼, 입 */
  ctx.fillStyle = "#333";
  ctx.beginPath(); ctx.arc(283, 140, 12, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(357, 140, 12, 0, 7); ctx.fill();
  ctx.fillStyle = "#ffb3ab";
  ctx.beginPath(); ctx.arc(265, 178, 14, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(375, 178, 14, 0, 7); ctx.fill();
  ctx.strokeStyle = "#d0543c"; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(320, 180, 34, 0.35, Math.PI - 0.35); ctx.stroke();

  /* 몸통(티셔츠) */
  ctx.fillStyle = "#57b8ff";
  ctx.strokeStyle = "#2e7cc0"; ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(255, 262); ctx.lineTo(385, 262);
  ctx.lineTo(402, 445); ctx.lineTo(238, 445); ctx.closePath();
  ctx.fill(); ctx.stroke();
  /* 티셔츠 무늬 */
  ctx.fillStyle = "#ffd93d";
  ctx.beginPath(); ctx.arc(320, 355, 38, 0, 7); ctx.fill();
  ctx.fillStyle = "#e8734a";
  ctx.beginPath(); ctx.arc(320, 355, 20, 0, 7); ctx.fill();

  /* 팔 */
  stroke([[258, 285], [205, 360], [172, 445]], "#ffe0b8", 34, 1);
  stroke([[258, 285], [205, 360], [172, 445]], "#e8a13c", 8, 1);
  stroke([[382, 285], [435, 360], [468, 445]], "#ffe0b8", 34, 2);
  stroke([[382, 285], [435, 360], [468, 445]], "#e8a13c", 8, 2);
  /* 손 */
  ctx.fillStyle = "#ffe0b8"; ctx.strokeStyle = "#e8a13c"; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(168, 458, 24, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(472, 458, 24, 0, 7); ctx.fill(); ctx.stroke();

  /* 바지 */
  ctx.fillStyle = "#7a6ff0";
  ctx.strokeStyle = "#4d44b5"; ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(245, 445); ctx.lineTo(395, 445);
  ctx.lineTo(388, 530); ctx.lineTo(348, 530); ctx.lineTo(340, 483);
  ctx.lineTo(300, 483); ctx.lineTo(292, 530); ctx.lineTo(252, 530); ctx.closePath();
  ctx.fill(); ctx.stroke();

  /* 다리 */
  stroke([[285, 528], [280, 620], [276, 700]], "#ffe0b8", 30, 3);
  stroke([[285, 528], [280, 620], [276, 700]], "#e8a13c", 7, 3);
  stroke([[355, 528], [360, 620], [364, 700]], "#ffe0b8", 30, 4);
  stroke([[355, 528], [360, 620], [364, 700]], "#e8a13c", 7, 4);
  /* 신발 */
  ctx.fillStyle = "#e84a5f"; ctx.strokeStyle = "#b03248"; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.ellipse(266, 722, 40, 22, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(374, 722, 40, 22, 0, 0, 7); ctx.fill(); ctx.stroke();

  return c;
}

/* 예시 캐릭터의 관절 (샘플 그림 좌표 기준, cropCutout 후 좌표가 아니라 원본 640x800 기준) */
const SAMPLE_JOINTS_RAW = {
  head: [320, 42], neck: [320, 252], chest: [320, 300], hips: [320, 452],
  shoulderL: [262, 288], elbowL: [205, 362], handL: [168, 452],
  shoulderR: [378, 288], elbowR: [435, 362], handR: [472, 452],
  hipL: [287, 500], kneeL: [281, 618], footL: [272, 710],
  hipR: [353, 500], kneeR: [359, 618], footR: [368, 710],
};

/* 예시 캐릭터를 즉시 사용할 수 있게 만드는 공용 헬퍼 (무대 데모·튜토리얼용).
 * 크롭 원점을 실제 값으로 반영해 관절이 정확히 맞는다. */
function sampleCharacter(maxSide) {
  const src = drawSampleCharacter();
  const mask = autoMask(src, 200);
  const { canvas: cut0, x0, y0 } = cropCutout(src, mask);
  let cut = cut0, sc = 1;
  if (maxSide && Math.max(cut0.width, cut0.height) > maxSide) {
    sc = maxSide / Math.max(cut0.width, cut0.height);
    cut = document.createElement("canvas");
    cut.width = Math.round(cut0.width * sc);
    cut.height = Math.round(cut0.height * sc);
    cut.getContext("2d").drawImage(cut0, 0, 0, cut.width, cut.height);
  }
  const joints = {};
  for (const k in SAMPLE_JOINTS_RAW) {
    joints[k] = [
      Math.max(0, Math.min(cut.width, (SAMPLE_JOINTS_RAW[k][0] - x0) * sc)),
      Math.max(0, Math.min(cut.height, (SAMPLE_JOINTS_RAW[k][1] - y0) * sc)),
    ];
  }
  return { canvas: cut, joints };
}

/* ---------- 캐릭터 파일 저장/불러오기 ---------- */
const CHAR_FILE_VER = 1;

function characterToJSON(cutoutCanvas, joints, name) {
  /* webp가 훨씬 작다. 지원 안 되면 png. */
  let url = cutoutCanvas.toDataURL("image/webp", 0.9);
  if (!url.startsWith("data:image/webp")) url = cutoutCanvas.toDataURL("image/png");
  return JSON.stringify({
    app: "moving-drawings", ver: CHAR_FILE_VER,
    name: name || "",
    w: cutoutCanvas.width, h: cutoutCanvas.height,
    joints, image: url,
  });
}

function parseCharacterJSON(text) {
  const o = JSON.parse(text);
  if (o.app !== "moving-drawings" || !o.image || !o.joints) throw new Error("캐릭터 파일이 아닙니다.");
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = o.w || img.width; c.height = o.h || img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      resolve({ canvas: c, joints: o.joints, name: o.name || "" });
    };
    img.onerror = () => reject(new Error("캐릭터 이미지를 읽을 수 없습니다."));
    img.src = o.image;
  });
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
