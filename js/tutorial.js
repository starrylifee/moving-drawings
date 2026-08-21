/* tutorial.js — 단계별 사용법 모달 (라이브 데모 애니메이션 포함)
 * 첫 방문 시 자동으로 열리고, 헤더의 「사용법」 버튼으로 언제든 다시 볼 수 있다.
 */
"use strict";

(function () {
  const modal = document.getElementById("tutModal");
  const track = document.getElementById("tutTrack");
  const dotsBox = document.getElementById("tutDots");
  const slides = track.children.length;
  let cur = 0;

  /* 점 표시 */
  for (let i = 0; i < slides; i++) {
    const d = document.createElement("i");
    d.addEventListener("click", () => go(i));
    dotsBox.appendChild(d);
  }

  function go(n) {
    cur = Math.max(0, Math.min(slides - 1, n));
    track.style.transform = `translateX(-${cur * 100}%)`;
    [...dotsBox.children].forEach((d, i) => d.classList.toggle("on", i === cur));
    document.getElementById("tutPrev").disabled = cur === 0;
    const next = document.getElementById("tutNext");
    next.textContent = cur === slides - 1 ? "시작하기! 🎉" : "다음 →";
  }

  document.getElementById("tutPrev").addEventListener("click", () => go(cur - 1));
  document.getElementById("tutNext").addEventListener("click", () => {
    if (cur === slides - 1) close();
    else go(cur + 1);
  });
  document.getElementById("tutClose").addEventListener("click", close);
  modal.addEventListener("pointerdown", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("show")) return;
    if (e.key === "ArrowRight") go(cur + 1);
    else if (e.key === "ArrowLeft") go(cur - 1);
    else if (e.key === "Escape") close();
  });

  /* ---------- 라이브 데모: 예시 캐릭터가 모달 안에서 실제로 춤춘다 ---------- */
  let demo = null, demoRaf = 0;

  function buildDemo() {
    if (demo) return;
    const { canvas: cut, joints } = sampleCharacter(600);
    const rig = buildRig(cut, joints);
    const gl = document.createElement("canvas");
    gl.width = 480; gl.height = 270;
    const G = createGL(gl);
    const inst = createInstance(G, rig, { x: 240, y: 252, scale: (270 * 0.78) / rig.H, motionId: "dance1" });
    demo = { G, gl, inst, ctx: document.getElementById("tutDemo").getContext("2d") };
  }

  const DEMO_MOTIONS = ["dance1", "hooray", "disco", "wiggle", "jump"];
  function demoLoop() {
    const t0 = performance.now();
    function frame(now) {
      const t = (now - t0) / 1000;
      /* 몇 초마다 동작 바꾸기 — 구경만 해도 지루하지 않게 */
      demo.inst.motionId = DEMO_MOTIONS[Math.floor(t / 3.2) % DEMO_MOTIONS.length];
      drawBackground(demo.ctx, 480, 270, "stage");
      renderFrame(demo.G, demo.gl, [demo.inst], t);
      demo.ctx.drawImage(demo.gl, 0, 0);
      demoRaf = requestAnimationFrame(frame);
    }
    demoRaf = requestAnimationFrame(frame);
  }

  function open() {
    modal.classList.add("show");
    go(0);
    try { buildDemo(); cancelAnimationFrame(demoRaf); demoLoop(); }
    catch (e) { /* WebGL 불가 환경이면 데모 없이 진행 */ }
  }
  function close() {
    modal.classList.remove("show");
    cancelAnimationFrame(demoRaf);
    localStorage.setItem("mdTutSeen", "1");
  }

  document.getElementById("btnTut").addEventListener("click", (e) => { e.preventDefault(); open(); });

  /* 첫 방문이면 자동으로 보여 준다 */
  if (!localStorage.getItem("mdTutSeen")) open();
})();
