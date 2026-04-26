const pieces = {
  wk: "\u2654",
  wq: "\u2655",
  wr: "\u2656",
  wb: "\u2657",
  wn: "\u2658",
  wp: "\u2659",
  bk: "\u265A",
  bq: "\u265B",
  br: "\u265C",
  bb: "\u265D",
  bn: "\u265E",
  bp: "\u265F"
};

const state = {
  game: new ChessGame(),
  selected: null,
  legal: [],
  mode: "ai",
  format: "10",
  colorChoice: "white",
  playerColor: "white",
  roomRole: "none",
  difficulty: "medium",
  roomId: null,
  playerId: null,
  poller: null,
  timer: null,
  clocks: { w: 600, b: 600 },
  timeWinner: null,
  lastTick: null,
  gameStarted: false,
  orientation: "white",
  lastMove: null,
  lastAnimatedMoveKey: null,
  aiThinking: false,
  friendRoomRequestSeq: 0,
  debugMode: false
};

const stockfish = createStockfishClient();
const AI_RESPONSE_DELAY_MS = 560;
const AI_MIN_THINK_MS = 750;
const EASY_RANDOM_MOVE_CHANCE = 0.55;

const boardEl = document.querySelector("#board");
const gameArea = document.querySelector("#gameArea");
const gameTopbar = document.querySelector("#gameTopbar");
const statusText = document.querySelector("#statusText");
const setupPanel = document.querySelector("#setupPanel");
const roomStatus = document.querySelector("#roomStatus");
const moveListWhite = document.querySelector("#moveListWhite");
const moveListBlack = document.querySelector("#moveListBlack");
const whiteClock = document.querySelector("#whiteClock");
const blackClock = document.querySelector("#blackClock");
const whiteCaptured = document.querySelector("#whiteCaptured");
const blackCaptured = document.querySelector("#blackCaptured");
const copyLinkBtn = document.querySelector("#copyLinkBtn");
const startBtn = document.querySelector("#startBtn");
const resumeBtn = document.querySelector("#resumeBtn");
const newGameBtn = document.querySelector("#newGameBtn");
const toast = document.querySelector("#toast");
const loadingOverlay = document.querySelector("#loadingOverlay");
const turnIndicator = document.querySelector("#turnIndicator");
const waitingBadge = document.querySelector("#waitingBadge");
const friendShareBox = document.querySelector("#friendShareBox");
const friendShareStatus = document.querySelector("#friendShareStatus");
const themeSelectSetup = document.querySelector("#themeSelectSetup");
const themeSelectGame = document.querySelector("#themeSelectGame");
const difficultyGroup = document.querySelector("#difficultyGroup");
let loadingTransitionInFlight = false;

async function init() {
  if (!boardEl || !setupPanel || !startBtn) {
    console.error("World Chess: required UI elements are missing.");
    return;
  }
  bindControls();
  restorePreferences();
  if (resumeBtn) resumeBtn.classList.toggle("hidden", !localStorage.getItem("worldChessGame"));
  const params = new URLSearchParams(location.search);
  state.debugMode = params.get("debug") === "1";
  const room = normalizeRoomId(params.get("room"));
  if (room) {
    const saved = JSON.parse(sessionStorage.getItem(`room:${room}`) || "{}");
    const knownPlayer = Boolean(saved.playerId);
    if (!knownPlayer) {
      const confirmed = window.confirm("Join this invite room as a player?");
      if (!confirmed) {
        await runLoadingTransition(async () => {
          render();
        });
        return;
      }
    }
    await runLoadingTransition(async () => {
      try {
        await joinRoom(room);
      } catch (error) {
        console.error(error);
        showToast("Could not join room.");
        render();
      }
    });
    return;
  }
  await runLoadingTransition(async () => {
    render();
  });
}

function basePath() {
  // Resolve the app root regardless of whether the page is /, /foo/, or /foo/index.html.
  const currentPath = location.pathname || "/";
  if (currentPath.endsWith("/")) return currentPath;
  if (/\.[A-Za-z0-9]+$/.test(currentPath)) {
    const slashIndex = currentPath.lastIndexOf("/");
    return slashIndex >= 0 ? currentPath.slice(0, slashIndex + 1) : "/";
  }
  return `${currentPath}/`;
}

function apiUrl(endpoint) {
  const suffix = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const base = `${basePath()}api/${suffix}`;
  if (!state.debugMode) return base;
  return base.includes("?") ? `${base}&debug=1` : `${base}?debug=1`;
}

function normalizeRoomId(value) {
  return String(value || "").trim();
}

function parseMoveCoordEntry(entry) {
  const raw = String(entry || "").trim();
  if (!raw) return null;
  const match = raw.match(/^([a-h][1-8])\s+([a-h][1-8])/i);
  if (!match) return null;
  return { from: match[1].toLowerCase(), to: match[2].toLowerCase() };
}

function lastMoveFromGameData(gameData) {
  const coords = Array.isArray(gameData?.moveCoords) ? gameData.moveCoords : [];
  if (!coords.length) return null;
  return parseMoveCoordEntry(coords[coords.length - 1]);
}

function bindControls() {
  document.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", async () => {
      activate(btn.parentElement, btn);
      state.mode = btn.dataset.mode;
      if (difficultyGroup) difficultyGroup.classList.toggle("hidden", state.mode !== "ai");
      if (state.mode === "friend") {
        showFriendShare(true);
        state.roomId = null;
        state.playerId = null;
        state.roomRole = "none";
        setFriendShareStatus("Press Start to generate a fresh invite link.", false);
      } else {
        state.friendRoomRequestSeq += 1;
        state.roomRole = "none";
        showFriendShare(false);
      }
    });
  });
  document.querySelectorAll("[data-format]").forEach(btn => {
    btn.addEventListener("click", () => {
      activate(btn.parentElement, btn);
      state.format = btn.dataset.format;
      if (state.mode === "friend" && !state.gameStarted) {
        state.friendRoomRequestSeq += 1;
        state.roomId = null;
        state.playerId = null;
        state.roomRole = "none";
        setFriendShareStatus("Press Start to generate a fresh invite link.", false);
      }
    });
  });
  document.querySelectorAll("[data-color]").forEach(btn => {
    btn.addEventListener("click", () => {
      activate(btn.parentElement, btn);
      state.colorChoice = btn.dataset.color;
      if (state.mode === "friend" && !state.gameStarted) {
        state.friendRoomRequestSeq += 1;
        state.roomId = null;
        state.playerId = null;
        state.roomRole = "none";
        setFriendShareStatus("Press Start to generate a fresh invite link.", false);
      }
    });
  });
  document.querySelectorAll("[data-difficulty]").forEach(btn => {
    btn.addEventListener("click", () => {
      activate(btn.parentElement, btn);
      state.difficulty = btn.dataset.difficulty;
    });
  });
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      if (loadingTransitionInFlight) return;
      await runLoadingTransition(startGame);
    });
  }
  if (resumeBtn) resumeBtn.addEventListener("click", restoreLocalGame);
  if (newGameBtn) {
    newGameBtn.addEventListener("click", async () => {
      if (loadingTransitionInFlight) return;
      await runLoadingTransition(newGame);
    });
  }
  if (copyLinkBtn) copyLinkBtn.addEventListener("click", copyRoomLink);
  [themeSelectSetup, themeSelectGame].filter(Boolean).forEach(select => {
    select.addEventListener("change", () => {
      setTheme(select.value);
      localStorage.setItem("worldChessTheme", select.value);
    });
  });
}

function activate(parent, active) {
  parent.querySelectorAll("button").forEach(btn => btn.classList.remove("active"));
  active.classList.add("active");
}

function restorePreferences() {
  setTheme(localStorage.getItem("worldChessTheme") || "graphite");
}

function roomLink(roomId = state.roomId) {
  if (!roomId) return "";
  const debugQuery = state.debugMode ? "&debug=1" : "";
  return `${location.origin}${basePath()}?room=${roomId}${debugQuery}`;
}

function debugLog(label, data) {
  if (!state.debugMode || !data) return;
  console.info(`[WorldChess debug] ${label}`, data);
}

function localDebugState() {
  return {
    roomId: state.roomId,
    playerId: state.playerId,
    roomRole: state.roomRole,
    playerColor: state.playerColor,
    orientation: state.orientation,
    gameStarted: state.gameStarted
  };
}

function showFriendShare(visible) {
  if (!friendShareBox) return;
  friendShareBox.classList.toggle("hidden", !visible);
  if (!visible) {
    if (friendShareStatus) friendShareStatus.innerHTML = "";
  }
}

function setFriendShareStatus(text, loading = false) {
  if (!friendShareStatus) return;
  friendShareStatus.innerHTML = loading ? `<span class="spinner"></span>${text}` : text;
}

async function ensureFriendRoom(forceNew = false) {
  if (state.mode !== "friend") return;
  const requestSeq = ++state.friendRoomRequestSeq;
  if (forceNew) {
    if (state.roomId) sessionStorage.removeItem(`room:${state.roomId}`);
    state.roomId = null;
    state.playerId = null;
    state.playerColor = "white";
    state.roomRole = "none";
  }
  if (state.roomId && state.playerId && !forceNew) {
    setFriendShareStatus("Press Start to generate a fresh invite link.", false);
    return;
  }
  setFriendShareStatus("Preparing secure invite link", true);
  try {
    const response = await fetch(apiUrl("/rooms"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: state.format, colorChoice: state.colorChoice })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create friend room.");
    debugLog("createRoom", data.debug);
    if (state.mode !== "friend" || requestSeq !== state.friendRoomRequestSeq) return;
    state.roomId = data.room.id;
    state.playerId = data.playerId;
    state.playerColor = data.playerColor;
    state.roomRole = "player";
    state.orientation = data.playerColor;
    state.game = ChessGame.fromJSON(data.room.game);
    sessionStorage.setItem(`room:${state.roomId}`, JSON.stringify({ playerId: state.playerId, playerColor: state.playerColor }));
    setFriendShareStatus("Invite room created.", false);
  } catch (error) {
    if (requestSeq !== state.friendRoomRequestSeq) return;
    setFriendShareStatus("Could not generate link. Try again.", false);
    showToast(String(error?.message || error || "Could not create room."));
  }
}

function updateTopIndicators() {
  if (!turnIndicator || !waitingBadge) return;
  const status = state.game.status();
  const waitingForFriend = state.mode === "friend" && !state.gameStarted && Boolean(state.roomId);
  const checkmateWinner = state.game.turn === "w" ? "Black" : "White";
  const formattedStatusText = String(status.text || "").replace(/\b(black|white)\b/g, side =>
    side[0].toUpperCase() + side.slice(1).toLowerCase()
  );
  const resultText = state.timeWinner
    ? `Time up. ${sideLabel(state.timeWinner)} wins.`
    : status.state === "checkmate"
      ? `Checkmate! ${checkmateWinner} wins.`
      : (status.state === "stalemate" || status.state === "draw")
        ? formattedStatusText
        : "";
  const active = state.gameStarted && !waitingForFriend && !resultText;
  const showTurnIndicator = active || Boolean(resultText);
  waitingBadge.classList.toggle("hidden", !waitingForFriend);
  turnIndicator.classList.toggle("hidden", !showTurnIndicator);
  turnIndicator.classList.toggle("result-checkmate", status.state === "checkmate" && Boolean(resultText));
  if (showTurnIndicator) {
    turnIndicator.textContent = resultText || `${sideLabel(state.game.turn)} to move`;
  }
}

function restoreLocalGame() {
  const raw = localStorage.getItem("worldChessGame");
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved.mode !== "ai") return;
    Object.assign(state, {
      mode: saved.mode,
      format: saved.format,
      playerColor: saved.playerColor,
      difficulty: saved.difficulty,
      clocks: saved.clocks,
      gameStarted: true,
      orientation: saved.playerColor,
      lastMove: null,
      aiThinking: false
    });
    state.game = ChessGame.fromJSON(saved.game);
    showGame();
    roomStatus.textContent = "Saved game restored.";
    startClocks();
    render();
  } catch {
    localStorage.removeItem("worldChessGame");
    if (resumeBtn) resumeBtn.classList.add("hidden");
  }
}

async function startGame() {
  state.selected = null;
  state.legal = [];
  state.game = new ChessGame();
  state.gameStarted = true;
  state.timeWinner = null;
  state.lastMove = null;
  state.aiThinking = false;
  state.clocks = initialClocks();
  clearInterval(state.poller);
  state.poller = null;

  if (state.mode === "friend") {
    try {
      await ensureFriendRoom(true);
      if (!state.roomId || !state.playerId) throw new Error("Friend room is not ready yet.");
      state.roomRole = "player";
      history.replaceState(null, "", `${basePath()}?room=${state.roomId}`);
      copyLinkBtn.classList.remove("hidden");
      roomStatus.textContent = "Invite sent. Waiting for your friend to join.";
      state.gameStarted = false;
      startPolling();
    } catch (error) {
      state.gameStarted = false;
      showToast(String(error?.message || error || "Could not start friend game."));
      render();
      return;
    }
  } else {
    state.roomId = null;
    state.playerId = null;
    state.roomRole = "none";
    showFriendShare(false);
    state.playerColor = chooseColor();
    state.orientation = state.playerColor;
    roomStatus.textContent = `Playing AI as ${state.playerColor}.`;
    if (state.playerColor === "black") setTimeout(makeAiMove, AI_RESPONSE_DELAY_MS);
  }

  showGame();
  startClocks();
  saveLocalGame();
  render();
}

function chooseColor() {
  if (state.colorChoice === "random") return Math.random() > 0.5 ? "white" : "black";
  return state.colorChoice;
}

function initialClocks() {
  if (state.format === "unlimited") return { w: Infinity, b: Infinity };
  const seconds = Number(state.format) * 60;
  return { w: seconds, b: seconds };
}

function showGame() {
  setupPanel.classList.add("hidden");
  gameArea.classList.remove("hidden");
  gameTopbar.classList.remove("hidden");
}

function showMenu() {
  state.mode = "ai";
  showFriendShare(false);
  if (difficultyGroup) difficultyGroup.classList.remove("hidden");
  document.querySelectorAll("[data-mode]").forEach(btn => btn.classList.toggle("active", btn.dataset.mode === "ai"));
  setupPanel.classList.remove("hidden");
  gameArea.classList.add("hidden");
  gameTopbar.classList.add("hidden");
}

function buildLabels(fileIndexes) {
  const ranks = state.orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = fileIndexes.map(c => "abcdefgh"[c]);
  document.querySelector("#rankLabels").innerHTML = ranks.map(n => `<span>${n}</span>`).join("");
  document.querySelector("#fileLabels").innerHTML = files.map(f => `<span>${f}</span>`).join("");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runLoadingTransition(action) {
  if (!loadingOverlay) {
    await action();
    return;
  }
  loadingTransitionInFlight = true;
  loadingOverlay.classList.remove("hidden");
  requestAnimationFrame(() => loadingOverlay.classList.add("show"));
  try {
    await sleep(2000);
    await action();
  } finally {
    loadingOverlay.classList.remove("show");
    setTimeout(() => {
      loadingOverlay.classList.add("hidden");
      loadingTransitionInFlight = false;
    }, 360);
  }
}

function animateLastMovePiece() {
  if (!state.lastMove || !boardEl) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const fromSquare = boardEl.querySelector(`[data-square="${state.lastMove.from}"]`);
  const toSquare = boardEl.querySelector(`[data-square="${state.lastMove.to}"]`);
  const pieceEl = toSquare?.querySelector(".piece");
  if (!fromSquare || !toSquare || !pieceEl) return;
  const fromRect = fromSquare.getBoundingClientRect();
  const toRect = toSquare.getBoundingClientRect();
  const dx = fromRect.left - toRect.left;
  const dy = fromRect.top - toRect.top;
  pieceEl.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: "translate(0, 0)" }
    ],
    {
      duration: 260,
      easing: "cubic-bezier(0.2, 0.75, 0.2, 1)",
      fill: "none"
    }
  );
}

function render() {
  const ranks = state.orientation === "white" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  const files = state.orientation === "white" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  buildLabels(files);
  const checkSquare = state.game.isCheck(state.game.turn) ? state.game.kingSquare(state.game.turn)?.square : null;

  boardEl.innerHTML = "";
  ranks.forEach(r => {
    files.forEach(c => {
      const square = `${"abcdefgh"[c]}${8 - r}`;
      const piece = state.game.board[r][c];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `square ${(r + c) % 2 ? "dark" : "light"}`;
      button.dataset.square = square;
      button.setAttribute("aria-label", piece ? `${square} ${piece.color === "w" ? "white" : "black"} ${piece.type}` : square);
      if (state.selected === square) button.classList.add("selected");
      if (state.lastMove && state.lastMove.from === square) button.classList.add("last-move-origin");
      if (state.lastMove && state.lastMove.to === square) button.classList.add("last-move-destination");
      if (state.legal.some(move => move.to === square && move.capture)) button.classList.add("capture");
      else if (state.legal.some(move => move.to === square)) button.classList.add("legal");
      if (checkSquare === square) button.classList.add("check-king");
      if (piece) {
        const span = document.createElement("span");
        span.className = `piece ${piece.color === "w" ? "white" : "black"}`;
        span.textContent = pieces[piece.color + piece.type];
        button.appendChild(span);
      }
      button.addEventListener("click", () => onSquare(square));
      boardEl.appendChild(button);
    });
  });

  const moveCount = Array.isArray(state.game.moveCoords) ? state.game.moveCoords.length : 0;
  const moveKey = state.lastMove ? `${state.lastMove.from}-${state.lastMove.to}-${moveCount}` : null;
  if (moveKey && moveKey !== state.lastAnimatedMoveKey) {
    animateLastMovePiece();
    state.lastAnimatedMoveKey = moveKey;
  }

  const status = state.game.status();
  statusText.textContent = status.state === "check" ? status.text : "";
  statusText.classList.toggle("check", status.state === "check");
  whiteClock.textContent = formatClock(state.clocks.w);
  blackClock.textContent = formatClock(state.clocks.b);
  whiteClock.classList.toggle("active", state.game.turn === "w" && state.gameStarted);
  blackClock.classList.toggle("active", state.game.turn === "b" && state.gameStarted);
  if (copyLinkBtn) {
    const canShareInvite = state.mode === "friend" && Boolean(state.roomId) && !state.gameStarted;
    copyLinkBtn.classList.toggle("hidden", !canShareInvite);
  }
  whiteCaptured.textContent = state.game.captured.w.map(type => pieces["b" + type]).join(" ");
  blackCaptured.textContent = state.game.captured.b.map(type => pieces["w" + type]).join(" ");
  renderMoves();
  updateTopIndicators();
}

function renderMoves() {
  if (!moveListWhite || !moveListBlack) return;
  moveListWhite.innerHTML = "";
  moveListBlack.innerHTML = "";
  const plies = Array.isArray(state.game.moveCoords)
    ? state.game.moveCoords.map(entry => String(entry || "").trim()).filter(Boolean)
    : [];

  for (let i = 0; i < plies.length; i += 1) {
    const li = document.createElement("li");
    li.textContent = i % 2 === 0
      ? `${Math.floor(i / 2) + 1}. ${plies[i]}`
      : `${Math.floor(i / 2) + 1}... ${plies[i]}`;
    if (i % 2 === 0) {
      moveListWhite.appendChild(li);
    } else {
      moveListBlack.appendChild(li);
    }
  }
  moveListWhite.scrollTop = moveListWhite.scrollHeight;
  moveListBlack.scrollTop = moveListBlack.scrollHeight;
}

function onSquare(square) {
  if (!state.gameStarted || isLocked()) return;
  if (state.mode === "friend" && state.roomRole !== "player") {
    showToast("Room is full. Spectators cannot move pieces.");
    return;
  }
  const piece = state.game.pieceAt(square);
  const myTurnColor = state.game.turn === "w" ? "white" : "black";
  if (state.mode !== "friend" && state.mode !== "ai") return;
  if (state.playerColor !== myTurnColor) return;

  if (state.selected && state.legal.some(move => move.to === square)) {
    makeMove(state.selected, square);
    return;
  }

  if (piece && piece.color === state.game.turn) {
    state.selected = square;
    state.legal = state.game.legalMoves(square);
  } else {
    state.selected = null;
    state.legal = [];
  }
  render();
}

function isLocked() {
  if (state.aiThinking) return true;
  const status = state.game.status().state;
  if (status !== "playing" && status !== "check") return true;
  if (state.mode === "friend") {
    if (state.roomRole !== "player" || !state.playerId) return true;
    const myTurn = state.game.turn === "w" ? "white" : "black";
    return state.playerColor !== myTurn;
  }
  const aiColor = state.playerColor === "white" ? "black" : "white";
  return (state.game.turn === "w" ? "white" : "black") === aiColor;
}

async function makeMove(from, to) {
  state.selected = null;
  state.legal = [];
  const promotion = promotionFor(from, to);
  if (state.mode === "friend") {
    const response = await fetch(apiUrl(`/rooms/${state.roomId}/move`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: state.playerId, from, to, promotion })
    });
    const data = await response.json();
    if (!response.ok) {
      showToast(data.error || "Move rejected.");
      return;
    }
    state.lastMove = data.move ? { from: data.move.from, to: data.move.to } : { from, to };
    syncRoom(data.room);
  } else {
    const result = state.game.move(from, to, promotion);
    if (!result.ok) {
      showToast(result.error);
      render();
      return;
    }
    state.lastMove = { from, to };
    saveLocalGame();
    render();
    if (state.game.status().state === "playing" || state.game.status().state === "check") {
      setTimeout(makeAiMove, AI_RESPONSE_DELAY_MS);
    }
  }
}

function promotionFor(from, to) {
  const legal = state.game.legalMoves(from).find(move => move.to === to);
  if (!legal?.promotion) return "q";
  const answer = (prompt("Promote to queen, rook, bishop, or knight:", "queen") || "queen").toLowerCase();
  if (answer.startsWith("r")) return "r";
  if (answer.startsWith("b")) return "b";
  if (answer.startsWith("n") || answer.startsWith("k")) return "n";
  return "q";
}

async function makeAiMove() {
  if (state.mode !== "ai" || !state.gameStarted) return;
  const status = state.game.status().state;
  if (status !== "playing" && status !== "check") return;
  const aiColor = state.playerColor === "white" ? "b" : "w";
  if (state.game.turn !== aiColor) return;
  state.aiThinking = true;
  render();
  const thinkStart = performance.now();
  const move = await getAiMove();
  const elapsed = performance.now() - thinkStart;
  if (elapsed < AI_MIN_THINK_MS) await sleep(AI_MIN_THINK_MS - elapsed);
  const stillLegal = move && state.game.legalMoves(move.from).some(candidate => candidate.to === move.to);
  if (!stillLegal) {
    console.warn("AI rejected an illegal candidate move", move);
    showToast("AI move rejected by rules engine.");
    state.aiThinking = false;
    render();
    return;
  }
  const result = state.game.move(move.from, move.to, move.promotion || "q");
  if (!result.ok) {
    console.warn("AI move failed validation", move, result.error);
    showToast("AI move rejected by rules engine.");
    state.aiThinking = false;
    render();
    return;
  }
  state.lastMove = { from: move.from, to: move.to };
  state.aiThinking = false;
  saveLocalGame();
  render();
}

async function getAiMove() {
  if (state.difficulty === "easy" && Math.random() < EASY_RANDOM_MOVE_CHANCE) {
    return state.game.bestMove("easy");
  }
  try {
    const move = await stockfish.bestMove(state.game.fen(), state.difficulty);
    if (move) return move;
  } catch (error) {
    console.warn("Stockfish unavailable; using local fallback AI.", error);
  }
  return state.game.bestMove(state.difficulty);
}

function createStockfishClient() {
  const source = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
  const settings = {
    easy: { skill: 0, moveTime: 90, limitStrength: true, elo: 800 },
    medium: { skill: 4, moveTime: 320, limitStrength: true, elo: 1300 },
    hard: { skill: 16, moveTime: 800, limitStrength: false }
  };
  let worker = null;
  let ready = false;
  let pending = null;

  function ensureWorker() {
    if (worker) return worker;
    const blob = new Blob([`importScripts("${source}");`], { type: "text/javascript" });
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = event => handleMessage(String(event.data || ""));
    worker.onerror = error => {
      const failed = pending;
      pending = null;
      worker?.terminate();
      worker = null;
      ready = false;
      if (failed) failed.reject(error);
    };
    worker.postMessage("uci");
    return worker;
  }

  function handleMessage(message) {
    if (message === "uciok") {
      ready = true;
      return;
    }
    if (!pending || !message.startsWith("bestmove ")) return;
    const moveText = message.split(/\s+/)[1];
    const request = pending;
    pending = null;
    request.resolve(parseUciMove(moveText));
  }

  function bestMove(fen, difficulty) {
    return new Promise((resolve, reject) => {
      if (pending) {
        reject(new Error("Stockfish is already thinking."));
        return;
      }
      const engine = ensureWorker();
      const config = settings[difficulty] || settings.medium;
      const started = Date.now();
      const waitForReady = () => {
        if (!worker) {
          reject(new Error("Stockfish worker failed to start."));
          return;
        }
        if (!ready && Date.now() - started < 2500) {
          setTimeout(waitForReady, 25);
          return;
        }
        if (!ready) {
          reject(new Error("Stockfish did not become ready."));
          return;
        }
        pending = { resolve, reject };
        engine.postMessage("ucinewgame");
        engine.postMessage(`setoption name Skill Level value ${config.skill}`);
        engine.postMessage(`setoption name UCI_LimitStrength value ${config.limitStrength ? "true" : "false"}`);
        if (config.limitStrength && config.elo) {
          engine.postMessage(`setoption name UCI_Elo value ${config.elo}`);
        }
        engine.postMessage(`position fen ${fen}`);
        engine.postMessage(`go movetime ${config.moveTime}`);
        setTimeout(() => {
          if (!pending) return;
          const timedOut = pending;
          pending = null;
          engine.postMessage("stop");
          timedOut.reject(new Error("Stockfish timed out."));
        }, config.moveTime + 2500);
      };
      waitForReady();
    });
  }

  return { bestMove };
}

function parseUciMove(moveText) {
  if (!moveText || moveText === "(none)" || moveText.length < 4) return null;
  return {
    from: moveText.slice(0, 2),
    to: moveText.slice(2, 4),
    promotion: moveText[4] || "q"
  };
}

async function joinRoom(roomId) {
  state.mode = "friend";
  state.roomId = normalizeRoomId(roomId);
  const saved = JSON.parse(sessionStorage.getItem(`room:${state.roomId}`) || "{}");
  const response = await fetch(apiUrl(`/rooms/${state.roomId}/join`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: saved.playerId })
  });
  const data = await response.json();
  debugLog("joinRoom", data.debug);
  if (!response.ok && response.status !== 409) {
    throw new Error(data.error || "Unable to join room.");
  }
  if (data.playerId) {
    state.playerId = data.playerId;
    state.playerColor = data.playerColor;
    state.roomRole = "player";
    state.orientation = data.playerColor;
    sessionStorage.setItem(`room:${state.roomId}`, JSON.stringify({ playerId: data.playerId, playerColor: data.playerColor }));
  } else {
    state.playerId = null;
    state.playerColor = "";
    state.roomRole = "spectator";
  }
  syncRoom(data.room);
  debugLog("localStateAfterJoin", localDebugState());
  showGame();
  copyLinkBtn.classList.remove("hidden");
  roomStatus.textContent = state.roomRole === "player"
    ? `Joined as ${state.playerColor}.`
    : "Room is full. Watching as spectator.";
  state.gameStarted = Boolean(data.room.whitePlayer && data.room.blackPlayer);
  startPolling();
  startClocks();
  render();
}

function startPolling() {
  clearInterval(state.poller);
  let pollInFlight = false;
  const pollNow = async () => {
    if (!state.roomId || pollInFlight) return;
    pollInFlight = true;
    try {
      const response = await fetch(apiUrl(`/rooms/${state.roomId}`));
      if (response.status === 404) {
        clearInterval(state.poller);
        state.poller = null;
        roomStatus.textContent = "Room no longer exists.";
        showToast("Room not found.");
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      debugLog("pollRoom", data.debug);
      syncRoom(data.room);
    } catch (error) {
      console.warn("Room polling failed.", error);
    } finally {
      pollInFlight = false;
    }
  };
  pollNow();
  state.poller = setInterval(pollNow, 1400);
}

function syncRoom(room) {
  if (!room) return;
  const inferredColor = state.playerId
    ? (room.whitePlayer === state.playerId ? "white" : room.blackPlayer === state.playerId ? "black" : "")
    : "";
  if (inferredColor) {
    state.roomRole = "player";
    state.playerColor = inferredColor;
    state.orientation = inferredColor;
  } else if (state.mode === "friend" && state.roomRole !== "none") {
    state.roomRole = "spectator";
    if (!state.playerId) state.playerColor = "";
  }
  state.game = ChessGame.fromJSON(room.game);
  state.lastMove = lastMoveFromGameData(room.game);
  state.format = room.format || state.format;
  state.timeWinner = room.timeWinner || null;
  if (room.clocks) {
    state.clocks = {
      w: room.clocks.w == null ? Infinity : room.clocks.w,
      b: room.clocks.b == null ? Infinity : room.clocks.b
    };
  }
  state.gameStarted = Boolean(room.whitePlayer && room.blackPlayer);
  if (!state.gameStarted) {
    roomStatus.textContent = "Waiting for your friend to open the link.";
  } else if (state.roomRole === "spectator") {
    roomStatus.textContent = "Watching live game.";
  } else if (state.playerColor) {
    roomStatus.textContent = `Playing as ${state.playerColor}.`;
  } else {
    roomStatus.textContent = "Connected to room.";
  }
  if (copyLinkBtn) {
    const canShareInvite = state.mode === "friend" && Boolean(state.roomId) && !state.gameStarted;
    copyLinkBtn.classList.toggle("hidden", !canShareInvite);
  }
  debugLog("localStateAfterSync", localDebugState());
  render();
}

function copyRoomLink() {
  const link = roomLink();
  if (!link) return;
  navigator.clipboard?.writeText(link).then(() => showToast("Link copied."), () => {
    prompt("Copy this game link:", link);
  });
}

function newGame() {
  clearInterval(state.poller);
  clearInterval(state.timer);
  state.poller = null;
  state.timer = null;
  state.game = new ChessGame();
  state.selected = null;
  state.legal = [];
  state.roomId = null;
  state.playerId = null;
  state.roomRole = "none";
  state.gameStarted = false;
  state.timeWinner = null;
  state.lastMove = null;
  state.aiThinking = false;
  state.friendRoomRequestSeq += 1;
  state.clocks = initialClocks();
  localStorage.removeItem("worldChessGame");
  if (resumeBtn) resumeBtn.classList.add("hidden");
  history.replaceState(null, "", location.pathname);
  showMenu();
  copyLinkBtn.classList.add("hidden");
  roomStatus.textContent = "Free chess. No login. Play anywhere.";
  render();
}

function startClocks() {
  clearInterval(state.timer);
  state.lastTick = Date.now();
  state.timer = setInterval(() => {
    if (!state.gameStarted || state.format === "unlimited" || state.mode === "friend") return;
    const status = state.game.status().state;
    if (status !== "playing" && status !== "check") return;
    const now = Date.now();
    const elapsed = Math.max(0, Math.floor((now - state.lastTick) / 1000));
    if (!elapsed) return;
    state.lastTick = now;
    state.clocks[state.game.turn] = Math.max(0, state.clocks[state.game.turn] - elapsed);
    if (state.clocks[state.game.turn] === 0) {
      state.timeWinner = state.game.turn === "w" ? "black" : "white";
      showToast(`Time up. ${sideLabel(state.timeWinner)} wins.`);
      state.gameStarted = false;
      clearInterval(state.timer);
      state.timer = null;
    }
    saveLocalGame();
    render();
  }, 500);
}

function saveLocalGame() {
  if (state.mode !== "ai" || !state.gameStarted) return;
  localStorage.setItem("worldChessGame", JSON.stringify({
    mode: state.mode,
    format: state.format,
    playerColor: state.playerColor,
    difficulty: state.difficulty,
    clocks: state.clocks,
    game: state.game.toJSON()
  }));
  if (resumeBtn) resumeBtn.classList.remove("hidden");
}

function formatClock(seconds) {
  if (seconds === Infinity || seconds == null) return "\u221E";
  const safe = Math.max(0, Math.floor(seconds));
  const m = String(Math.floor(safe / 60)).padStart(2, "0");
  const s = String(safe % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function sideLabel(side) {
  const normalized = String(side || "").toLowerCase();
  if (normalized === "white" || normalized === "w") return "White";
  if (normalized === "black" || normalized === "b") return "Black";
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "";
}

function setTheme(theme) {
  if (themeSelectSetup) themeSelectSetup.value = theme;
  if (themeSelectGame) themeSelectGame.value = theme;
  boardEl.className = `board theme-${theme}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1600);
}

init()
  .then(() => {
    window.__WORLD_CHESS_READY = true;
  })
  .catch(error => {
    window.__WORLD_CHESS_READY = false;
    console.error(error);
    if (toast) {
      showToast("Startup failed. Check console.");
    }
  });
