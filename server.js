const express = require("express");
const path = require("path");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const PORT = 8443;

const corsOptions = {
  origin: "*",
  credentials: true,
  methods: ["GET", "POST"],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.static(path.join(__dirname, "public")));

app.get("/dev", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// httpサーバーを使用 (httpsの場合は https.createServer(options, app))
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    credentials: true,
  },
});


// --- サーバーの状態を管理する変数 ---
const gameState = {
  players: new Map(), // Map<userNumber, playerData>
  playerNumberCounter: 0,
  maxPlayers: 4,
  questioner: null,
  usermode: [],
  questiontext: ["", "", ""],
  countquestion: 0,
  gameStarted: false,
};

// ルーム名定義
const HOST_ROOM = 'host_room';

io.on("connection", (socket) => {
  // 接続時にクエリパラメータで役割を判断
  const role = socket.handshake.query.role;

  // ===== ホストの接続処理 =====
  if (role === 'host') {
    handleHostConnection(socket);
  }
  // ===== プレイヤーの接続処理 =====
  else {
    handlePlayerConnection(socket);
  }
});


/**
 * ホスト用の接続処理
 * @param {import("socket.io").Socket} socket
 */
function handleHostConnection(socket) {
  console.log(`ホストが接続しました: ${socket.id}`);
  socket.join(HOST_ROOM);

  // ホストに現在の全プレイヤー情報を送信
  socket.emit('update player list', Array.from(gameState.players.values()));
  if (gameState.gameStarted) {
    socket.emit("questioner decided", gameState.questioner);
    socket.emit("usermodes", gameState.usermode);
  }

  socket.on('disconnect', () => {
    console.log(`ホストが切断しました: ${socket.id}`);
  });
}

/**
 * プレイヤー用の接続処理
 * @param {import("socket.io").Socket} socket
 */
function handlePlayerConnection(socket) {
  console.log(`プレイヤー候補が接続しました: ${socket.id}`);

  // 現状、このコードでは同じ人が別タブで開くと別のプレイヤーとして扱われます。
  // 同一人物の複数デバイスを完全に同期させるには、クライアント側で生成した
  // 一意のID（localStorageに保存するなど）を`login`時に渡す改修が必要です。

  socket.on("login", (msg) => {
    // 定員チェック
    if (gameState.players.size >= gameState.maxPlayers && !Array.from(gameState.players.values()).some(p => p.username === msg)) {
      socket.emit("login rejected", "これ以上参加できません。定員に達しています。");
      socket.disconnect(true);
      return;
    }

    const userNumber = gameState.playerNumberCounter;
    socket.data.userNumber = userNumber;
    socket.data.username = msg;

    // プレイヤー情報を保存
    gameState.players.set(userNumber, {
      userNumber: userNumber,
      username: msg,
    });
    gameState.playerNumberCounter++;

    socket.emit("user number", userNumber);
    console.log(`${msg}(${userNumber})さんが参加しました。`);

    // ホストと全プレイヤーに更新を通知
    broadcastPlayerList();

    // 4人目がログインしたらゲーム開始
    if (gameState.players.size === gameState.maxPlayers) {
      startGame();
    }
  });

  socket.on("chat message", (msg) => {
    const messageData = {
      userNumber: socket.data.userNumber,
      username: socket.data.username,
      message: msg,
    };
    // 全員（ホスト含む）にチャットメッセージを送信
    io.emit("cmessage", messageData);
  });

  socket.on("send question", (qtext) => {
    if ((socket.data.userNumber + 1) === gameState.questioner) {
      const qIndex = gameState.countquestion;
      gameState.questiontext[qIndex] = qtext;
      gameState.countquestion++;
      console.log(`質問${gameState.countquestion}: ${qtext}`);

      const questionData = { index: qIndex, text: qtext };
      // 質問を全クライアント（ホスト含む）に送信
      io.emit("new question", questionData);
    }
  });

  socket.on("disconnect", () => {
    const { userNumber, username } = socket.data;
    if (userNumber !== undefined) {
      gameState.players.delete(userNumber);
      // ゲームリセットのロジックなどをここに追加可能
      console.log(`${username}(${userNumber})さんが切断しました。`);
      broadcastPlayerList();
    } else {
      console.log("未ログインのユーザーが切断しました。");
    }
  });
}

/**
 * ゲームを開始する
 */
function startGame() {
//   const r = Math.floor(Math.random() * gameState.maxPlayers);
  const r = 4; // デバッグ用に固定値を使用
  gameState.questioner = r;
  gameState.usermode = Array(gameState.maxPlayers).fill(0);
  gameState.usermode[gameState.questioner] = 1;
  gameState.gameStarted = true;

  console.log("ゲーム開始！ 出題者は: " + gameState.questioner);
  io.emit("game start");
  io.emit("questioner decided", gameState.questioner);
  io.emit("usermodes", gameState.usermode);
}

/**
 * 現在のプレイヤーリストをホストと全プレイヤーに送信する
 */
function broadcastPlayerList() {
  const playerList = Array.from(gameState.players.values());
  // ホストに送信
  io.to(HOST_ROOM).emit('update player list', playerList);
  // 全プレイヤーに送信
  io.emit('user joined', playerList); // イベント名は元の`user joined`を流用または変更
}

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});