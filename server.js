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
let countquestion = 0;
let questiontext = ['', '', ''];
let score = [0, 0, 0];

// ゲーム用タイマー
let counter = 0;       // ボタンの押下回数
let timeLeft = 30;     // 初期制限時間（秒）

// 1秒ごとに timeLeft を減らし、全クライアントへ配信
setInterval(() => {
    if (timeLeft > 0) {
        timeLeft--;
    } else if (timeLeft === 0) {
        // 出題者交代処理（1回だけ実行されるように工夫）
        const total = i;  // 参加人数
        const newQ = Math.floor(Math.random() * total);
        questioner = newQ;
        usermode = [0, 0, 0, 0];
        usermode[questioner] = 1;
        console.log("時間切れによる新しい出題者は: " + questioner);
        io.emit("questioner decided", questioner);
        io.emit("usermodes", usermode);

        // タイマーとカウンターのリセット
        timeLeft = 30;
        counter = 0;
    }

    io.emit('timer_update', { timeLeft, counter });
}, 1000);

io.on("connection", (socket) => {
    console.log("ユーザーが接続しました。");

    if (connectedSockets.length >= 4) {
        socket.emit("login rejected", "これ以上参加できません。定員に達しています。");
        socket.disconnect(true);  // 強制切断
        return;
    }

    connectedSockets.push(socket);  // ソケットを登録

    socket.on("chat message", (msg) => {
        socket.data.username = msg;
        io.emit("cmessage", msg);
    });

    socket.on("login", (ack) => {
        socket.data.usernumber = i;
        socket.emit("user number", socket.data.usernumber);
        console.log(`${i}さんが参加しました。`);
        i++;

        socket.broadcast.emit("user joined", `${socket.data.usernumber}さんが参加しました。`);

        if (i === 4) {
            questioner = r;
            usermode = [0, 0, 0, 0];
            usermode[questioner] = 1;
            console.log("出題者は: " + questioner);
            io.emit("questioner decided", questioner);
            io.emit("usermodes", usermode);
        }

        ack({ number: socket.data.usernumber });  // 個別返答
    });

    socket.on("disconnect", () => {
        console.log("ユーザーが切断しました。");
        connectedSockets = connectedSockets.filter(s => s !== socket);
    });

    // 出題者からの質問受信
    socket.on("send question", (qtext) => {
        if (socket.data.usernumber === questioner) {
            questiontext[countquestion] = qtext;
            countquestion++;
            console.log(`質問${countquestion}: ${qtext}`);

            io.emit("new question", {
                index: countquestion - 1,
                text: qtext
            });
        }
    });

    // 接続時に最新のタイマーとカウントを送信
    socket.emit('timer_update', { timeLeft, counter });

    // ボタンクリックでカウントと時間増加
    socket.on('clicked', () => {
        counter++;
        timeLeft++;  // 時間延長
        io.emit('timer_update', { timeLeft, counter });
    });
});

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});
