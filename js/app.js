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
  state.brushOps = [];       // 브러시 손질 기록 — 슬라이더를 움직여도 손질이 보존되게
  state.thrPending = false;
  state.mask = autoMask(state.srcCanvas, +$("thrSlider").value);
  renderCutPreview();
  gotoStep(2);
}

/* 자동 마스크 재계산 + 브러시 손질 다시 적용 */
function recomputeMask() {
  state.mask = autoMask(state.srcCanvas, +$("thrSlider").value);
  const w = state.srcCanvas.width, h = state.srcCanvas.height;
  for (const op of state.brushOps) brushMask(state.mask, w, h, op[0], op[1], op[2], op[3]);
  state.thrPending = false;
}
function renderCutPreview() {
  paintMasked(state.srcCanvas, state.mask, $("cutCanvas"));
}
$("thrSlider").addEventListener("input", () => {
  clearTimeout(state._thrTm);
  state.thrPending = true;
  state._thrTm = setTimeout(() => {
    recomputeMask();
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
    const val = brushMode === "restore" ? 1 : 0;
    brushMask(state.mask, state.srcCanvas.width, state.srcCanvas.height, x, y, r, val);
    state.brushOps.push([x, y, r, val]);
    renderCutPreview();
  }
  let noBrushHintShown = false;
  cv.addEventListener("pointerdown", (ev) => {
    if (!brushMode) {
      if (!noBrushHintShown) { noBrushHintShown = true; toast("먼저 🧽 지우기나 🖌️ 살리기 버튼을 눌러 주세요!"); }
      return;
    }
    painting = true; cv.setPointerCapture(ev.pointerId); paint(ev);
  });
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
  /* 슬라이더 디바운스가 대기 중이면 지금 즉시 반영 (미리보기와 결과가 어긋나지 않게) */
  if (state.thrPending) { clearTimeout(state._thrTm); recomputeMask(); renderCutPreview(); }
  const crop = cropCutout(state.srcCanvas, state.mask);
  if (!crop) { toast("그림이 하나도 안 남았어요! 살리기 브러시로 그림을 칠해 주세요."); return; }
  const cut = crop.canvas;
  /* 너무 크면 축소 (성능) */
  let postScale = 1;
  if (Math.max(cut.width, cut.height) > 760) {
    postScale = 760 / Math.max(cut.width, cut.height);
    const c2 = document.createElement("canvas");
    c2.width = Math.round(cut.width * postScale); c2.height = Math.round(cut.height * postScale);
    c2.getContext("2d").drawImage(cut, 0, 0, c2.width, c2.height);
    state.cutout = c2;
  } else state.cutout = cut;
  state.cropInfo = { x0: crop.x0, y0: crop.y0, scale: postScale };

  if (state.isSample) state.joints = sampleJointsToCutout();
  else state.joints = defaultJoints(state.cutout.width, state.cutout.height);

  const base = $("jointBase"), over = $("jointOverlay");
  base.width = over.width = state.cutout.width;
  base.height = over.height = state.cutout.height;
  base.getContext("2d").drawImage(state.cutout, 0, 0);
  fitJointStack();
  drawJoints();
  gotoStep(3);
});

/* 예시 그림 관절: 실제 크롭 원점·축소 배율로 정확히 변환 */
function sampleJointsToCutout() {
  const { x0, y0, scale } = state.cropInfo;
  const w = state.cutout.width, h = state.cutout.height;
  const j = {};
  for (const k in SAMPLE_JOINTS_RAW) {
    j[k] = [
      Math.max(0, Math.min(w, (SAMPLE_JOINTS_RAW[k][0] - x0) * scale)),
      Math.max(0, Math.min(h, (SAMPLE_JOINTS_RAW[k][1] - y0) * scale)),
    ];
  }
  return j;
}

/* 3단계 캔버스를 작업 영역 안에 딱 맞게 축소 표시 (세로 긴 그림이 잘리지 않게) */
function fitJointStack() {
  const zone = $("jointStack").parentElement;
  const stack = $("jointStack");
  const base = $("jointBase"), over = $("jointOverlay");
  const zw = zone.clientWidth - 8, zh = zone.clientHeight - 8;
  if (zw <= 0 || zh <= 0) return;
  const sc = Math.min(1, zw / base.width, zh / base.height);
  const cw = Math.round(base.width * sc), ch = Math.round(base.height * sc);
  stack.style.width = cw + "px"; stack.style.height = ch + "px";
  for (const c of [base, over]) { c.style.width = cw + "px"; c.style.height = ch + "px"; }
}
window.addEventListener("resize", () => { if (state.step === 3) fitJointStack(); });

const BONE_LINES = [
  ["hips", "chest"], ["chest", "neck"], ["neck", "head"],
  ["chest", "shoulderL"], ["shoulderL", "elbowL"], ["elbowL", "handL"],
  ["chest", "shoulderR"], ["shoulderR", "elbowR"], ["elbowR", "handR"],
  ["hips", "hipL"], ["hipL", "kneeL"], ["kneeL", "footL"],
  ["hips", "hipR"], ["hipR", "kneeR"], ["kneeR", "footR"],
];

/* activeKey: 잡거나 마우스를 올린 점 — 그 점을 따라다니는 신체 이름표를 그린다 */
function drawJoints(activeKey) {
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
    const on = k === activeKey;
    ctx.beginPath(); ctx.arc(x, y, on ? rBig * 1.3 : rBig, 0, 7);
    ctx.fillStyle = JOINT_COLORS[k]; ctx.fill();
    ctx.lineWidth = on ? 4 : 3; ctx.strokeStyle = "#fff"; ctx.stroke();
  }
  if (activeKey) {
    const [x, y] = J[activeKey];
    const label = JOINT_LABELS[activeKey] || activeKey;
    const fs = Math.max(15, over.width * 0.032);
    ctx.font = `700 ${fs}px Pretendard, "Malgun Gothic", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    const bw = tw + fs * 1.2, bh = fs * 1.7;
    /* 기본은 점 위쪽, 화면 위 끝이면 아래쪽에 표시 */
    let bx = x, by = y - rBig * 2.2 - bh / 2;
    if (by - bh / 2 < 2) by = y + rBig * 2.2 + bh / 2;
    bx = Math.max(bw / 2 + 2, Math.min(over.width - bw / 2 - 2, bx));
    ctx.fillStyle = "rgba(29,39,51,0.88)";
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, bh / 3); ctx.fill();
    } else ctx.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, bx, by + 1);
    ctx.textBaseline = "alphabetic";
  }
}

(function bindJointDrag() {
  const over = $("jointOverlay");
  let dragKey = null, hoverKey = null;
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
    if (dragKey) {
      over.setPointerCapture(ev.pointerId);
      drawJoints(dragKey); // 잡는 순간 이름표 표시
    }
  });
  over.addEventListener("pointermove", (ev) => {
    if (dragKey) {
      const [x, y] = canvasPos(over, ev);
      state.joints[dragKey] = [Math.max(0, Math.min(over.width, x)), Math.max(0, Math.min(over.height, y))];
      drawJoints(dragKey); // 이름표가 점을 따라다닌다
      return;
    }
    /* 드래그 중이 아니면: 마우스를 올려만 놓아도 이름표 미리 보기 */
    const h = pick(ev);
    if (h !== hoverKey) {
      hoverKey = h;
      over.style.cursor = h ? "grab" : "default";
      drawJoints(hoverKey);
    }
  });
  over.addEventListener("pointerup", () => { dragKey = null; drawJoints(hoverKey); });
  over.addEventListener("pointercancel", () => { dragKey = null; drawJoints(); });
  over.addEventListener("pointerleave", () => { if (!dragKey) { hoverKey = null; drawJoints(); } });
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
  if (!state.G) {
    const c = document.createElement("canvas");
    c.width = 960; c.height = 540;
    state.G = createGL(c);      // 실패하면 여기서 던지고 아래는 실행 안 됨
    state.glCanvas = c;
  }
  if (state.inst) disposeInstance(state.G, state.inst); // 이전 캐릭터 GPU 자원 해제
  state.inst = createInstance(state.G, state.rig, {
    x: 480, y: 500, scale: (540 * 0.74) / state.rig.H,
    motionId: state.motionId,
  });
  buildMotionButtons();
  buildBgButtons();
  startLoop();
  setTimeout(() => $("nameInput").focus(), 50);
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
  const n = ($("nameInput").value || "").trim();
  if (!n) {
    toast("별명을 먼저 지어 볼까요? (실명 말고 별명!)");
    $("nameInput").focus();
    return;
  }
  const json = characterToJSON(state.cutout, state.joints, safeName());
  downloadBlob(new Blob([json], { type: "application/json" }), safeName() + ".캐릭터.json");
  toast("저장했어요! 이 파일을 선생님께 내면 무대에 함께 올라가요 🎪", 3600);
});

$("saveGif").addEventListener("click", async () => {
  const m = MOTIONS[state.motionId];
  const fps = 15, frames = Math.round(m.period * fps);
  const W = 640, H = 360;
  /* 어떤 이유로든 실패하면 오버레이가 영영 안 닫히는 일이 없게 안전장치 */
  const safety = setTimeout(() => { busy(null); toast("GIF 만들기가 너무 오래 걸려요. 다시 시도해 주세요."); }, 60000);
  try {
    const comp = document.createElement("canvas");
    comp.width = W; comp.height = H;
    const cctx = comp.getContext("2d");
    const gif = new GIF({ workers: 2, quality: 8, width: W, height: H, workerScript: "js/gif.worker.js" });
    busy("GIF 만드는 중...", 5);
    for (let i = 0; i < frames; i++) {
      const t = (i / fps);
      drawBackground(cctx, W, H, state.bgId);
      renderFrame(state.G, state.glCanvas, [state.inst], t);
      cctx.drawImage(state.glCanvas, 0, 0, W, H);
      gif.addFrame(comp, { copy: true, delay: 1000 / fps });
      busy("GIF 만드는 중...", 5 + (i / frames) * 45);
      await new Promise((r) => setTimeout(r, 0));
    }
    gif.on("progress", (p) => busy("GIF 굽는 중...", 50 + p * 50));
    gif.on("finished", (blob) => {
      clearTimeout(safety);
      busy(null);
      downloadBlob(blob, safeName() + "_" + m.label + ".gif");
      toast("GIF를 저장했어요! 🖼️");
      startLoop();
    });
    gif.render();
  } catch (e) {
    clearTimeout(safety);
    busy(null);
    toast("GIF 만들기에 실패했어요. 다시 시도해 주세요.");
  }
});

$("saveWebm").addEventListener("click", () => {
  let rec;
  try {
    const play = $("playCanvas");
    const stream = play.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5000000 });
  } catch (e) {
    toast("이 브라우저는 동영상 저장을 지원하지 않아요. GIF 저장을 써 주세요.");
    return;
  }
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

/* ---------- 이전 단계로 ---------- */
document.querySelectorAll(".btn-prev").forEach((b) =>
  b.addEventListener("click", () => gotoStep(state.step - 1)));

/* 지나온 단계 칩을 누르면 그 단계로 되돌아갈 수 있다 */
document.querySelectorAll(".step-chip").forEach((el) =>
  el.addEventListener("click", () => {
    const s = +el.dataset.step;
    if (s < state.step) gotoStep(s);
  }));

/* 작업 중 실수로 나가는 것 방지 */
window.addEventListener("beforeunload", (e) => {
  if (state.step > 1) { e.preventDefault(); e.returnValue = ""; }
});

gotoStep(1);

/* ---------- 엔터로 진행 ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  /* 입력칸·버튼에 포커스가 있으면 건드리지 않는다 (버튼 클릭과 이중 동작 방지) */
  if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON" || e.target.tagName === "A") return;
  if (state.step === 2) $("toStep3").click();
  else if (state.step === 3) $("toStep4").click();
});
