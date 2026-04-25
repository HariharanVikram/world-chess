const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ChessGame } = require("./public/js/chess-core.js");

const root = path.join(__dirname, "public");
const dataFile = path.join(__dirname, "rooms.json");
const port = process.env.PORT || 3000;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

let rooms = loadRooms();

function loadRooms() {
  try {
    if (fs.existsSync(dataFile)) {
      return JSON.parse(fs.readFileSync(dataFile, "utf8"));
    }
  } catch (error) {
    console.warn("Could not load rooms.json:", error.message);
  }
  return {};
}

function saveRooms() {
  fs.writeFile(dataFile, JSON.stringify(rooms, null, 2), () => {});
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function publicRoom(room) {
  tickRoom(room);
  const game = ChessGame.fromJSON(room.game);
  return {
    id: room.id,
    format: room.format,
    whitePlayer: room.whitePlayer,
    blackPlayer: room.blackPlayer,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    clocks: room.clocks,
    timeWinner: room.timeWinner || null,
    game: game.toJSON(),
    status: room.timeWinner ? { state: "timeout", winner: room.timeWinner, text: `Time up. ${room.timeWinner} wins.` } : game.status()
  };
}

function newRoomId() {
  return crypto.randomBytes(5).toString("base64url");
}

function normalizeColor(choice) {
  if (choice === "white" || choice === "black") return choice;
  return Math.random() > 0.5 ? "white" : "black";
}

function opposite(color) {
  return color === "white" ? "black" : "white";
}

function initialClocks(format) {
  if (format === "unlimited") return { w: null, b: null };
  const seconds = Number(format || 10) * 60;
  return { w: seconds, b: seconds };
}

function tickRoom(room) {
  if (!room || room.format === "unlimited" || room.timeWinner) return;
  if (!room.clocks) room.clocks = initialClocks(room.format);
  const game = ChessGame.fromJSON(room.game);
  const status = game.status().state;
  if (status !== "playing" && status !== "check") return;
  if (!room.whitePlayer || !room.blackPlayer) return;
  const now = Date.now();
  if (!room.lastTick) {
    room.lastTick = now;
    return;
  }
  const elapsed = Math.floor((now - room.lastTick) / 1000);
  if (!elapsed) return;
  room.lastTick += elapsed * 1000;
  room.clocks[game.turn] = Math.max(0, room.clocks[game.turn] - elapsed);
  if (room.clocks[game.turn] === 0) {
    room.timeWinner = game.turn === "w" ? "black" : "white";
    room.updatedAt = now;
    saveRooms();
  }
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const roomId = newRoomId();
    const hostColor = normalizeColor(body.colorChoice);
    const playerId = crypto.randomUUID();
    const room = {
      id: roomId,
      format: body.format || "10",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      clocks: initialClocks(body.format || "10"),
      lastTick: null,
      timeWinner: null,
      whitePlayer: hostColor === "white" ? playerId : null,
      blackPlayer: hostColor === "black" ? playerId : null,
      game: new ChessGame().toJSON()
    };
    rooms[roomId] = room;
    saveRooms();
    send(res, 201, {
      playerId,
      playerColor: hostColor,
      room: publicRoom(room)
    });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/(join|move|reset))?$/);
  if (!roomMatch) {
    send(res, 404, { error: "Not found" });
    return;
  }

  const [, roomId, action] = roomMatch;
  const room = rooms[roomId];
  if (!room) {
    send(res, 404, { error: "Room not found" });
    return;
  }

  if (req.method === "GET" && !action) {
    send(res, 200, { room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "join") {
    const body = await readBody(req);
    let playerId = body.playerId;
    if (playerId && (room.whitePlayer === playerId || room.blackPlayer === playerId)) {
      const playerColor = room.whitePlayer === playerId ? "white" : "black";
      send(res, 200, { playerId, playerColor, room: publicRoom(room) });
      return;
    }

    const openColor = room.whitePlayer ? "black" : "white";
    if (room[`${openColor}Player`]) {
      send(res, 409, { error: "This room already has two players.", room: publicRoom(room) });
      return;
    }

    playerId = crypto.randomUUID();
    room[`${openColor}Player`] = playerId;
    room.updatedAt = Date.now();
    room.lastTick = Date.now();
    saveRooms();
    send(res, 200, { playerId, playerColor: openColor, room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && action === "move") {
    const body = await readBody(req);
    tickRoom(room);
    if (room.timeWinner) {
      send(res, 409, { error: `Time up. ${room.timeWinner} wins.`, room: publicRoom(room) });
      return;
    }
    const playerColor = room.whitePlayer === body.playerId ? "white" : room.blackPlayer === body.playerId ? "black" : null;
    const game = ChessGame.fromJSON(room.game);
    if (!playerColor) {
      send(res, 403, { error: "You are not a player in this room.", room: publicRoom(room) });
      return;
    }
    if (game.turn !== playerColor[0]) {
      send(res, 409, { error: "It is not your turn.", room: publicRoom(room) });
      return;
    }
    const result = game.move(body.from, body.to, body.promotion || "q");
    if (!result.ok) {
      send(res, 400, { error: result.error, room: publicRoom(room) });
      return;
    }
    room.game = game.toJSON();
    room.updatedAt = Date.now();
    room.lastTick = Date.now();
    saveRooms();
    send(res, 200, { room: publicRoom(room), move: result.move });
    return;
  }

  if (req.method === "POST" && action === "reset") {
    const body = await readBody(req);
    if (body.playerId !== room.whitePlayer && body.playerId !== room.blackPlayer) {
      send(res, 403, { error: "You are not a player in this room." });
      return;
    }
    room.game = new ChessGame().toJSON();
    room.updatedAt = Date.now();
    room.clocks = initialClocks(room.format);
    room.lastTick = Date.now();
    room.timeWinner = null;
    saveRooms();
    send(res, 200, { room: publicRoom(room) });
    return;
  }

  send(res, 405, { error: "Method not allowed" });
}

function serveStatic(req, res, url) {
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === "/" || !path.extname(filePath)) filePath = "/index.html";
  const resolved = path.normalize(path.join(root, filePath));
  if (!resolved.startsWith(root)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  // Allow the UI to be served from a subpath (e.g. /world-chess/) while still
  // resolving assets like /world-chess/js/app.js to /js/app.js on this server.
  const fallbacks = [];
  for (const marker of ["/js/", "/css/", "/img/", "/assets/"]) {
    const idx = filePath.indexOf(marker);
    if (idx > 0) fallbacks.push(filePath.slice(idx));
  }

  const candidates = [filePath, ...fallbacks].map(p => {
    const relative = p.startsWith("/") ? p.slice(1) : p;
    return path.normalize(path.join(root, relative));
  });
  for (const candidate of candidates) {
    if (!candidate.startsWith(root)) continue;
    try {
      const content = fs.readFileSync(candidate);
      res.writeHead(200, { "Content-Type": mime[path.extname(candidate)] || "application/octet-stream" });
      res.end(content);
      return;
    } catch {
      // try next candidate
    }
  }
  send(res, 404, "Not found", "text/plain; charset=utf-8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    // Ensure paths like /world-chess load as /world-chess/ so relative asset URLs
    // resolve correctly (important for GitHub Pages style subpaths).
    if (req.method === "GET" && url.pathname !== "/" && !url.pathname.endsWith("/") && !path.extname(url.pathname)) {
      res.writeHead(302, { Location: `${url.pathname}/${url.search}` });
      res.end();
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    send(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`World Chess is running at http://localhost:${port}`);
});
