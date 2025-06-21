const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();

// ポート番号
const PORT = 8443;

// HTTPS用
const http = require("http");
const fs = require("fs");

// SSL/TLS証明書を読み込む
const options = {
  key: fs.readFileSync("./cert/localhost+1-key.pem"), // 秘密鍵
  cert: fs.readFileSync("./cert/localhost+1.pem"), // 証明書
};

// cors用設定用の変数
const corsOptions = {
  origin: "*", // 許可したいオリジンを指定
  credentials: true,
  methods: ["GET", "POST"],
  optionsSuccessStatus: 200,
};
const socketOptions = {
  cors: {
    origin: "*", // 許可したいオリジンを指定
    credentials: true,
  },
};

// cors設定
app.use(cors(corsOptions));

// 静的ファイル（public/index.html など）
app.use(express.static(path.join(__dirname, "public")));

// ルートアクセスで index.html を返す
app.get("/dev", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// HTTPSサーバ起動
const server = http.createServer(app);

// socket.io読み込み
const io = require("socket.io")(server, socketOptions);

let i = 0;
let r = Math.floor(Math.random() * 4); // 0〜3 のランダム
r = 3; // デバッグ用に出題者を固定
let questioner;
let usermode = [0, 0, 0, 0];
let connectedSockets = [];
let countquestion = 0;
let questiontext = ["", "", ""];

io.on("connection", (socket) => {
  console.log("ユーザーが接続しました。");

  if (connectedSockets.length >= 4) {
    socket.emit(
      "login rejected",
      "これ以上参加できません。定員に達しています。"
    );
    socket.disconnect(true); // 強制切断
    return; // それ以上の処理をしない
  }

  connectedSockets.push(socket); // ソケットを登録

  socket.on("chat message", (msg) => {
    socket.data.username = msg;
    io.emit("cmessage", msg);
  });

  socket.on("login", () => {
    socket.data.usernumber = i;
    socket.emit("user number", socket.data.usernumber);
    i++;
    console.log(`${socket.data.usernumber}さんが参加しました。`);

    // 他ユーザーに通知
    socket.broadcast.emit(
      "user joined",
      `${socket.data.usernumber}さんが参加しました。`
    );

    // 4人目がログインしたら出題者を決定して送信
    if (i === 4) {
      questioner = r;
      usermode = [0, 0, 0, 0];
      usermode[questioner] = 1;
      console.log("出題者は: " + questioner);
      io.emit("game start");
      io.emit("questioner decided", questioner);
      io.emit("usermodes", usermode);
    }
  });

  socket.on("disconnect", () => {
    console.log("ユーザーが切断しました。");

    connectedSockets = connectedSockets.filter((s) => s !== socket);
  }); // 質問を受け取るイベント
  socket.on("send question", (qtext) => {
    console.log(`質問を受け取りました: ${qtext}`);
    if (socket.data.usernumber === questioner) {
      questiontext[countquestion] = qtext;
      countquestion++;
      console.log(`質問${countquestion}: ${qtext}`); // 質問を全クライアントに送信（必要に応じて出題者を除外可能）

      io.emit("new question", {
        index: countquestion - 1,
        text: qtext,
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
