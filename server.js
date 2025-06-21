// レビュー用のbranchです。

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

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});

