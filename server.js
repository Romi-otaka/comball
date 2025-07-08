const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
// 本番環境や開発環境に合わせてポートを選択してください。
const PORT = 8443;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // 本番環境では特定のオリジンに限定することを推奨します
    methods: ["GET", "POST"],
  },
});

// 静的ファイル（HTML, CSS, JS）を配信する設定
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- サーバーの状態を一元管理するオブジェクト ---
const gameState = {
  players: new Map(), // Map<userNumber, playerData>
  playerNumberCounter: 0,
  maxPlayers: 4,
  gameStarted: false,
  gameFinished: false,

  // ゲーム進行に関する状態
  questioner: null, // 現在の出題者のuserNumber
  usermode: [0, 0, 0, 0], // プレイヤーのモード (0: 回答者, 1: 出題者)
  questiontext: ["", "", ""],
  answertext: ["", "", ""],
  countquestion: 0,
  answeredThisPhase: false, // 現在のフェーズで出題者が質問済みか
  nextQuestioner: null, // 次の出題者 (一番早く回答した人)

  // タイマーに関する状態
  timeLeft: 30, // 深掘りタイムの残り時間
  anstimer: 20, // 回答の残り時間
  isAnswerTimeActive: false,
  isGameTimeActive: false,
  gameLoopInterval: null, // 全体のタイマーを管理するインターバルID
};

// ルーム名定義
const HOST_ROOM = "host_room";

// --- メイン接続処理 ---
io.on("connection", (socket) => {
  const role = socket.handshake.query.role;

  if (role === "host") {
    handleHostConnection(socket);
  } else {
    handlePlayerConnection(socket);
  }
});

// --- ホスト用接続処理 ---
function handleHostConnection(socket) {
  console.log(`ホストが接続しました: ${socket.id}`);
  socket.join(HOST_ROOM);
  const playerList = getPlayerList();
  if (gameState.gameStarted) {
    emitFullGameState(); // ゲーム中のホストに現在の状態をすべて送信
  }
  socket.on("disconnect", () => {
    console.log(`ホストが切断しました: ${socket.id}`);
  });
}

// --- プレイヤー用接続処理 ---
function handlePlayerConnection(socket) {
  socket.on("login", (username) => {
    if (gameState.players.size >= gameState.maxPlayers) {
      socket.emit(
        "login rejected",
        "これ以上参加できません。定員に達しています。"
      );
      socket.disconnect(true);
      return;
    }

    const userNumber = gameState.playerNumberCounter;
    socket.data.userNumber = userNumber;
    socket.data.username = username;

    gameState.players.set(userNumber, {
      socketId: socket.id,
      userNumber: userNumber,
      username: username,
      score: 0,
      clickedCount: 0,
    });
    gameState.playerNumberCounter++;

    socket.emit("user number", userNumber);
    console.log(`${username}(${userNumber})さんが参加しました。`);

    socket.broadcast.emit("user joined", getPlayerList());
  });

  // イベントハンドラを登録
  socket.on("startGame",()=> { startGame(); });
  socket.on("send question", (qtext) => handleSendQuestion(socket, qtext));
  socket.on("send answer", (answer) => handleSendAnswer(socket, answer)); // 引数(answer)を受け取るように修正
  socket.on("clicked", () => handleClick(socket));
  socket.on("reaction",(index)=>{ 
      io.emit("show_reaction",{ reaction:index});
    })
  socket.on("reset game", () => {
    // 誰かがリセットを要求した
    console.log(
      `ゲームリセットがユーザー ${socket.data.username} によってトリガーされました。`
    );
    resetGame();
    io.emit("game reset", "A user triggered a game reset. Returning to lobby.");
  });

  socket.on("disconnect", () => {
    const { userNumber, username } = socket.data;
    if (userNumber !== undefined) {
      gameState.players.delete(userNumber);
      console.log(`${username}(${userNumber})さんが切断しました。`);

      // ゲーム中に誰かが抜けたらゲームをリセット
      if (gameState.gameStarted) {
        console.log("プレイヤーが切断したため、ゲームをリセットします。");
        resetGame();
        io.emit(
          "game reset",
          "プレイヤーが切断したためゲームがリセットされました。"
        );
      }
    }
  });
}

// --- ゲームロジック関数群 ---

function startGame() {
  console.log("全員集合！ゲームを開始します。");
  gameState.gameStarted = true;

  // 最初の出題者をランダムに決定
  const playerNumbers = Array.from(gameState.players.keys());
  // gameState.questioner =playerNumbers[Math.floor(Math.random() * playerNumbers.length)];
    gameState.questioner = playerNumbers[0];

  updateUserModes();

  console.log(
    gameState.players.get(gameState.questioner)
  );

  io.emit("game start");
  io.emit("questioner decided", gameState.questioner); // userNumberを送信
  io.emit("usermodes", gameState.usermode);

  // 1秒ごとのゲームループを開始
  if (gameState.gameLoopInterval) clearInterval(gameState.gameLoopInterval);
  gameState.gameLoopInterval = setInterval(gameLoop, 1000);
}

function gameLoop() {
  updateAnswerTimer();
  updateGameTimer();
  emitFullGameState(); // 毎秒、全プレイヤーに状態を送信
}

function updateAnswerTimer() {
  if (gameState.isAnswerTimeActive && gameState.anstimer > 0) {
    gameState.anstimer--;
  }
  if (gameState.isAnswerTimeActive && gameState.anstimer === 0) {
    handleAnswerTimeout();
  }
}

function updateGameTimer() {
  if (gameState.isGameTimeActive && gameState.timeLeft > 0) {
    gameState.timeLeft--;
  }
  if (gameState.isGameTimeActive && gameState.timeLeft === 0) {
    handleTimeUp();
  }
}

function handleSendQuestion(socket, qtext) {  
  gameState.questiontext[gameState.countquestion] = qtext;
  gameState.answeredThisPhase = true;
  console.log(`質問${gameState.countquestion + 1}: ${qtext}`);

  io.emit("new question", { index: gameState.countquestion, text: qtext });

  // 回答フェーズを開始
  gameState.anstimer = 20;
  gameState.isAnswerTimeActive = true;
  gameState.isGameTimeActive = false;
}

//【統合】クライアントから回答テキストを受け取るように修正
function handleSendAnswer(socket, answer) {
  const userNumber = socket.data.userNumber;
  const username = socket.data.username;
  const qIndex = gameState.countquestion;

  if (!gameState.isAnswerTimeActive || userNumber === gameState.questioner)
    return;

  // 最初の有効な回答をロックする
  if (qIndex <= 2 && !gameState.answertext[qIndex]) {
    gameState.answertext[qIndex] = answer;
    gameState.nextQuestioner = userNumber; //【修正】次の出題者をuserNumberで正しく設定
    console.log(`【記録】ユーザー${userNumber}(${username})の回答: ${answer}`);

    // 回答がロックされたことを全員に通知
    io.emit("answer locked", { user: userNumber, username: username });
    // すぐに回答時間を終了し、深掘りタイムへ
    handleAnswerTimeout();
  }
  // 全員に回答内容をブロードキャスト（表示用）
  io.emit("answer received", {
    user: userNumber,
    username: username,
    text: answer,
  });
}

function handleAnswerTimeout() {
  if (!gameState.isAnswerTimeActive) return; // 二重実行防止

  console.log("回答時間が終了しました！");
  io.emit("answer_time_up");
  gameState.isAnswerTimeActive = false;

  const qIndex = gameState.countquestion;
  if (!gameState.answertext[qIndex]) {
    console.log("誰も回答しなかったため、回答者全員が3点減点されます。");
    gameState.players.forEach((player) => {
      if (player.userNumber !== gameState.questioner) {
        player.score = Math.max(0, player.score - 3);
      }
    });
    // この質問はノーカウントとし、同じ出題者が再質問できるようにする
    gameState.answeredThisPhase = false;
    io.to(gameState.players.get(gameState.questioner).socketId).emit(
      "retry_question"
    );
  } else {
    // 誰かが回答した場合、質問カウントを進めて深掘りタイムへ
    gameState.countquestion++;
    gameState.timeLeft = 30;
    gameState.isGameTimeActive = true;
    // フェーズが変わるのでクリック数をリセット
    gameState.players.forEach((p) => (p.clickedCount = 0));
  }
}

//【統合】詳細な得点ロジックを反映
function handleClick(socket) {
  if (!gameState.isGameTimeActive) return;

  console.log(socket.data.userNumber);
  const clickerPlayer = gameState.players.get(socket.data.userNumber);
  if (!clickerPlayer) return;

  clickerPlayer.clickedCount++;
  clickerPlayer.score += 5; // クリック者に+5点

  // 出題者にも得点 (自分自身が押した場合は加算しない)
  if (gameState.questioner !== clickerPlayer.userNumber) {
    const questionerPlayer = gameState.players.get(gameState.questioner);
    if (questionerPlayer) {
      questionerPlayer.score += 1;
    }
  }

  // ⭐ 回答者にも得点 (自分自身や出題者の場合を除く)
  if (
    gameState.nextQuestioner !== null &&
    gameState.nextQuestioner !== clickerPlayer.userNumber &&
    gameState.nextQuestioner !== gameState.questioner
  ) {
    const answererPlayer = gameState.players.get(gameState.nextQuestioner);
    if (answererPlayer) {
      answererPlayer.score += 1;
    }
  }

  // 3クリックごとに時間を延長
  const totalClicks = Array.from(gameState.players.values()).reduce(
    (sum, p) => sum + p.clickedCount,
    0
  );
  if (totalClicks > 0 && totalClicks % 3 === 0) {
    gameState.timeLeft++;
    io.emit("time extended"); // フロントエンドに延長を通知
  }
}

function handleTimeUp() {
  console.log("深掘りタイムが終了しました。");
  gameState.isGameTimeActive = false;

  io.emit("roundFinished",gameState.countquestion + 1);

  // 質問が3回終わったらゲーム終了
  if (gameState.countquestion >= 3) {
    endGame();
    return;
  }

  // 次のフェーズへ
  startNextPhase();
}

function startNextPhase() {
  // 次の出題者を決定（回答者がいればその人、いなければランダム）
  if (
    gameState.nextQuestioner !== null &&
    gameState.players.has(gameState.nextQuestioner)
  ) {
    gameState.questioner = gameState.nextQuestioner;
  } else {
    const activePlayers = Array.from(gameState.players.keys());
    if (activePlayers.length > 0) {
      gameState.questioner =
        activePlayers[Math.floor(Math.random() * activePlayers.length)];
    } else {
      console.log("プレイヤーがいないためゲームをリセットします。");
      resetGame();
      return;
    }
  }

  updateUserModes();

  console.log(
    "新しい出題者: " + gameState.players.get(gameState.questioner).username
  );

  // 状態をリセットして次の質問へ
  gameState.answeredThisPhase = false;
  gameState.nextQuestioner = null;
  gameState.timeLeft = 30;
  gameState.anstimer = 20;

  io.emit("questioner decided", gameState.questioner);
  io.emit("usermodes", gameState.usermode);
}

function endGame() {
  console.log("ゲーム終了: 質問3回完了");
  gameState.gameFinished = true;
  if (gameState.gameLoopInterval) {
    clearInterval(gameState.gameLoopInterval);
    gameState.gameLoopInterval = null;
  }
  io.emit("game finished", {
    questions: gameState.questiontext,
    answers: gameState.answertext,
    players: getPlayerList(), // 最終スコアを含めたプレイヤーリスト
  });
}

function resetGame() {
  if (gameState.gameLoopInterval) {
    clearInterval(gameState.gameLoopInterval);
  }
  // gameStateオブジェクトを初期状態に戻す
  Object.assign(gameState, {
    players: new Map(),
    playerNumberCounter: 0,
    gameStarted: false,
    gameFinished: false,
    questioner: null,
    usermode: [0, 0, 0, 0],
    questiontext: ["", "", ""],
    answertext: ["", "", ""],
    countquestion: 0,
    answeredThisPhase: false,
    nextQuestioner: null,
    timeLeft: 30,
    anstimer: 20,
    isAnswerTimeActive: false,
    isGameTimeActive: false,
    gameLoopInterval: null,
  });
  console.log("ゲーム状態をリセットしました。");
  broadcastPlayerList(); // 空のプレイヤーリストを送信してクライアント側を更新
}

// --- ヘルパー関数 ---

function getPlayerList() {
  // socketIdはクライアントに渡さないようにする
  return Array.from(gameState.players.values()).map(
    ({ socketId, ...rest }) => rest
  );
}

function broadcastPlayerList() {
  const playerList = getPlayerList();
  io.emit("update player list", playerList); // 全員にプレイヤーリストを送信
}

function updateUserModes() {
  gameState.usermode.fill(0);
  if (gameState.players.has(gameState.questioner)) {
    gameState.usermode[gameState.questioner] = 1;
  }
}

// 全クライアントに現在のゲーム状態を送信する
function emitFullGameState() {
  if (!gameState.gameStarted || gameState.gameFinished) return;

  io.emit("timer_update", {
    timeLeft: gameState.timeLeft,
    ansTimer: gameState.anstimer,
    players: getPlayerList(), // スコアとクリック数を含むプレイヤー情報
    isAnswerTimeActive: gameState.isAnswerTimeActive,
  });
}

server.listen(PORT, () => {
  console.log(
    `サーバーがポート ${PORT} で起動しました。 http://localhost:${PORT}`
  );
});
