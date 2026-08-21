/* stage.js — 교사용 무대: 캐릭터 파일들을 모아 한 화면 군무 */
"use strict";

const $ = (id) => document.getElementById(id);
const W = 1920, H = 1080;

const stage = {
  glCanvas: null, G: null,
  chars: [],       // {inst, name}
  bgId: "stage",
  paused: false, pauseT: 0,
  raf: 0, t0: performance.now(),
};

function toast(msg, ms) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove("show"), ms || 2600);
}

/* ---------- 초기화 ---------- */
stage.glCanvas = document.createElement("canvas");
stage.glCanvas.width = W; stage.glCanvas.height = H;
stage.G = createGL(stage.glCanvas);

const selBg = $("selBg");
for (const id in BACKGROUNDS) {
  const o = document.createElement("option");
  o.value = id; o.textContent = "배경: " + BACKGROUNDS[id].label;
  if (id === "stage") o.selected = true;
  selBg.appendChild(o);
}
selBg.addEventListener("change", () => { stage.bgId = selBg.value; });

const selMotion = $("selMotion");
{
  const o0 = document.createElement("option");
  o0.value = ""; o0.textContent = "🎬 동작 고르기 (전원 통일)";
  selMotion.appendChild(o0);
  for (const id of MOTION_ORDER) {
    const o = document.createElement("option");
    o.value = id; o.textContent = MOTIONS[id].emoji + " " + MOTIONS[id].label;
    selMotion.appendChild(o);
  }
  selMotion.addEventListener("change", () => {
    if (!selMotion.value) return;
    for (const c of stage.chars) { c.inst.motionId = selMotion.value; c.inst.phase = 0; }
  });
}

$("btnShuffle").addEventListener("click", () => {
  for (const c of stage.chars) {
    c.inst.motionId = MOTION_ORDER[(Math.random() * MOTION_ORDER.length) | 0];
    c.inst.phase = Math.random() * 3;
  }
  selMotion.value = "";
  toast("모두 제각각 춤춰요! 🎲");
});

/* ---------- 파일 불러오기 ---------- */
$("btnLoad").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });

const zone = $("stageZone");
zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
zone.addEventListener("drop", (e) => {
  e.preventDefault();
  zone.classList.remove("dragover");
  addFiles([...e.dataTransfer.files]);
});

const loadedKeys = new Set(); // 중복 제출·중복 드래그 방지

async function addFiles(files) {
  let ok = 0, fail = 0, dup = 0;
  let i = 0;
  for (const f of files) {
    i++;
    if (files.length > 3) $("countChip").textContent = `올라오는 중... ${i}/${files.length}`;
    try {
      const text = await f.text();
      const key = (JSON.parse(text).name || "") + ":" + text.length;
      if (loadedKeys.has(key)) { dup++; continue; }
      const { canvas, joints, name } = await parseCharacterJSON(text);
      addCharacter(canvas, joints, name);
      loadedKeys.add(key);
      ok++;
    } catch (err) { fail++; }
  }
  const parts = [];
  if (ok) parts.push(`${ok}명이 무대에 올라왔어요! 🎉`);
  if (dup) parts.push(`${dup}명은 이미 무대에 있어서 건너뛰었어요`);
  if (fail) parts.push(`${fail}개는 캐릭터 파일이 아니에요`);
  if (parts.length) toast(parts.join(" · "), 3400);
  else toast("캐릭터 파일이 아니에요. 학생 화면에서 저장한 .캐릭터.json 파일을 올려 주세요.", 3400);
  relayout();
}

function addCharacter(canvas, joints, name) {
  const rig = buildRig(canvas, joints);
  const inst = createInstance(stage.G, rig, {
    x: 0, y: 0, scale: 1,
    motionId: MOTION_ORDER[(Math.random() * 4) | 0],
    phase: Math.random() * 3,
  });
  stage.chars.push({ inst, name: name || "" });
}

/* 캐릭터 한 명만 무대에서 내리기 (GPU 자원도 해제) */
function removeCharacter(idx) {
  const c = stage.chars[idx];
  disposeInstance(stage.G, c.inst);
  stage.chars.splice(idx, 1);
  relayout();
  toast((c.name || "친구") + "를 무대에서 내렸어요. (파일은 그대로 있어요)", 2600);
}

/* 예시 친구들 */
$("btnDemo").addEventListener("click", () => {
  const names = ["방방이", "댄스왕", "씰룩이"];
  for (let i = 0; i < 3; i++) {
    const { canvas, joints } = sampleCharacter(760);
    addCharacter(canvas, joints, names[i]);
  }
  relayout();
  toast("예시 친구 3명이 올라왔어요!");
});

/* ---------- 배치 ---------- */
function relayout() {
  const n = stage.chars.length;
  $("dropHint").style.display = n ? "none" : "flex";
  $("countChip").textContent = `무대 위 ${n}명`;
  if (!n) return;

  const rows = n <= 6 ? 1 : n <= 14 ? 2 : 3;
  const perRow = Math.ceil(n / rows);
  const charH = Math.min(H * 0.52, (H * 0.78) / rows);
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(perRow, n - i);
    /* 뒷줄(위)은 살짝 작게 — 원근감 */
    const rowH = charH * (1 - 0.12 * (rows - 1 - r));
    const y = H * 0.9 - (rows - 1 - r) * charH * 0.62;
    for (let k = 0; k < inRow; k++, i++) {
      const c = stage.chars[i];
      c.inst.scale = rowH / c.inst.rig.H;
      c.inst.x = (W * (k + 0.5)) / inRow + (r % 2 ? W * 0.02 : -W * 0.02);
      c.inst.y = y;
    }
  }
}

/* 무대 좌표에서 캐릭터 찾기 — 렌더 기준(발 중심 anchorX)과 같은 계산 사용 */
function hitCharacter(ev) {
  const cv = $("stageCanvas");
  const r = cv.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * W;
  const y = ((ev.clientY - r.top) / r.height) * H;
  for (let i = stage.chars.length - 1; i >= 0; i--) {
    const c = stage.chars[i];
    const s = c.inst.scale;
    const left = c.inst.x - c.inst.rig.anchorX * s;
    const top = c.inst.y - c.inst.rig.H * s;
    if (x > left && x < left + c.inst.rig.w * s && y > top && y < c.inst.y + 10) return i;
  }
  return -1;
}

/* 클릭 → 그 캐릭터만 다음 동작으로 */
$("stageCanvas").addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  const i = hitCharacter(ev);
  if (i < 0) return;
  const c = stage.chars[i];
  const cur = MOTION_ORDER.indexOf(c.inst.motionId);
  c.inst.motionId = MOTION_ORDER[(cur + 1) % MOTION_ORDER.length];
  toast((c.name || "친구") + ": " + MOTIONS[c.inst.motionId].emoji + " " + MOTIONS[c.inst.motionId].label, 1400);
});

/* 우클릭 → 그 캐릭터만 무대에서 내리기 */
$("stageCanvas").addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  const i = hitCharacter(ev);
  if (i < 0) return;
  if (confirm((stage.chars[i].name || "이 친구") + "를 무대에서 내릴까요?")) removeCharacter(i);
});

/* ---------- 재생 ---------- */
$("btnPause").addEventListener("click", () => {
  stage.paused = !stage.paused;
  if (stage.paused) stage.pauseT = performance.now();
  else stage.t0 += performance.now() - stage.pauseT;
  $("btnPause").textContent = stage.paused ? "▶️ 재생" : "⏸️ 멈춤";
});

$("btnClear").addEventListener("click", () => {
  if (!stage.chars.length) return;
  if (!confirm("무대 위 캐릭터를 모두 내릴까요? (파일은 그대로 있으니 다시 올릴 수 있어요)")) return;
  for (const c of stage.chars) disposeInstance(stage.G, c.inst);
  stage.chars = [];
  loadedKeys.clear();
  relayout();
});

/* 이름표 보이기/숨기기 — 녹화 공유 시 별명 노출을 끌 수 있게 */
let namesVisible = true;
$("btnNames").addEventListener("click", () => {
  namesVisible = !namesVisible;
  $("btnNames").textContent = namesVisible ? "🏷️ 이름표 끄기" : "🏷️ 이름표 켜기";
});

const ctx = $("stageCanvas").getContext("2d");
function frame(now) {
  const t = ((stage.paused ? stage.pauseT : now) - stage.t0) / 1000;
  drawBackground(ctx, W, H, stage.bgId);
  renderFrame(stage.G, stage.glCanvas, stage.chars.map((c) => c.inst), t);
  ctx.drawImage(stage.glCanvas, 0, 0);
  /* 이름표 — 인원이 많으면 글자를 줄여 겹침을 막는다 */
  if (namesVisible && stage.chars.length) {
    const perRow = Math.ceil(stage.chars.length / (stage.chars.length <= 6 ? 1 : stage.chars.length <= 14 ? 2 : 3));
    const fontPx = Math.max(16, Math.min(30, ((W / perRow) * 0.9) / 6));
    ctx.textAlign = "center";
    ctx.font = `700 ${fontPx}px Pretendard, 'Malgun Gothic', sans-serif`;
    for (const c of stage.chars) {
      if (!c.name) continue;
      const x = c.inst.x, y = Math.min(H - 12, c.inst.y + fontPx * 1.5);
      const tw = ctx.measureText(c.name).width;
      const bx = x - tw / 2 - 10, by = y - fontPx, bw = tw + 20, bh = fontPx * 1.4;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill(); }
      else ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "#fff";
      ctx.fillText(c.name, x, y);
    }
  }
  stage.raf = requestAnimationFrame(frame);
}
stage.raf = requestAnimationFrame(frame);

/* ---------- 녹화 ---------- */
$("btnRecord").addEventListener("click", () => {
  if (!stage.chars.length) { toast("무대에 캐릭터가 없어요!"); return; }
  /* 멈춤 상태로 녹화하면 정지화면만 찍히므로 자동으로 재생 */
  if (stage.paused) $("btnPause").click();
  let rec;
  const cv = $("stageCanvas");
  try {
    const stream = cv.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9000000 });
  } catch (e) {
    toast("이 브라우저는 녹화를 지원하지 않아요.");
    return;
  }
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    downloadBlob(new Blob(chunks, { type: "video/webm" }), "우리반_무대.webm");
    toast("녹화를 저장했어요! 🎥");
    $("btnRecord").disabled = false;
    $("btnRecord").textContent = "⏺️ 녹화 (10초)";
  };
  $("btnRecord").disabled = true;
  let left = 10;
  $("btnRecord").textContent = "🔴 녹화 중... 10";
  rec.start();
  const tm = setInterval(() => {
    left--;
    if (left <= 0) { clearInterval(tm); rec.stop(); }
    else $("btnRecord").textContent = "🔴 녹화 중... " + left;
  }, 1000);
});
