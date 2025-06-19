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

// ゲーム用深掘りタイマー
let counter = 0;
let timeLeft = 30;
//回答用タイマー
let anstimer=20;


// ログイン処理を関数化
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


//深掘りタイムの関数
function updateGameTimer() {
    if (timeLeft > 0) {
        timeLeft--;
    } else if (timeLeft === 0) {
        handleTimeUp();  // 出題者交代処理など
        timeLeft = 30;
        counter = 0;
    }
}
//回答用のタイマー
function updateAnswerTimer() {
    if (anstimer > 0) {
        anstimer--;
    } else if (anstimer === 0) {
        handleAnswerTimeout();  // 回答時間終了時の処理
        anstimer = 0;  // 何度も呼ばれないように（必要であれば）
    }
}

// 出題者交代処理
function handleTimeUp() {
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
        anstimer = 20;  // 出題者交代時に回答タイマーもリセット
    }
}

// 回答タイマーが0になったときの処理
function handleAnswerTimeout() {
    console.log("回答時間が終了しました！");
    io.emit("answer_time_up");
    // 必要があれば、他の状態もリセットや通知を入れる
}



// クリック時の処理関数
function handleClick(socket) {
    counter++;
    timeLeft++;  // 時間延長（深掘りタイマー）
    io.emit('timer_update', { timeLeft, counter, anstimer });
}



//ユーザの切断
function handleDisconnect(socket) {
    const usernumber = socket.data.usernumber;

    console.log(`ユーザー${usernumber}が切断しました。`);

    // usernumber が未定義の場合も保険的にチェック
    if (usernumber !== undefined && connectedSockets[usernumber]) {
        connectedSockets[usernumber] = null;

        // 出題者だったら無効化
        if (questioner === usernumber) {
            questioner = null;
            io.emit("questioner decided", null);
        }

        io.emit("user left", usernumber);
    }
}




// 質問を送信する処理
function handleSendQuestion(socket, qtext) {
    const usernumber = socket.data.usernumber;

    if (usernumber === questioner) {
        questiontext[countquestion] = qtext;
        countquestion++;
        console.log(`質問${countquestion}: ${qtext}`);

        io.emit("new question", {
            index: countquestion - 1,
            text: qtext
        });

        // 回答タイマーをリセット（必要に応じて）
        anstimer = 20;
    } else {
        console.log(`ユーザー${usernumber}は出題者ではないため質問できません。`);
    }
}

//空きユーザを探す処理
function getAvailableUserNumber() {
    return connectedSockets.findIndex(s => s === null);
}


// 定員に達したときに接続を拒否する処理
function rejectConnectionFull(socket) {
    socket.emit("login rejected", "これ以上参加できません。定員に達しています。");
    socket.disconnect(true);
}


// メインのタイマー管理（1秒ごと）
setInterval(() => {
    updateGameTimer();
    updateAnswerTimer();

    io.emit('timer_update', {
        timeLeft,
        counter,
        anstimer
    });
}, 1000);


io.on("connection", (socket) => {
    console.log("ユーザーが接続しました。");

    const usernumber = getAvailableUserNumber();

    if (usernumber === -1) {
    rejectConnectionFull(socket);
    return;
　　}



    // ソケットと usernumber を保存
    connectedSockets[usernumber] = socket;
    socket.data.usernumber = usernumber;

    socket.on("chat message", (msg) => {
        socket.data.username = msg;
        io.emit("cmessage", msg);
    });

    // イベント登録部
　　socket.on("login", (ack) => {
   　　　　 handleLogin(socket, ack, usernumber);
　　});

    socket.on("disconnect", () => {
          handleDisconnect(socket);
    });

    socket.on("send question", (qtext) => {
        handleSendQuestion(socket, qtext);
    });

    socket.emit('timer_update', { timeLeft, counter });

    socket.on('clicked', () => {
         handleClick(socket);
    });
});

server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
});
