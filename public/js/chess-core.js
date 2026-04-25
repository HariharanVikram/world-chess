(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ChessGame = api.ChessGame;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const files = "abcdefgh";
  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const values = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const pieceSquare = {
    p: [0, 5, 8, 12, 16, 20, 28, 0],
    n: [-18, -6, 2, 8, 8, 2, -6, -18],
    b: [-10, 0, 4, 7, 7, 4, 0, -10],
    r: [0, 0, 2, 5, 5, 2, 0, 0],
    q: [-2, 0, 3, 4, 4, 3, 0, -2],
    k: [0, 8, 14, -4, -8, -4, 14, 0]
  };

  function cloneBoard(board) {
    return board.map(row => row.map(piece => (piece ? { ...piece } : null)));
  }

  function inBounds(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }

  function squareToCoords(square) {
    if (!/^[a-h][1-8]$/.test(square || "")) return null;
    return { r: 8 - Number(square[1]), c: files.indexOf(square[0]) };
  }

  function coordsToSquare(r, c) {
    return `${files[c]}${8 - r}`;
  }

  function colorName(color) {
    return color === "w" ? "white" : "black";
  }

  function opposite(color) {
    return color === "w" ? "b" : "w";
  }

  function pieceLetter(piece) {
    return piece.color === "w" ? piece.type.toUpperCase() : piece.type;
  }

  function parseFen(fen) {
    const [placement, turn, castling, ep, halfmove, fullmove] = fen.split(/\s+/);
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    placement.split("/").forEach((rank, r) => {
      let c = 0;
      for (const token of rank) {
        if (/\d/.test(token)) {
          c += Number(token);
        } else {
          board[r][c] = {
            type: token.toLowerCase(),
            color: token === token.toUpperCase() ? "w" : "b"
          };
          c += 1;
        }
      }
    });
    return {
      board,
      turn: turn || "w",
      castling: castling && castling !== "-" ? castling : "",
      enPassant: ep || "-",
      halfmove: Number(halfmove || 0),
      fullmove: Number(fullmove || 1),
      history: [],
      moveCoords: [],
      captured: { w: [], b: [] }
    };
  }

  function boardToFen(board) {
    return board.map(row => {
      let out = "";
      let empty = 0;
      row.forEach(piece => {
        if (!piece) {
          empty += 1;
          return;
        }
        if (empty) {
          out += empty;
          empty = 0;
        }
        out += pieceLetter(piece);
      });
      return out + (empty ? empty : "");
    }).join("/");
  }

  // Add a function to generate a unique sharable link
  function generateGameLink() {
    const gameId = Math.random().toString(36).substr(2, 9);
    return `${window.location.origin}?game=${gameId}`;
  }

  class ChessGame {
    constructor(fen = startFen) {
      Object.assign(this, parseFen(fen));
    }

    static fromJSON(data) {
      const game = new ChessGame();
      game.board = cloneBoard(data.board);
      game.turn = data.turn;
      game.castling = data.castling || "";
      game.enPassant = data.enPassant || "-";
      game.halfmove = data.halfmove || 0;
      game.fullmove = data.fullmove || 1;
      game.history = data.history || [];
      game.moveCoords = data.moveCoords || [];
      game.captured = data.captured || { w: [], b: [] };
      return game;
    }

    toJSON() {
      return {
        board: cloneBoard(this.board),
        turn: this.turn,
        castling: this.castling,
        enPassant: this.enPassant,
        halfmove: this.halfmove,
        fullmove: this.fullmove,
        history: this.history.slice(),
        moveCoords: (this.moveCoords || []).slice(),
        captured: {
          w: this.captured.w.slice(),
          b: this.captured.b.slice()
        },
        fen: this.fen()
      };
    }

    fen() {
      return `${boardToFen(this.board)} ${this.turn} ${this.castling || "-"} ${this.enPassant} ${this.halfmove} ${this.fullmove}`;
    }

    pieceAt(square) {
      const pos = squareToCoords(square);
      return pos ? this.board[pos.r][pos.c] : null;
    }

    legalMoves(from) {
      const moves = this.generateLegalMoves(this.turn);
      return from ? moves.filter(move => move.from === from) : moves;
    }

    generateLegalMoves(color = this.turn) {
      return this.generatePseudoMoves(color).filter(move => {
        const copy = this.copy();
        copy.applyMove(move, false);
        return !copy.isCheck(color);
      });
    }

    generatePseudoMoves(color) {
      const moves = [];
      for (let r = 0; r < 8; r += 1) {
        for (let c = 0; c < 8; c += 1) {
          const piece = this.board[r][c];
          if (!piece || piece.color !== color) continue;
          this.pieceMoves(r, c, piece, moves);
        }
      }
      return moves;
    }

    pieceMoves(r, c, piece, moves) {
      const from = coordsToSquare(r, c);
      const push = (tr, tc, extra = {}) => {
        if (!inBounds(tr, tc)) return;
        const target = this.board[tr][tc];
        if (!target || target.color !== piece.color) {
          moves.push({ from, to: coordsToSquare(tr, tc), piece: piece.type, color: piece.color, capture: target ? target.type : null, ...extra });
        }
      };

      if (piece.type === "p") {
        const dir = piece.color === "w" ? -1 : 1;
        const start = piece.color === "w" ? 6 : 1;
        const promoteRank = piece.color === "w" ? 0 : 7;
        if (inBounds(r + dir, c) && !this.board[r + dir][c]) {
          const extra = r + dir === promoteRank ? { promotion: "q" } : {};
          push(r + dir, c, extra);
          if (r === start && !this.board[r + dir * 2][c]) {
            push(r + dir * 2, c, { doublePawn: true });
          }
        }
        for (const dc of [-1, 1]) {
          const tr = r + dir;
          const tc = c + dc;
          if (!inBounds(tr, tc)) continue;
          const target = this.board[tr][tc];
          if (target && target.color !== piece.color) {
            const extra = tr === promoteRank ? { promotion: "q" } : {};
            push(tr, tc, extra);
          }
          if (coordsToSquare(tr, tc) === this.enPassant) {
            moves.push({ from, to: coordsToSquare(tr, tc), piece: "p", color: piece.color, capture: "p", enPassant: true });
          }
        }
        return;
      }

      if (piece.type === "n") {
        [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => push(r + dr, c + dc));
        return;
      }

      if (piece.type === "k") {
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (dr || dc) push(r + dr, c + dc);
          }
        }
        this.castleMoves(r, c, piece, moves);
        return;
      }

      const dirs = {
        b: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
        r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
        q: [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]
      }[piece.type];
      dirs.forEach(([dr, dc]) => {
        let tr = r + dr;
        let tc = c + dc;
        while (inBounds(tr, tc)) {
          const target = this.board[tr][tc];
          if (!target) {
            push(tr, tc);
          } else {
            if (target.color !== piece.color) push(tr, tc);
            break;
          }
          tr += dr;
          tc += dc;
        }
      });
    }

    castleMoves(r, c, piece, moves) {
      if (this.isCheck(piece.color)) return;
      const rank = piece.color === "w" ? 7 : 0;
      if (r !== rank || c !== 4) return;
      const kingSide = piece.color === "w" ? "K" : "k";
      const queenSide = piece.color === "w" ? "Q" : "q";
      if (this.castling.includes(kingSide) && !this.board[rank][5] && !this.board[rank][6]) {
        if (!this.isAttacked(rank, 5, opposite(piece.color)) && !this.isAttacked(rank, 6, opposite(piece.color))) {
          moves.push({ from: coordsToSquare(r, c), to: coordsToSquare(rank, 6), piece: "k", color: piece.color, castle: "kingside" });
        }
      }
      if (this.castling.includes(queenSide) && !this.board[rank][1] && !this.board[rank][2] && !this.board[rank][3]) {
        if (!this.isAttacked(rank, 3, opposite(piece.color)) && !this.isAttacked(rank, 2, opposite(piece.color))) {
          moves.push({ from: coordsToSquare(r, c), to: coordsToSquare(rank, 2), piece: "k", color: piece.color, castle: "queenside" });
        }
      }
    }

    isAttacked(r, c, byColor) {
      const pawnDir = byColor === "w" ? -1 : 1;
      for (const dc of [-1, 1]) {
        const pr = r - pawnDir;
        const pc = c + dc;
        if (inBounds(pr, pc) && this.board[pr][pc]?.type === "p" && this.board[pr][pc].color === byColor) return true;
      }
      for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
        const piece = this.board[r + dr]?.[c + dc];
        if (piece?.type === "n" && piece.color === byColor) return true;
      }
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        if (this.rayAttack(r, c, dr, dc, byColor, ["b", "q"])) return true;
      }
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (this.rayAttack(r, c, dr, dc, byColor, ["r", "q"])) return true;
      }
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (!dr && !dc) continue;
          const piece = this.board[r + dr]?.[c + dc];
          if (piece?.type === "k" && piece.color === byColor) return true;
        }
      }
      return false;
    }

    rayAttack(r, c, dr, dc, color, types) {
      let tr = r + dr;
      let tc = c + dc;
      while (inBounds(tr, tc)) {
        const piece = this.board[tr][tc];
        if (piece) return piece.color === color && types.includes(piece.type);
        tr += dr;
        tc += dc;
      }
      return false;
    }

    kingSquare(color) {
      for (let r = 0; r < 8; r += 1) {
        for (let c = 0; c < 8; c += 1) {
          const piece = this.board[r][c];
          if (piece?.type === "k" && piece.color === color) return { r, c, square: coordsToSquare(r, c) };
        }
      }
      return null;
    }

    isCheck(color = this.turn) {
      const king = this.kingSquare(color);
      return king ? this.isAttacked(king.r, king.c, opposite(color)) : false;
    }

    move(from, to, promotion = "q") {
      const legal = this.legalMoves(from).find(move => move.to === to);
      if (!legal) return { ok: false, error: "Illegal move" };

      if (legal.promotion) {
        legal.promotion = ["q", "r", "b", "n"].includes((promotion || "").toLowerCase()) ? promotion.toLowerCase() : "q";
      }

      this.applyMove(legal, true);
      return { ok: true, move: legal, status: this.status() };
    }

    applyMove(move, record) {
      const from = squareToCoords(move.from);
      const to = squareToCoords(move.to);
      const piece = this.board[from.r][from.c];
      const target = this.board[to.r][to.c];
      this.board[from.r][from.c] = null;
      if (move.enPassant) {
        const capR = from.r;
        const capC = to.c;
        const captured = this.board[capR][capC];
        this.board[capR][capC] = null;
        if (record && captured) this.captured[piece.color].push(captured.type);
      } else if (record && target) {
        this.captured[piece.color].push(target.type);
      }
      this.board[to.r][to.c] = { type: move.promotion || piece.type, color: piece.color };

      if (move.castle) {
        const rank = piece.color === "w" ? 7 : 0;
        if (move.castle === "kingside") {
          this.board[rank][5] = this.board[rank][7];
          this.board[rank][7] = null;
        } else {
          this.board[rank][3] = this.board[rank][0];
          this.board[rank][0] = null;
        }
      }

      this.updateCastling(piece, from, to, target);
      this.enPassant = move.doublePawn ? coordsToSquare((from.r + to.r) / 2, from.c) : "-";
      this.halfmove = piece.type === "p" || target || move.enPassant ? 0 : this.halfmove + 1;
      if (piece.color === "b") this.fullmove += 1;
      this.turn = opposite(this.turn);
      if (record) {
        this.history.push(this.notation(move, target));
        if (!Array.isArray(this.moveCoords)) this.moveCoords = [];
        this.moveCoords.push(`${move.from} ${move.to}`);
      }
    }

    updateCastling(piece, from, to, target) {
      const remove = chars => {
        for (const char of chars) this.castling = this.castling.replace(char, "");
      };
      if (piece.type === "k") remove(piece.color === "w" ? "KQ" : "kq");
      if (piece.type === "r") {
        if (from.r === 7 && from.c === 0) remove("Q");
        if (from.r === 7 && from.c === 7) remove("K");
        if (from.r === 0 && from.c === 0) remove("q");
        if (from.r === 0 && from.c === 7) remove("k");
      }
      if (target?.type === "r") {
        if (to.r === 7 && to.c === 0) remove("Q");
        if (to.r === 7 && to.c === 7) remove("K");
        if (to.r === 0 && to.c === 0) remove("q");
        if (to.r === 0 && to.c === 7) remove("k");
      }
    }

    notation(move, target) {
      if (move.castle === "kingside") return "O-O";
      if (move.castle === "queenside") return "O-O-O";
      const piece = move.piece === "p" ? "" : move.piece.toUpperCase();
      const capture = target || move.enPassant ? "x" : "";
      const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : "";
      const next = this.copy();
      const check = next.isCheck(next.turn);
      const mate = check && next.generateLegalMoves(next.turn).length === 0;
      return `${piece}${move.piece === "p" && capture ? move.from[0] : ""}${capture}${move.to}${promo}${mate ? "#" : check ? "+" : ""}`;
    }

    status() {
      const legal = this.generateLegalMoves(this.turn);
      const check = this.isCheck(this.turn);
      if (legal.length === 0 && check) {
        const winner = colorName(opposite(this.turn));
        return { state: "checkmate", winner, text: `Checkmate. ${winner} wins.` };
      }
      if (legal.length === 0) return { state: "stalemate", winner: null, text: "Stalemate." };
      if (this.halfmove >= 100) return { state: "draw", winner: null, text: "Draw by fifty-move rule." };
      if (check) return { state: "check", winner: null, text: `${colorName(this.turn)} is in check.` };
      return { state: "playing", winner: null, text: `${colorName(this.turn)} to move.` };
    }

    copy() {
      return ChessGame.fromJSON(this.toJSON());
    }

    evaluate(forColor = "w") {
      let score = 0;
      for (let r = 0; r < 8; r += 1) {
        for (let c = 0; c < 8; c += 1) {
          const piece = this.board[r][c];
          if (!piece) continue;
          const rankScore = piece.color === "w" ? pieceSquare[piece.type][7 - r] : pieceSquare[piece.type][r];
          const value = values[piece.type] + rankScore;
          score += piece.color === forColor ? value : -value;
        }
      }
      return score;
    }

    bestMove(level = "medium") {
      const moves = this.generateLegalMoves(this.turn);
      if (!moves.length) return null;
      if (level === "easy") return moves[Math.floor(Math.random() * moves.length)];
      const depth = level === "hard" ? 3 : 2;
      const color = this.turn;
      let best = moves[0];
      let bestScore = -Infinity;
      for (const move of orderMoves(moves)) {
        const copy = this.copy();
        copy.applyMove(move, false);
        const score = -negamax(copy, depth - 1, -Infinity, Infinity, opposite(color));
        if (score > bestScore) {
          bestScore = score;
          best = move;
        }
      }
      return best;
    }
  }

  function orderMoves(moves) {
    return moves.slice().sort((a, b) => (b.capture ? values[b.capture] : 0) - (a.capture ? values[a.capture] : 0));
  }

  function negamax(game, depth, alpha, beta, color) {
    if (depth === 0) return game.evaluate(color);
    const legalMoves = game.generateLegalMoves(game.turn);
    if (!legalMoves.length) return game.isCheck(game.turn) ? -100000 - depth : 0;
    let max = -Infinity;
    for (const move of orderMoves(legalMoves)) {
      const copy = game.copy();
      copy.applyMove(move, false);
      const score = -negamax(copy, depth - 1, -beta, -alpha, opposite(color));
      max = Math.max(max, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return max;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const friendLink = document.getElementById('friend-link');
    if (friendLink) {
      friendLink.addEventListener('click', () => {
        const link = generateGameLink();
        const linkDisplay = document.getElementById('game-link-display');

        // Show the link immediately when "Play Against Friend" is selected
        linkDisplay.innerHTML = `Share this link with your friend: <a href="${link}" target="_blank">${link}</a>`;
        linkDisplay.style.display = 'block';

        navigator.clipboard.writeText(link).then(() => {
          alert(`Game link copied to clipboard: ${link}`);
        });
      });
    }
  }

  return { ChessGame, files, squareToCoords, coordsToSquare };
});
