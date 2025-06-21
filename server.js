const express = require("express");
const path = require('path');
const cors = require('cors')

const app = express();

// frontendのurl
const FRONTEND_URL = 'https://172.16.11.66:5173'

// HTTPS用
const https = require('https');
const fs = require('fs');

// SSL/TLS証明書を読み込む
const options = {
  key: fs.readFileSync('./cert/server.key'), // 秘密鍵
  cert: fs.readFileSync('./cert/server.crt') // 証明書
};

// cors用設定用の変数
const corsOptions = {
  origin: FRONTEND_URL, // 許可したいオリジンを指定
  credentials: true, 
  optionsSuccessStatus: 200
}
const socketOptions = {
  cors: {
    origin: function (origin, fn) {
      const isTarget = origin !== undefined && origin.match(FRONTEND_URL) !== null;
      return isTarget ? fn(null, origin) : fn('error invalid domain');
    },
    credentials: true
  }
};

// cors設定
app.use(cors(corsOptions));

// 静的ファイル（public/index.html など）
app.use(express.static(path.join(__dirname, 'public')));



// ルートアクセスで index.html を返す
app.get('/dev', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// HTTPSサーバ起動
const PORT = 8443
const server = https.createServer(options, app).listen(PORT, () => {
  console.log(`✅ HTTPSサーバ起動: https://localhost:${PORT}`);
});

// socket.io読み込み
const io = require("socket.io")(server,socketOptions);

let i = 0;
let r = Math.floor(Math.random() * 4);  // 0〜3 のランダム
let questioner;
let usermode = [0, 0, 0, 0];
let connectedSockets = [];
let countquestion=0;
let questiontext=['','',''];

io.on("connection", (socket) => {
    console.log("ユーザーが接続しました。");


    if (connectedSockets.length >= 4) {
        socket.emit("login rejected", "これ以上参加できません。定員に達しています。");
        socket.disconnect(true);  // 強制切断
        return;  // それ以上の処理をしない
    }

    connectedSockets.push(socket);  // ソケットを登録

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
        socket.broadcast.emit("user joined", `${socket.data.usernumber}さんが参加しました。`);

        // 4人目がログインしたら出題者を決定して送信
        if (i === 4) {
             questioner = r;
             usermode = [0, 0, 0, 0];
             usermode[questioner] = 1;
             console.log("出題者は: " + questioner);
             io.emit("questioner decided", questioner);
             io.emit("usermodes", usermode);
        }
    });

    socket.on("disconnect", () => {
        console.log("ユーザーが切断しました。");
        
    　　　connectedSockets = connectedSockets.filter(s => s !== socket);
　　});
　　// 質問を受け取るイベント
　　socket.on("send question", (qtext) => {
    　　if (socket.data.usernumber === questioner) {
       　　 questiontext[countquestion] = qtext;
        　　countquestion++;
        　　console.log(`質問${countquestion}: ${qtext}`);

        　　// 質問を全クライアントに送信（必要に応じて出題者を除外可能）
        　　io.emit("new question", {
            　　index: countquestion - 1,
            　　text: qtext
        　　});
    　　} 
　　　});



});
