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
let usermode = [0, 0, 0, 0];
let connectedSockets = [null, null, null, null];
let countquestion = 0;
let questiontext = ['', '', ''];
let answeredThisPhase = false; // ← フェーズ中に質問済みかどうか
let score = [0, 0, 0, 0];

// タイマーと制御フラグ
let counter = 0;
let timeLeft = 30;
let anstimer = 0;

let isAnswerTimeActive = false;
let isGameTimeActive = false;





// ログイン処理
function handleLogin(socket, ack, usernumber) {
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
}


// 回答タイマー処理
function updateAnswerTimer() {
    if (isAnswerTimeActive && anstimer > 0) {
        anstimer--;
    }

    if (isAnswerTimeActive && anstimer === 0) {
        handleAnswerTimeout();
    }
}


// 深掘りタイマー処理
function updateGameTimer() {
    if (isGameTimeActive && timeLeft > 0) {
        timeLeft--;
    }

    if (isGameTimeActive && timeLeft === 0) {
        handleTimeUp();
        timeLeft = 30;
        counter = 0;
        isGameTimeActive = false;
    }
}


// 回答タイマー終了処理 → 深掘りタイマー開始
function handleAnswerTimeout() {
    console.log("回答時間が終了しました！");
    io.emit("answer_time_up");

    isAnswerTimeActive = false;

    // 深掘りタイマー開始
    timeLeft = 30;
    counter = 0;
    isGameTimeActive = true;
}


// 深掘りタイマー終了処理 → 出題者交代


function handleTimeUp() {
    if (countquestion >= 3) {
        io.emit("game finished", questiontext); // ゲーム終了を通知
        console.log("ゲーム終了: 質問3回完了");
        return;
    }

    const activeUsers = connectedSockets
        .map((s, index) => s ? index : null)
        .filter(i => i !== null);

    if (activeUsers.length > 0) {
        const newQ = activeUsers[Math.floor(Math.random() * activeUsers.length)];
        questioner = newQ;
        usermode = [0, 0, 0, 0];
        usermode[questioner] = 1;
        console.log("新しい出題者: " + questioner);
        io.emit("questioner decided", questioner);
        io.emit("usermodes", usermode);
        answeredThisPhase = false;  // 次フェーズで質問可能に戻す
    }
}



// クリックで深掘り時間延長
function handleClick(socket) {
    if (isGameTimeActive) {
        counter++;
        timeLeft++;
        io.emit('timer_update', { timeLeft, counter, anstimer });
    }
}


// 質問送信処理 → 回答タイマー開始
function handleSendQuestion(socket, qtext) {
    const usernumber = socket.data.usernumber;

    if (countquestion >= 3) {
        socket.emit("question rejected", "ゲームは終了しました（最大3問）。");
        return;
    }

    if (usernumber === questioner) {
        if (answeredThisPhase) {
            socket.emit("question rejected", "このフェーズではすでに質問済みです。");
            return;
        }

        questiontext[countquestion] = qtext;
        countquestion++;
        answeredThisPhase = true;
        console.log(`質問${countquestion}: ${qtext}`);

        io.emit("new question", {
            index: countquestion - 1,
            text: qtext
        });

        anstimer = 20;
        isAnswerTimeActive = true;
        isGameTimeActive = false;

    } else {
        console.log(`ユーザー${usernumber}は出題者ではないため質問できません。`);
    }
}



// 切断処理
function handleDisconnect(socket) {
    const usernumber = socket.data.usernumber;

    if (usernumber !== undefined && connectedSockets[usernumber]) {
        connectedSockets[usernumber] = null;

        if (questioner === usernumber) {
            questioner = null;
            io.emit("questioner decided", null);
        }

        io.emit("user left", usernumber);
        console.log(`ユーザー${usernumber}が切断しました。`);
    }
}


// 空きスロット取得
function getAvailableUserNumber() {
    return connectedSockets.findIndex(s => s === null);
}


// 定員オーバー拒否
function rejectConnectionFull(socket) {
    socket.emit("login rejected", "これ以上参加できません。定員に達しています。");
    socket.disconnect(true);
}


// タイマー更新
setInterval(() => {
    updateAnswerTimer();
    updateGameTimer();

    io.emit('timer_update', {
        timeLeft,
        counter,
        anstimer
    });
}, 1000);


// 接続処理
io.on("connection", (socket) => {
    console.log("ユーザーが接続しました。");

    const usernumber = getAvailableUserNumber();

    if (usernumber === -1) {
        rejectConnectionFull(socket);
        return;
    }

    connectedSockets[usernumber] = socket;
    socket.data.usernumber = usernumber;


    socket.on("login", (ack) => {
        handleLogin(socket, ack, usernumber);
    });

    socket.on("disconnect", () => {
        handleDisconnect(socket);
    });

    socket.on("send question", (qtext) => {
        handleSendQuestion(socket, qtext);
    });

    socket.on("clicked", () => {
        handleClick(socket);
    });

    // 最初のタイマー情報送信
    socket.emit("timer_update", { timeLeft, counter, anstimer });
});

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});
