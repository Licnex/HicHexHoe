(function () {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  const currentPlayerEl = document.getElementById("current-player");
  const movesLeftEl = document.getElementById("moves-left");
  const messageEl = document.getElementById("message");
  const rulesBtn = document.getElementById("rules-btn");
  const sfxBtn = document.getElementById("sfx-btn");
  const themeBtn = document.getElementById("theme-btn");
  const resetBtn = document.getElementById("reset-btn");
  const rulesModal = document.getElementById("rules-modal");
  const closeRulesBtn = document.getElementById("close-rules-btn");

  const HEX_SIZE = 24;
  const SQRT3 = Math.sqrt(3);
  const SFX_VOLUME_MULTIPLIER = 3.4;
  const SFX_VOLUME_MAX = 0.32;

  // Axial direction vectors for a pointy-top hex grid.
  const DIRECTIONS = [
    [1, 0],
    [0, 1],
    [1, -1]
  ];

  const state = {
    board: new Map(),
    currentPlayer: "X",
    movesRemaining: 1,
    gameOver: false,
    winner: null,
    winningCells: [],
    hoverHex: null,
    panX: 0,
    panY: 0,
    isPointerDown: false,
    dragMoved: false,
    dragStartX: 0,
    dragStartY: 0,
    panStartX: 0,
    panStartY: 0,
    sfxEnabled: true
  };

  let audioContext = null;

  function keyFor(q, r) {
    return q + "," + r;
  }

  function getOrigin() {
    return {
      x: canvas.width / 2 + state.panX,
      y: canvas.height / 2 + state.panY
    };
  }

  // Converts axial coordinates to pixel coordinates for pointy-top hexes.
  function hexToPixel(q, r) {
    const x = HEX_SIZE * SQRT3 * (q + r / 2);
    const y = HEX_SIZE * 1.5 * r;
    return { x, y };
  }

  // Converts pixel coordinates to axial using inverse matrix, then rounds to nearest hex.
  function pixelToHex(x, y) {
    const q = ((SQRT3 / 3) * x - (1 / 3) * y) / HEX_SIZE;
    const r = ((2 / 3) * y) / HEX_SIZE;
    return cubeRound(q, r);
  }

  function cubeRound(qFloat, rFloat) {
    const x = qFloat;
    const z = rFloat;
    const y = -x - z;

    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);

    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);

    if (dx > dy && dx > dz) {
      rx = -ry - rz;
    } else if (dy > dz) {
      ry = -rx - rz;
    } else {
      rz = -rx - ry;
    }

    return { q: rx, r: rz };
  }

  function getCell(q, r) {
    return state.board.get(keyFor(q, r));
  }

  function setCell(q, r, value) {
    state.board.set(keyFor(q, r), value);
  }

  function inWinningCells(q, r) {
    for (let i = 0; i < state.winningCells.length; i += 1) {
      const cell = state.winningCells[i];
      if (cell.q === q && cell.r === r) {
        return true;
      }
    }
    return false;
  }

  function getLineThrough(q, r, dq, dr, player) {
    const line = [{ q, r }];

    let step = 1;
    while (getCell(q + dq * step, r + dr * step) === player) {
      line.push({ q: q + dq * step, r: r + dr * step });
      step += 1;
    }

    step = 1;
    while (getCell(q - dq * step, r - dr * step) === player) {
      line.unshift({ q: q - dq * step, r: r - dr * step });
      step += 1;
    }

    return line;
  }

  // Win logic: for each of 3 hex axes, count contiguous same-player pieces in both directions.
  function checkWin(q, r, player) {
    for (let i = 0; i < DIRECTIONS.length; i += 1) {
      const direction = DIRECTIONS[i];
      const line = getLineThrough(q, r, direction[0], direction[1], player);
      if (line.length >= 6) {
        return line;
      }
    }

    return null;
  }

  function updateStatus() {
    currentPlayerEl.textContent = state.currentPlayer;
    currentPlayerEl.style.color = state.currentPlayer === "X" ? "var(--x)" : "var(--o)";
    movesLeftEl.textContent = String(state.movesRemaining);

    if (state.gameOver) {
      messageEl.textContent = "Winner: " + state.winner;
      messageEl.style.color = "var(--win)";
      return;
    }

    messageEl.style.color = "var(--muted)";
    if (state.currentPlayer === "X" && state.board.size === 0) {
      messageEl.textContent = "Opening turn: 1 move";
    } else {
      messageEl.textContent = "";
    }
  }

  function getAudioContext() {
    if (!audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        return null;
      }
      audioContext = new Ctx();
    }
    return audioContext;
  }

  function unlockAudio() {
    const ctxAudio = getAudioContext();
    if (!ctxAudio) {
      return;
    }
    if (ctxAudio.state === "suspended") {
      ctxAudio.resume();
    }
  }

  function playTone(frequency, duration, type, volume, delaySeconds) {
    if (!state.sfxEnabled) {
      return;
    }

    const ctxAudio = getAudioContext();
    if (!ctxAudio) {
      return;
    }

    const delay = delaySeconds || 0;
    const start = ctxAudio.currentTime + delay;

    const oscillator = ctxAudio.createOscillator();
    const gainNode = ctxAudio.createGain();
    const targetGain = Math.min(SFX_VOLUME_MAX, volume * SFX_VOLUME_MULTIPLIER);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);

    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(targetGain, start + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctxAudio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playPlaceSfx(player) {
    if (player === "X") {
      playTone(420, 0.08, "triangle", 0.045, 0);
      playTone(512, 0.08, "triangle", 0.032, 0.04);
      return;
    }

    // O gets a stronger, slightly lower signature to differentiate players.
    playTone(340, 0.09, "triangle", 0.072, 0);
    playTone(408, 0.09, "triangle", 0.058, 0.045);
  }

  function playInvalidSfx() {
    playTone(145, 0.08, "sawtooth", 0.02, 0);
    playTone(110, 0.08, "sawtooth", 0.015, 0.05);
  }

  function playTurnSfx() {
    playTone(260, 0.06, "sine", 0.025, 0);
    playTone(310, 0.07, "sine", 0.02, 0.05);
  }

  function playWinSfx() {
    playTone(420, 0.09, "triangle", 0.045, 0);
    playTone(530, 0.09, "triangle", 0.04, 0.1);
    playTone(650, 0.12, "triangle", 0.04, 0.2);
    playTone(820, 0.18, "triangle", 0.045, 0.32);
  }

  function playThemeSfx() {
    playTone(470, 0.05, "triangle", 0.038, 0);
    playTone(690, 0.06, "triangle", 0.036, 0.045);
  }

  function playRulesOpenSfx() {
    playTone(360, 0.06, "sine", 0.038, 0);
    playTone(480, 0.07, "sine", 0.034, 0.05);
  }

  function playRulesCloseSfx() {
    playTone(440, 0.05, "sine", 0.036, 0);
    playTone(320, 0.06, "sine", 0.033, 0.04);
  }

  function playResetSfx() {
    playTone(300, 0.05, "square", 0.016, 0);
    playTone(380, 0.05, "square", 0.015, 0.045);
    playTone(260, 0.08, "triangle", 0.015, 0.095);
  }

  function playSfxToggleOnSfx() {
    playTone(520, 0.05, "triangle", 0.042, 0);
    playTone(700, 0.06, "triangle", 0.04, 0.045);
  }

  function switchTurn() {
    state.currentPlayer = state.currentPlayer === "X" ? "O" : "X";
    state.movesRemaining = 2;
    playTurnSfx();
  }

  function placePiece(q, r) {
    if (state.gameOver) {
      playInvalidSfx();
      return;
    }

    if (getCell(q, r)) {
      playInvalidSfx();
      return;
    }

    setCell(q, r, state.currentPlayer);
    playPlaceSfx(state.currentPlayer);

    const winningLine = checkWin(q, r, state.currentPlayer);
    if (winningLine) {
      state.gameOver = true;
      state.winner = state.currentPlayer;
      state.winningCells = winningLine;
      state.movesRemaining = 0;
      playWinSfx();
      updateStatus();
      draw();
      return;
    }

    state.movesRemaining -= 1;
    if (state.movesRemaining <= 0) {
      switchTurn();
    }

    updateStatus();
    draw();
  }

  function getHexCorners(centerX, centerY) {
    const corners = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      corners.push({
        x: centerX + HEX_SIZE * Math.cos(angle),
        y: centerY + HEX_SIZE * Math.sin(angle)
      });
    }
    return corners;
  }

  function drawHex(centerX, centerY, strokeStyle, lineWidth) {
    const corners = getHexCorners(centerX, centerY);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }

  function drawPiece(centerX, centerY, piece) {
    const color = piece === "X" ? "#58a6ff" : "#ff7b72";

    ctx.strokeStyle = color;
    ctx.lineWidth = 3.4;
    ctx.lineCap = "round";

    if (piece === "X") {
      const d = HEX_SIZE * 0.38;
      ctx.beginPath();
      ctx.moveTo(centerX - d, centerY - d);
      ctx.lineTo(centerX + d, centerY + d);
      ctx.moveTo(centerX + d, centerY - d);
      ctx.lineTo(centerX - d, centerY + d);
      ctx.stroke();
      return;
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, HEX_SIZE * 0.36, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawWinningLine() {
    if (state.winningCells.length < 2) {
      return;
    }

    const origin = getOrigin();
    const first = state.winningCells[0];
    const last = state.winningCells[state.winningCells.length - 1];

    const firstPx = hexToPixel(first.q, first.r);
    const lastPx = hexToPixel(last.q, last.r);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(origin.x + firstPx.x, origin.y + firstPx.y);
    ctx.lineTo(origin.x + lastPx.x, origin.y + lastPx.y);
    ctx.strokeStyle = "rgba(242, 204, 96, 0.9)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const origin = getOrigin();
    const maxReach = Math.max(canvas.width, canvas.height) / HEX_SIZE;
    const range = Math.ceil(maxReach * 0.8) + 14;

    for (let q = -range; q <= range; q += 1) {
      for (let r = -range; r <= range; r += 1) {
        const pixel = hexToPixel(q, r);
        const x = origin.x + pixel.x;
        const y = origin.y + pixel.y;

        if (
          x < -HEX_SIZE * 2 ||
          x > canvas.width + HEX_SIZE * 2 ||
          y < -HEX_SIZE * 2 ||
          y > canvas.height + HEX_SIZE * 2
        ) {
          continue;
        }

        const winning = inWinningCells(q, r);
        drawHex(x, y, winning ? "rgba(242, 204, 96, 0.95)" : "rgba(83, 95, 114, 0.8)", winning ? 2.3 : 1);

        const piece = getCell(q, r);
        if (piece) {
          drawPiece(x, y, piece);
        }
      }
    }

    if (!state.gameOver && state.hoverHex) {
      const piece = getCell(state.hoverHex.q, state.hoverHex.r);
      if (!piece) {
        const hoverPixel = hexToPixel(state.hoverHex.q, state.hoverHex.r);
        drawHex(origin.x + hoverPixel.x, origin.y + hoverPixel.y, "rgba(63, 185, 80, 0.95)", 2.4);
      }
    }

    drawWinningLine();
  }

  function canvasToBoard(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const origin = getOrigin();
    return pixelToHex(x - origin.x, y - origin.y);
  }

  function onMouseMove(event) {
    if (state.isPointerDown) {
      const dx = event.clientX - state.dragStartX;
      const dy = event.clientY - state.dragStartY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        state.dragMoved = true;
      }

      if (state.dragMoved) {
        state.panX = state.panStartX + dx;
        state.panY = state.panStartY + dy;
        draw();
      }
      return;
    }

    state.hoverHex = canvasToBoard(event.clientX, event.clientY);
    draw();
  }

  function onMouseDown(event) {
    if (event.button !== 0) {
      return;
    }

    unlockAudio();

    state.isPointerDown = true;
    state.dragMoved = false;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.panStartX = state.panX;
    state.panStartY = state.panY;
  }

  function onMouseUp(event) {
    if (event.button !== 0 || !state.isPointerDown) {
      return;
    }

    state.isPointerDown = false;
    if (state.dragMoved) {
      return;
    }

    const hex = canvasToBoard(event.clientX, event.clientY);
    placePiece(hex.q, hex.r);
  }

  function onMouseLeave() {
    state.isPointerDown = false;
    state.hoverHex = null;
    draw();
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    draw();
  }

  function resetGame() {
    state.board.clear();
    state.currentPlayer = "X";
    state.movesRemaining = 1;
    state.gameOver = false;
    state.winner = null;
    state.winningCells = [];
    state.hoverHex = null;
    state.panX = 0;
    state.panY = 0;

    updateStatus();
    draw();
  }

  function applyTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    document.body.setAttribute("data-theme", nextTheme);
    themeBtn.setAttribute("title", nextTheme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    themeBtn.setAttribute("aria-label", nextTheme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    localStorage.setItem("hixhexhoe-theme", nextTheme);
    draw();
  }

  function toggleTheme() {
    playThemeSfx();
    const isLight = document.body.getAttribute("data-theme") === "light";
    applyTheme(isLight ? "dark" : "light");
  }

  function openRules() {
    playRulesOpenSfx();
    rulesModal.classList.remove("hidden");
    rulesModal.setAttribute("aria-hidden", "false");
  }

  function closeRules() {
    if (!rulesModal.classList.contains("hidden")) {
      playRulesCloseSfx();
    }
    rulesModal.classList.add("hidden");
    rulesModal.setAttribute("aria-hidden", "true");
  }

  function applySfxEnabled(enabled) {
    state.sfxEnabled = enabled;
    sfxBtn.classList.toggle("muted", !enabled);
    sfxBtn.setAttribute("title", enabled ? "Mute sound effects" : "Unmute sound effects");
    sfxBtn.setAttribute("aria-label", enabled ? "Mute sound effects" : "Unmute sound effects");
    localStorage.setItem("hixhexhoe-sfx", enabled ? "on" : "off");
  }

  function toggleSfx() {
    unlockAudio();
    const nextEnabled = !state.sfxEnabled;

    applySfxEnabled(nextEnabled);

    if (nextEnabled) {
      playSfxToggleOnSfx();
    }
  }

  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("mouseleave", onMouseLeave);
  rulesBtn.addEventListener("click", openRules);
  closeRulesBtn.addEventListener("click", closeRules);
  rulesModal.addEventListener("click", function (event) {
    if (event.target === rulesModal) {
      closeRules();
    }
  });
  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeRules();
    }
  });
  sfxBtn.addEventListener("click", toggleSfx);
  themeBtn.addEventListener("click", toggleTheme);
  resetBtn.addEventListener("click", function () {
    playResetSfx();
    resetGame();
  });
  window.addEventListener("resize", resizeCanvas);

  applySfxEnabled(localStorage.getItem("hixhexhoe-sfx") !== "off");
  applyTheme(localStorage.getItem("hixhexhoe-theme") || "dark");
  updateStatus();
  resizeCanvas();
})();
