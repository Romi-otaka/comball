const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const io = require("socket.io")(server);
const PORT = 3001;

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

let r = Math.floor(Math.random() * 4);  // 出題者候補（0〜3）
let questioner;
let usermode = [0, 0, 0, 0];            // 各ユーザーのモード（0: 回答者, 1: 出題者）
let connectedSockets = [null, null, null, null];  // usernumberに対応するソケット
let countquestion = 0;
let questiontext = ['', '', ''];
let score = [0, 0, 0, 0];

// ゲーム用タイマー
let counter = 0;
let timeLeft = 30;
//回答用タイマー
let anstimer=20;

setInterval(() => {
    if (timeLeft > 0) {
        timeLeft--;
    } else if (timeLeft === 0) {
        // 出題者交代処理
        const activeUsers = connectedSockets
            .map((s, index) => s ? index : null)
            .filter(i => i !== null);

        if (activeUsers.length > 0) {
            const newQ = activeUsers[Math.floor(Math.random() * activeUsers.length)];
            questioner = newQ;
            usermode = [0, 0, 0, 0];
            usermode[questioner] = 1;
            console.log("時間切れによる新しい出題者は: " + questioner);
            io.emit("questioner decided", questioner);
            io.emit("usermodes", usermode);
        }

        timeLeft = 30;
        counter = 0;
    }

    io.emit('timer_update', { timeLeft, counter });
}, 1000);

io.on("connection", (socket) => {
    console.log("ユーザーが接続しました。");

    // 空き usernumber を探す
    const usernumber = connectedSockets.findIndex(s => s === null);

    if (usernumber === -1) {
        socket.emit("login rejected", "これ以上参加できません。定員に達しています。");
        socket.disconnect(true);
        return;
    }

    // ソケットと usernumber を保存
    connectedSockets[usernumber] = socket;
    socket.data.usernumber = usernumber;

    socket.on("chat message", (msg) => {
        socket.data.username = msg;
        io.emit("cmessage", msg);
    });

    socket.on("login", (ack) => {
        socket.emit("user number", usernumber);
        console.log(`${usernumber}さんが参加しました。`);

        socket.broadcast.emit("user joined", `${usernumber}さんが参加しました。`);

        const currentUsers = connectedSockets.filter(s => s !== null).length;
        if (currentUsers === 4) {
            questioner = r;
            usermode = [0, 0, 0, 0];
            usermode[questioner] = 1;
            console.log("出題者は: " + questioner);
            io.emit("questioner decided", questioner);
            io.emit("usermodes", usermode);
        }

        ack({ number: usernumber });
    });

    socket.on("disconnect", () => {
        console.log(`ユーザー${usernumber}が切断しました。`);
        connectedSockets[usernumber] = null;

        // 出題者が切断されたら無効化
        if (questioner === usernumber) {
            questioner = null;
            io.emit("questioner decided", null);
        }

        io.emit("user left", usernumber);
    });

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

    socket.emit('timer_update', { timeLeft, counter });

    socket.on('clicked', () => {
        counter++;
        timeLeft++;
        io.emit('timer_update', { timeLeft, counter });
    });
});

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});
