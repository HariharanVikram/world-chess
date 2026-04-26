const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ChessGame } = require("./public/js/chess-core.js");

const root = path.join(__dirname, "public");
const dataFile = process.env.ROOMS_FILE || path.join(__dirname, "rooms.json");
const port = process.env.PORT || 3000;
const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const kvEnabled = Boolean(kvUrl && kvToken);
const runningOnVercel = Boolean(process.env.VERCEL);
const requiresDurableStore = runningOnVercel && !kvEnabled;
const roomTtlSeconds = Math.max(60, Number(process.env.ROOM_TTL_SECONDS || 172800));
const roomLockTtlMs = Math.max(500, Number(process.env.ROOM_LOCK_TTL_MS || 4000));
const roomLockWaitMs = Math.max(500, Number(process.env.ROOM_LOCK_WAIT_MS || 2500));

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

let rooms = kvEnabled ? {} : loadRooms();

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
  if (kvEnabled) return;
  fs.writeFile(dataFile, JSON.stringify(rooms, null, 2), () => {});
}

function roomKey(roomId) {
  return `worldchess:room:${roomId}`;
}

function roomLockKey(roomId) {
  return `worldchess:lock:room:${roomId}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function redisCommand(...args) {
  if (!kvEnabled) throw new Error("KV storage is not configured.");
  const response = await fetch(kvUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  if (!response.ok) {
    throw new Error(`KV request failed with status ${response.status}`);
  }
  const payload = await response.json();
  if (payload && payload.error) {
    throw new Error(`KV command failed: ${payload.error}`);
  }
  return payload ? payload.result : null;
}

async function getRoom(roomId) {
  if (!kvEnabled) {
    return rooms[roomId] || null;
  }
  const raw = await redisCommand("GET", roomKey(roomId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setRoom(room) {
  if (!kvEnabled) {
    rooms[room.id] = room;
    saveRooms();
    return;
  }
  await redisCommand("SET", roomKey(room.id), JSON.stringify(room), "EX", String(roomTtlSeconds));
}

async function newUniqueRoomId() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = newRoomId();
    const existing = await getRoom(candidate);
    if (!existing) return candidate;
  }
  throw new Error("Could not generate a unique room id.");
}

async function withRoomLock(roomId, task) {
  if (!kvEnabled) return task();
  const lockKey = roomLockKey(roomId);
  const token = crypto.randomUUID();
  const deadline = Date.now() + roomLockWaitMs;
  while (Date.now() < deadline) {
    const acquired = await redisCommand("SET", lockKey, token, "NX", "PX", String(roomLockTtlMs));
    if (acquired === "OK") {
      try {
        return await task();
      } finally {
        try {
          const owner = await redisCommand("GET", lockKey);
          if (owner === token) await redisCommand("DEL", lockKey);
        } catch {
          // lock expiry/release failures should not break request flow
        }
      }
    }
    await sleep(40 + Math.floor(Math.random() * 50));
  }
  throw new Error("Room is busy, please retry.");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    out[key] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function ensureClientId(req, res) {
  const cookies = parseCookies(req);
  if (cookies.wc_client) return cookies.wc_client;
  const clientId = crypto.randomUUID();
  const cookie = `wc_client=${encodeURIComponent(clientId)}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`;
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
  } else {
    res.setHeader("Set-Cookie", [existing, cookie]);
  }
  return clientId;
}

function shortId(value) {
  const text = String(value || "");
  if (!text) return "";
  return text.length <= 12 ? text : `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function diagnosticsEnabled(req, url) {
  if (process.env.DEBUG_MULTIPLAYER === "1") return true;
  const header = String(req.headers["x-worldchess-debug"] || "").trim();
  if (header === "1" || header.toLowerCase() === "true") return true;
  return String(url.searchParams.get("debug") || "") === "1";
}

function roomDiagnostics(room, extra = {}) {
  const claims = room && room.clientClaims && typeof room.clientClaims === "object" ? room.clientClaims : {};
  const claimPairs = Object.entries(claims).map(([clientId, playerId]) => ({
    clientId: shortId(clientId),
    playerId: shortId(playerId),
    seat: room?.whitePlayer === playerId ? "white" : room?.blackPlayer === playerId ? "black" : "none"
  }));
  return {
    roomId: room ? room.id : null,
    whitePlayer: shortId(room?.whitePlayer),
    blackPlayer: shortId(room?.blackPlayer),
    claimCount: claimPairs.length,
    claims: claimPairs,
    ...extra
  };
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
  return crypto.randomBytes(5).toString("hex");
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
  if (!room || room.format === "unlimited" || room.timeWinner) return false;
  let changed = false;
  if (!room.clocks) room.clocks = initialClocks(room.format);
  const game = ChessGame.fromJSON(room.game);
  const status = game.status().state;
  if (status !== "playing" && status !== "check") return changed;
  if (!room.whitePlayer || !room.blackPlayer) return changed;
  const now = Date.now();
  if (!room.lastTick) {
    room.lastTick = now;
    return true;
  }
  const elapsed = Math.floor((now - room.lastTick) / 1000);
  if (!elapsed) return changed;
  room.lastTick += elapsed * 1000;
  changed = true;
  room.clocks[game.turn] = Math.max(0, room.clocks[game.turn] - elapsed);
  if (room.clocks[game.turn] === 0) {
    room.timeWinner = game.turn === "w" ? "black" : "white";
    room.updatedAt = now;
    changed = true;
  }
  return changed;
}

async function handleApi(req, res, url) {
  const debugOn = diagnosticsEnabled(req, url);

  if (requiresDurableStore) {
    const payload = {
      error: "Multiplayer is unavailable until KV_REST_API_URL and KV_REST_API_TOKEN are configured."
    };
    if (debugOn) payload.debug = { requiresDurableStore, kvEnabled, runningOnVercel };
    send(res, 503, payload);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const clientId = ensureClientId(req, res);
    const roomId = await newUniqueRoomId();
    const hostColor = normalizeColor(body.colorChoice);
    const playerId = crypto.randomUUID();
    const claims = {};
    claims[clientId] = playerId;
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
      clientClaims: claims,
      game: new ChessGame().toJSON()
    };
    await setRoom(room);
    const payload = {
      playerId,
      playerColor: hostColor,
      room: publicRoom(room)
    };
    if (debugOn) {
      payload.debug = roomDiagnostics(room, {
        action: "create",
        assignedHostColor: hostColor,
        requestClientId: shortId(clientId),
        requestPlayerId: shortId(playerId)
      });
    }
    send(res, 201, payload);
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/(join|move|reset|debug))?$/);
  if (!roomMatch) {
    send(res, 404, { error: "Not found" });
    return;
  }

  const [, roomId, action] = roomMatch;

  if (req.method === "GET" && !action) {
    const room = await getRoom(roomId);
    if (!room) {
      send(res, 404, { error: "Room not found" });
      return;
    }
    if (tickRoom(room)) {
      room.updatedAt = Date.now();
      await setRoom(room);
    }
    const payload = { room: publicRoom(room) };
    if (debugOn) {
      payload.debug = roomDiagnostics(room, {
        action: "get"
      });
    }
    send(res, 200, payload);
    return;
  }

  if (req.method === "GET" && action === "debug") {
    const room = await getRoom(roomId);
    if (!room) {
      send(res, 404, { error: "Room not found" });
      return;
    }
    send(res, 200, { debug: roomDiagnostics(room, { action: "debug" }), room: publicRoom(room) });
    return;
  }

  if (req.method === "POST" && (action === "join" || action === "move" || action === "reset")) {
    const body = await readBody(req);
    try {
      await withRoomLock(roomId, async () => {
        const room = await getRoom(roomId);
        if (!room) {
          send(res, 404, { error: "Room not found" });
          return;
        }

        if (action === "join") {
          const clientId = ensureClientId(req, res);
          if (!room.clientClaims || typeof room.clientClaims !== "object") room.clientClaims = {};
          let playerId = body.playerId;
          if (playerId && (room.whitePlayer === playerId || room.blackPlayer === playerId)) {
            room.clientClaims[clientId] = playerId;
            const playerColor = room.whitePlayer === playerId ? "white" : "black";
            if (tickRoom(room)) {
              room.updatedAt = Date.now();
            }
            await setRoom(room);
            const payload = { playerId, playerColor, room: publicRoom(room) };
            if (debugOn) {
              payload.debug = roomDiagnostics(room, {
                action: "join",
                decision: "resumeByPlayerId",
                requestClientId: shortId(clientId),
                requestPlayerId: shortId(body.playerId),
                assignedPlayerId: shortId(playerId),
                assignedColor: playerColor
              });
            }
            send(res, 200, payload);
            return;
          }

          const claimedId = room.clientClaims[clientId];
          if (claimedId && (room.whitePlayer === claimedId || room.blackPlayer === claimedId)) {
            const playerColor = room.whitePlayer === claimedId ? "white" : "black";
            if (tickRoom(room)) room.updatedAt = Date.now();
            await setRoom(room);
            const payload = { playerId: claimedId, playerColor, room: publicRoom(room) };
            if (debugOn) {
              payload.debug = roomDiagnostics(room, {
                action: "join",
                decision: "resumeByClientClaim",
                requestClientId: shortId(clientId),
                requestPlayerId: shortId(body.playerId),
                assignedPlayerId: shortId(claimedId),
                assignedColor: playerColor
              });
            }
            send(res, 200, payload);
            return;
          }

          const openColor = room.whitePlayer ? "black" : "white";
          if (room[`${openColor}Player`]) {
            if (tickRoom(room)) {
              room.updatedAt = Date.now();
              await setRoom(room);
            }
            const payload = { error: "This room already has two players.", room: publicRoom(room) };
            if (debugOn) {
              payload.debug = roomDiagnostics(room, {
                action: "join",
                decision: "roomFull",
                requestClientId: shortId(clientId),
                requestPlayerId: shortId(body.playerId),
                attemptedSeat: openColor
              });
            }
            send(res, 409, payload);
            return;
          }

          playerId = crypto.randomUUID();
          room[`${openColor}Player`] = playerId;
          room.clientClaims[clientId] = playerId;
          room.updatedAt = Date.now();
          room.lastTick = Date.now();
          await setRoom(room);
          const payload = { playerId, playerColor: openColor, room: publicRoom(room) };
          if (debugOn) {
            payload.debug = roomDiagnostics(room, {
              action: "join",
              decision: "assignedOpenSeat",
              requestClientId: shortId(clientId),
              requestPlayerId: shortId(body.playerId),
              assignedPlayerId: shortId(playerId),
              assignedColor: openColor
            });
          }
          send(res, 200, payload);
          return;
        }

        if (action === "move") {
          if (tickRoom(room)) {
            room.updatedAt = Date.now();
            await setRoom(room);
          }
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
          await setRoom(room);
          send(res, 200, { room: publicRoom(room), move: result.move });
          return;
        }

        if (body.playerId !== room.whitePlayer && body.playerId !== room.blackPlayer) {
          send(res, 403, { error: "You are not a player in this room." });
          return;
        }
        room.game = new ChessGame().toJSON();
        room.updatedAt = Date.now();
        room.clocks = initialClocks(room.format);
        room.lastTick = Date.now();
        room.timeWinner = null;
        await setRoom(room);
        send(res, 200, { room: publicRoom(room) });
      });
      return;
    } catch (error) {
      send(res, 503, { error: error.message || "Room is busy, please retry." });
      return;
    }
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

async function handleRequest(req, res) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  try {
    const apiIndex = url.pathname.indexOf("/api/");
    if (apiIndex >= 0) {
      const apiPath = url.pathname.slice(apiIndex);
      const apiUrl = new URL(`${apiPath}${url.search}`, `http://${host}`);
      await handleApi(req, res, apiUrl);
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
}

function createAppServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res);
  });
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`World Chess is running at http://localhost:${port}`);
  });
}

module.exports = handleRequest;
module.exports.createAppServer = createAppServer;
module.exports.handleRequest = handleRequest;
