const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const io = require("socket.io")(server);
const PORT = 3001;

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

let i = 0;
let r = Math.floor(Math.random() * 4);  // 0〜3 のランダム
let questioner;
let usermode = [0, 0, 0, 0];
let connectedSockets = [];
let countquestion=0;
let questiontext=['','',''];
let score=[0,0,0];
//ゲーム用タイマー

let counter = 0;       // ボタンの押下回数
let timeLeft = 10;     // 初期制限時間（秒）


// 1秒ごとに timeLeft を減らし、全クライアントへ配信
setInterval(() => {
  if (timeLeft > 0) timeLeft--;
  io.emit('timer_update', {timeLeft, counter});
}, 1000);

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

    socket.on("login", (ack) => {
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

        ack({number : socket.data.usernumber})//number:キー　socket.data.usernumber:バリュー　全体に送るのではなく個人だけに返すのであれば返り値として扱うことができる
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
        if (countquestion >= 1) {
            // 0～(現在の参加ユーザー数-1) の乱数
            const total = i;  // 参加人数 (loginでインクリメントされる)
            const newQ = Math.floor(Math.random() * total);
            questioner = newQ;
            usermode = [0, 0, 0, 0];
            usermode[questioner] = 1;
            console.log("新しい出題者は: " + questioner);
            io.emit("questioner decided", questioner);
            io.emit("usermodes", usermode);
        }

    　　} 


　　　});

　　　 socket.emit('timer_update', {timeLeft, counter}); // 接続時に最新状態を送信

  　　socket.on('clicked', () => {
   　　 counter++;
    　　timeLeft++; // 押されるたびに「残り時間を1秒延長」
    　io.emit('timer_update', {timeLeft, counter});
  　　});
　　　




});

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});

