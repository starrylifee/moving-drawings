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
  o0.value = ""; o0.textContent = "동작: 모두 같이";
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

async function addFiles(files) {
  let ok = 0, fail = 0;
  for (const f of files) {
    try {
      const text = await f.text();
      const { canvas, joints, name } = await parseCharacterJSON(text);
      addCharacter(canvas, joints, name);
      ok++;
    } catch (err) { fail++; }
  }
  if (ok) toast(`${ok}명이 무대에 올라왔어요! 🎉` + (fail ? ` (${fail}개는 캐릭터 파일이 아니에요)` : ""));
  else if (fail) toast("캐릭터 파일이 아니에요. 학생 화면에서 저장한 .캐릭터.json 파일을 올려 주세요.", 3400);
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

/* 예시 친구들 */
$("btnDemo").addEventListener("click", () => {
  const src = drawSampleCharacter();
  const mask = autoMask(src, 200);
  const cut = cropCutout(src, mask);
  const names = ["방방이", "댄스왕", "씰룩이"];
  for (let i = 0; i < 3; i++) {
    const j = {};
    const base = defaultJoints(cut.width, cut.height);
    /* 예시 그림 관절 근사 매핑 */
    const rx0 = 128, ry0 = 18, rw = 388, rh = 736;
    for (const k in SAMPLE_JOINTS_RAW)
      j[k] = [((SAMPLE_JOINTS_RAW[k][0] - rx0) / rw) * cut.width, ((SAMPLE_JOINTS_RAW[k][1] - ry0) / rh) * cut.height];
    addCharacter(cut, Object.keys(j).length ? j : base, names[i]);
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

/* 캐릭터 클릭 → 그 캐릭터만 다음 동작으로 */
$("stageCanvas").addEventListener("pointerdown", (ev) => {
  const cv = $("stageCanvas");
  const r = cv.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * W;
  const y = ((ev.clientY - r.top) / r.height) * H;
  for (let i = stage.chars.length - 1; i >= 0; i--) {
    const c = stage.chars[i];
    const w2 = (c.inst.rig.w * c.inst.scale) / 2;
    const h = c.inst.rig.H * c.inst.scale;
    if (x > c.inst.x - w2 && x < c.inst.x + w2 && y > c.inst.y - h && y < c.inst.y + h * 0.05) {
      const cur = MOTION_ORDER.indexOf(c.inst.motionId);
      c.inst.motionId = MOTION_ORDER[(cur + 1) % MOTION_ORDER.length];
      toast((c.name || "친구") + ": " + MOTIONS[c.inst.motionId].emoji + " " + MOTIONS[c.inst.motionId].label, 1400);
      return;
    }
  }
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
  stage.chars = [];
  relayout();
});

const ctx = $("stageCanvas").getContext("2d");
function frame(now) {
  const t = ((stage.paused ? stage.pauseT : now) - stage.t0) / 1000;
  drawBackground(ctx, W, H, stage.bgId);
  renderFrame(stage.G, stage.glCanvas, stage.chars.map((c) => c.inst), t);
  ctx.drawImage(stage.glCanvas, 0, 0);
  /* 이름표 */
  ctx.textAlign = "center";
  ctx.font = "700 30px Pretendard, 'Malgun Gothic', sans-serif";
  for (const c of stage.chars) {
    if (!c.name) continue;
    const x = c.inst.x, y = Math.min(H - 12, c.inst.y + 44);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    const tw = ctx.measureText(c.name).width;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2 - 12, y - 30, tw + 24, 42, 12);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(c.name, x, y);
  }
  stage.raf = requestAnimationFrame(frame);
}
stage.raf = requestAnimationFrame(frame);

/* ---------- 녹화 ---------- */
$("btnRecord").addEventListener("click", () => {
  if (!stage.chars.length) { toast("무대에 캐릭터가 없어요!"); return; }
  const cv = $("stageCanvas");
  const stream = cv.captureStream(30);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9000000 });
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
