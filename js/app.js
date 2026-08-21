/* app.js — 학생 화면 흐름: 그림 준비 → 오려내기 → 뼈대 → 재생/저장 */
"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  step: 1,
  srcCanvas: null,   // 원본 사진(축소)
  mask: null,        // Uint8Array
  cutout: null,      // 오려낸 캐릭터 캔버스
  joints: null,      // {이름:[x,y]} — cutout 좌표
  rig: null,
  G: null, glCanvas: null, inst: null,
  motionId: "dance1", bgId: "stage",
  raf: 0, isSample: false,
};

function toast(msg, ms) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove("show"), ms || 2600);
}
function busy(msg, pct) {
  const b = $("busy");
  if (msg == null) { b.classList.remove("show"); return; }
  b.classList.add("show");
  $("busyMsg").textContent = msg;
  $("busyBar").style.width = (pct || 0) + "%";
}

/* ---------- 단계 이동 ---------- */
function gotoStep(n) {
  state.step = n;
  for (let i = 1; i <= 4; i++) $("panel" + i).classList.toggle("on", i === n);
  document.querySelectorAll(".step-chip").forEach((el) => {
    const s = +el.dataset.step;
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  if (n !== 4 && state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
}

/* ---------- 1단계 ---------- */
$("btnUpload").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const img = await loadImageFile(f);
    state.srcCanvas = imageToCanvas(img, 900);
    state.isSample = false;
    startCutStep();
  } catch (err) { toast("사진을 열 수 없어요. 다른 파일로 해 볼까요?"); }
  e.target.value = "";
});
$("btnSample").addEventListener("click", () => {
  state.srcCanvas = drawSampleCharacter();
  state.isSample = true;
  startCutStep();
});

/* ---------- 2단계: 오려내기 ---------- */
let brushMode = null; // 'erase' | 'restore' | null

function startCutStep() {
  state.mask = autoMask(state.srcCanvas, +$("thrSlider").value);
  renderCutPreview();
  gotoStep(2);
}
function renderCutPreview() {
  paintMasked(state.srcCanvas, state.mask, $("cutCanvas"));
}
$("thrSlider").addEventListener("input", () => {
  clearTimeout(state._thrTm);
  state._thrTm = setTimeout(() => {
    state.mask = autoMask(state.srcCanvas, +$("thrSlider").value);
    renderCutPreview();
  }, 120);
});
function setBrush(mode) {
  brushMode = brushMode === mode ? null : mode;
  $("modeErase").classList.toggle("on", brushMode === "erase");
  $("modeRestore").classList.toggle("on", brushMode === "restore");
}
$("modeErase").addEventListener("click", () => setBrush("erase"));
$("modeRestore").addEventListener("click", () => setBrush("restore"));

function canvasPos(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  return [((ev.clientX - r.left) / r.width) * canvas.width, ((ev.clientY - r.top) / r.height) * canvas.height];
}
(function bindBrush() {
  const cv = $("cutCanvas");
  let painting = false;
  function paint(ev) {
    if (!brushMode) return;
    const [x, y] = canvasPos(cv, ev);
    const r = +$("brushSize").value * (cv.width / cv.getBoundingClientRect().width);
    brushMask(state.mask, state.srcCanvas.width, state.srcCanvas.height, x, y, r, brushMode === "restore" ? 1 : 0);
    renderCutPreview();
  }
  cv.addEventListener("pointerdown", (ev) => { if (!brushMode) return; painting = true; cv.setPointerCapture(ev.pointerId); paint(ev); });
  cv.addEventListener("pointermove", (ev) => { if (painting) paint(ev); });
  cv.addEventListener("pointerup", () => { painting = false; });
  cv.addEventListener("pointercancel", () => { painting = false; });
})();

/* ---------- 3단계: 뼈대 ---------- */
const JOINT_COLORS = {
  hips: "#e8734a", chest: "#e8734a", neck: "#e8734a", head: "#e8734a",
  shoulderL: "#2e7cc0", elbowL: "#2e7cc0", handL: "#2e7cc0",
  shoulderR: "#2e7cc0", elbowR: "#2e7cc0", handR: "#2e7cc0",
  hipL: "#3d9a63", kneeL: "#3d9a63", footL: "#3d9a63",
  hipR: "#3d9a63", kneeR: "#3d9a63", footR: "#3d9a63",
};

$("toStep3").addEventListener("click", () => {
  const cut = cropCutout(state.srcCanvas, state.mask);
  if (!cut) { toast("그림이 하나도 안 남았어요! 살리기 브러시로 그림을 칠해 주세요."); return; }
  /* 너무 크면 축소 (성능) */
  if (Math.max(cut.width, cut.height) > 760) {
    const sc = 760 / Math.max(cut.width, cut.height);
    const c2 = document.createElement("canvas");
    c2.width = Math.round(cut.width * sc); c2.height = Math.round(cut.height * sc);
    c2.getContext("2d").drawImage(cut, 0, 0, c2.width, c2.height);
    state.cutout = c2;
  } else state.cutout = cut;

  if (state.isSample) {
    /* 예시 그림은 관절을 미리 맞춰 준다: 원본 좌표 → 잘라낸 좌표로 변환 */
    state.joints = sampleJointsToCutout();
  } else {
    state.joints = defaultJoints(state.cutout.width, state.cutout.height);
  }
  const base = $("jointBase"), over = $("jointOverlay");
  base.width = over.width = state.cutout.width;
  base.height = over.height = state.cutout.height;
  base.getContext("2d").drawImage(state.cutout, 0, 0);
  drawJoints();
  gotoStep(3);
});

function sampleJointsToCutout() {
  /* 예시 그림: 원본(640x800)에서 crop된 위치를 역산하기 어려우니, 잘라낸 캔버스 비율로 근사 */
  const w = state.cutout.width, h = state.cutout.height;
  const raw = SAMPLE_JOINTS_RAW;
  /* 원본에서 그림 영역 대략 (130,20)-(510,760) → 비율 매핑 */
  const rx0 = 128, ry0 = 18, rw = 388, rh = 736;
  const j = {};
  for (const k in raw) j[k] = [((raw[k][0] - rx0) / rw) * w, ((raw[k][1] - ry0) / rh) * h];
  return j;
}

const BONE_LINES = [
  ["hips", "chest"], ["chest", "neck"], ["neck", "head"],
  ["chest", "shoulderL"], ["shoulderL", "elbowL"], ["elbowL", "handL"],
  ["chest", "shoulderR"], ["shoulderR", "elbowR"], ["elbowR", "handR"],
  ["hips", "hipL"], ["hipL", "kneeL"], ["kneeL", "footL"],
  ["hips", "hipR"], ["hipR", "kneeR"], ["kneeR", "footR"],
];

function drawJoints() {
  const over = $("jointOverlay");
  const ctx = over.getContext("2d");
  ctx.clearRect(0, 0, over.width, over.height);
  const J = state.joints;
  const rBig = Math.max(9, over.width * 0.022);
  ctx.lineWidth = Math.max(3, rBig * 0.4);
  ctx.strokeStyle = "rgba(29,39,51,0.75)";
  for (const [a, b] of BONE_LINES) {
    ctx.beginPath(); ctx.moveTo(J[a][0], J[a][1]); ctx.lineTo(J[b][0], J[b][1]); ctx.stroke();
  }
  for (const k of JOINT_NAMES) {
    const [x, y] = J[k];
    ctx.beginPath(); ctx.arc(x, y, rBig, 0, 7);
    ctx.fillStyle = JOINT_COLORS[k]; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
  }
}

(function bindJointDrag() {
  const over = $("jointOverlay");
  let dragKey = null;
  function pick(ev) {
    const [x, y] = canvasPos(over, ev);
    const hit = Math.max(16, over.width * 0.035);
    let best = null, bestD = hit * hit;
    for (const k of JOINT_NAMES) {
      const dx = state.joints[k][0] - x, dy = state.joints[k][1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }
  over.addEventListener("pointerdown", (ev) => {
    dragKey = pick(ev);
    if (dragKey) over.setPointerCapture(ev.pointerId);
  });
  over.addEventListener("pointermove", (ev) => {
    if (!dragKey) return;
    const [x, y] = canvasPos(over, ev);
    state.joints[dragKey] = [Math.max(0, Math.min(over.width, x)), Math.max(0, Math.min(over.height, y))];
    drawJoints();
  });
  over.addEventListener("pointerup", () => { dragKey = null; });
  over.addEventListener("pointercancel", () => { dragKey = null; });
})();

$("resetJoints").addEventListener("click", () => {
  state.joints = state.isSample ? sampleJointsToCutout() : defaultJoints(state.cutout.width, state.cutout.height);
  drawJoints();
});

/* ---------- 4단계: 재생 ---------- */
$("toStep4").addEventListener("click", () => {
  busy("캐릭터에 생명을 불어넣는 중...", 30);
  setTimeout(() => {
    try { buildPlayer(); gotoStep(4); }
    catch (e) { console.error(e); toast("문제가 생겼어요: " + e.message); }
    finally { busy(null); }
  }, 30);
});

function buildPlayer() {
  state.rig = buildRig(state.cutout, state.joints);
  if (!state.glCanvas) {
    state.glCanvas = document.createElement("canvas");
    state.glCanvas.width = 960; state.glCanvas.height = 540;
    state.G = createGL(state.glCanvas);
  }
  state.inst = createInstance(state.G, state.rig, {
    x: 480, y: 500, scale: (540 * 0.74) / state.rig.H,
    motionId: state.motionId,
  });
  buildMotionButtons();
  buildBgButtons();
  startLoop();
}

function startLoop() {
  const play = $("playCanvas");
  const ctx = play.getContext("2d");
  const t0 = performance.now();
  cancelAnimationFrame(state.raf);
  function frame(now) {
    const t = (now - t0) / 1000;
    drawBackground(ctx, play.width, play.height, state.bgId);
    renderFrame(state.G, state.glCanvas, [state.inst], t);
    ctx.drawImage(state.glCanvas, 0, 0);
    state.raf = requestAnimationFrame(frame);
  }
  state.raf = requestAnimationFrame(frame);
}

function buildMotionButtons() {
  const g = $("motionGrid");
  g.innerHTML = "";
  for (const id of MOTION_ORDER) {
    const m = MOTIONS[id];
    const b = document.createElement("button");
    b.className = "motion-btn" + (id === state.motionId ? " on" : "");
    b.innerHTML = `<span class="e">${m.emoji}</span>${m.label}`;
    b.addEventListener("click", () => {
      state.motionId = id;
      state.inst.motionId = id;
      g.querySelectorAll(".motion-btn").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    });
    g.appendChild(b);
  }
}
function buildBgButtons() {
  const row = $("bgRow");
  row.innerHTML = "";
  for (const id in BACKGROUNDS) {
    const b = document.createElement("button");
    b.className = "bg-btn" + (id === state.bgId ? " on" : "");
    b.textContent = BACKGROUNDS[id].label;
    b.addEventListener("click", () => {
      state.bgId = id;
      row.querySelectorAll(".bg-btn").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    });
    row.appendChild(b);
  }
}

/* ---------- 저장 ---------- */
function safeName() {
  const n = ($("nameInput").value || "").trim().replace(/[\\/:*?"<>|]/g, "");
  return n || "내캐릭터";
}

$("saveChar").addEventListener("click", () => {
  const json = characterToJSON(state.cutout, state.joints, safeName());
  downloadBlob(new Blob([json], { type: "application/json" }), safeName() + ".캐릭터.json");
  toast("저장했어요! 이 파일을 선생님께 내면 무대에 함께 올라가요 🎪", 3600);
});

$("saveGif").addEventListener("click", async () => {
  const m = MOTIONS[state.motionId];
  const fps = 15, frames = Math.round(m.period * fps);
  const W = 640, H = 360;
  const comp = document.createElement("canvas");
  comp.width = W; comp.height = H;
  const cctx = comp.getContext("2d");
  const gif = new GIF({ workers: 2, quality: 8, width: W, height: H, workerScript: "js/gif.worker.js" });
  busy("GIF 만드는 중...", 5);
  for (let i = 0; i < frames; i++) {
    const t = (i / fps);
    drawBackground(cctx, W, H, state.bgId === "white" ? "white" : state.bgId);
    renderFrame(state.G, state.glCanvas, [state.inst], t);
    cctx.drawImage(state.glCanvas, 0, 0, W, H);
    gif.addFrame(comp, { copy: true, delay: 1000 / fps });
    busy("GIF 만드는 중...", 5 + (i / frames) * 45);
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.on("progress", (p) => busy("GIF 굽는 중...", 50 + p * 50));
  gif.on("finished", (blob) => {
    busy(null);
    downloadBlob(blob, safeName() + "_" + m.label + ".gif");
    toast("GIF를 저장했어요! 🖼️");
    startLoop();
  });
  gif.render();
});

$("saveWebm").addEventListener("click", () => {
  const play = $("playCanvas");
  const stream = play.captureStream(30);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5000000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    busy(null);
    downloadBlob(new Blob(chunks, { type: "video/webm" }), safeName() + "_" + MOTIONS[state.motionId].label + ".webm");
    toast("동영상을 저장했어요! 🎥");
  };
  const dur = Math.max(3, MOTIONS[state.motionId].period * 2);
  busy("동영상 녹화 중... (" + Math.round(dur) + "초)", 50);
  rec.start();
  setTimeout(() => rec.stop(), dur * 1000);
});

$("restart").addEventListener("click", () => {
  $("fileInput").value = "";
  gotoStep(1);
});

gotoStep(1);

/* ---------- 엔터로 진행 ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.target.tagName === "INPUT") return;
  if (state.step === 2) $("toStep3").click();
  else if (state.step === 3) $("toStep4").click();
});
