const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const roomsFile = path.join(os.tmpdir(), `world-chess-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
process.env.ROOMS_FILE = roomsFile;
const { createAppServer } = require("../server.js");

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function startServer() {
  const port = await getFreePort();
  const appServer = createAppServer();
  await new Promise((resolve, reject) => {
    appServer.listen(port, "127.0.0.1", error => {
      if (error) reject(error);
      else resolve();
    });
  });

  const stop = async () => {
    await new Promise((resolve, reject) => {
      appServer.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop
  };
}

async function jsonRequest(baseUrl, endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

async function jsonRequestWithCookie(baseUrl, endpoint, cookieJar, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookieJar.value) headers.Cookie = cookieJar.value;
  const response = await fetch(`${baseUrl}${endpoint}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookieJar.value = setCookie.split(";")[0];
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { response, data };
}

test("friend multiplayer flow keeps room and player state consistent", async () => {
  const server = await startServer();
  try {
    const create = await jsonRequest(server.baseUrl, "/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "10", colorChoice: "white" })
    });
    assert.equal(create.response.status, 201);
    assert.ok(create.data.playerId);
    assert.equal(create.data.playerColor, "white");
    assert.match(create.data.room.id, /^[a-f0-9]{10}$/);

    const hostId = create.data.playerId;
    const roomId = create.data.room.id;

    const join = await jsonRequest(server.baseUrl, `/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(join.response.status, 200);
    assert.ok(join.data.playerId);
    assert.equal(join.data.playerColor, "black");

    const fullRoomJoin = await jsonRequest(server.baseUrl, `/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(fullRoomJoin.response.status, 409);
    assert.ok(fullRoomJoin.data.room);

    const move = await jsonRequest(server.baseUrl, `/api/rooms/${roomId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: hostId, from: "e2", to: "e4", promotion: "q" })
    });
    assert.equal(move.response.status, 200);
    assert.equal(move.data.room.game.turn, "b");

    const repeatMove = await jsonRequest(server.baseUrl, `/api/rooms/${roomId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: hostId, from: "e4", to: "e5", promotion: "q" })
    });
    assert.equal(repeatMove.response.status, 409);
    assert.match(repeatMove.data.error, /not your turn/i);

    const spectatorMove = await jsonRequest(server.baseUrl, `/api/rooms/${roomId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: "spectator-id", from: "a2", to: "a3", promotion: "q" })
    });
    assert.equal(spectatorMove.response.status, 403);
  } finally {
    await server.stop();
  }
});

test("subpath-prefixed API routes are accepted", async () => {
  const server = await startServer();
  try {
    const create = await jsonRequest(server.baseUrl, "/world-chess/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "5", colorChoice: "black" })
    });

    assert.equal(create.response.status, 201);
    assert.equal(create.data.playerColor, "black");

    const roomId = create.data.room.id;
    const room = await jsonRequest(server.baseUrl, `/world-chess/api/rooms/${roomId}`);
    assert.equal(room.response.status, 200);
    assert.equal(room.data.room.id, roomId);
  } finally {
    await server.stop();
  }
});

test("repeat join from same client keeps assigned seat", async () => {
  const server = await startServer();
  try {
    const hostCookies = { value: "" };
    const friendCookies = { value: "" };
    const create = await jsonRequestWithCookie(server.baseUrl, "/api/rooms", hostCookies, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "10", colorChoice: "white" })
    });
    assert.equal(create.response.status, 201);
    const roomId = create.data.room.id;

    const firstJoin = await jsonRequestWithCookie(server.baseUrl, `/api/rooms/${roomId}/join`, friendCookies, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(firstJoin.response.status, 200);
    assert.equal(firstJoin.data.playerColor, "black");

    const secondJoin = await jsonRequestWithCookie(server.baseUrl, `/api/rooms/${roomId}/join`, friendCookies, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(secondJoin.response.status, 200);
    assert.equal(secondJoin.data.playerColor, "black");
    assert.equal(secondJoin.data.playerId, firstJoin.data.playerId);
  } finally {
    await server.stop();
  }
});

test("debug mode returns join diagnostics", async () => {
  const server = await startServer();
  try {
    const create = await jsonRequest(server.baseUrl, "/api/rooms?debug=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "10", colorChoice: "white" })
    });
    assert.equal(create.response.status, 201);
    assert.equal(create.data.debug.action, "create");
    const roomId = create.data.room.id;

    const join = await jsonRequest(server.baseUrl, `/api/rooms/${roomId}/join?debug=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(join.response.status, 200);
    assert.equal(join.data.debug.action, "join");
    assert.ok(join.data.debug.decision);

    const debugRoom = await jsonRequest(server.baseUrl, `/api/rooms/${roomId}/debug?debug=1`);
    assert.equal(debugRoom.response.status, 200);
    assert.equal(debugRoom.data.debug.action, "debug");
    assert.ok(Array.isArray(debugRoom.data.debug.claims));
  } finally {
    await server.stop();
  }
});
