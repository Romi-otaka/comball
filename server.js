const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const io = require("socket.io")(server);
const PORT = 3001;

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

let r = Math.floor(Math.random() * 4);
let questioner;
let usermode = [0, 0, 0, 0];
let connectedSockets = [null, null, null, null];
let countquestion = 0;
let questiontext = ['', '', ''];
let answertext = ['', '', ''];
let answeredThisPhase = false;
let nextQuestioner = null;

let counter = 0;
let timeLeft = 30;
let anstimer = 0;
let isAnswerTimeActive = false;
let isGameTimeActive = false;
let clickedCount = [0, 0, 0, 0]; // ← 各プレイヤーのクリック数

let score = [0, 0, 0, 0]; // 各プレイヤーのスコア


function resetServerState() {
    r = Math.floor(Math.random() * 4);
    questioner = null;
    usermode = [0, 0, 0, 0];
    connectedSockets = [null, null, null, null];
    countquestion = 0;
    questiontext = ['', '', ''];
    answertext = ['', '', ''];
    answeredThisPhase = false;
    nextQuestioner = null;

    counter = 0;
    timeLeft = 30;
    anstimer = 0;
    isAnswerTimeActive = false;
    isGameTimeActive = false;
    clickedCount = [0, 0, 0, 0];
    score = [0, 0, 0, 0];
    
    console.log("⚠️ サーバー状態をリセットしました");
}


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

function updateAnswerTimer() {
    if (isAnswerTimeActive && anstimer > 0) {
        anstimer--;
    }
    if (isAnswerTimeActive && anstimer === 0) {
        handleAnswerTimeout();
    }
}

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

function handleAnswerTimeout() {
    console.log("回答時間が終了しました！");
    io.emit("answer_time_up");
    isAnswerTimeActive = false;

    // 誰も回答していなかった場合
    const qIndex = countquestion - 1;
    if (!answertext[qIndex]) {
        console.log("誰も回答しなかったため、回答者全員が3点減点されます。");


        // 回答者全員を減点（usermode = 0 のユーザー）
        for (let i = 0; i < 4; i++) {
            if (i !== questioner && connectedSockets[i]) {
                score[i] -= 3;


            }
        }

        // 質問数を戻す（カウントしない）
        countquestion--;

        // 次の質問は同じ質問者が再度入力できるようにする
        answeredThisPhase = false;

        // UIリセット通知（再度質問できるように）
        io.to(connectedSockets[questioner].id).emit("retry_question");  // 質問者だけに通知
    } else {
        // 通常の深掘りタイムへ
        timeLeft = 30;
        counter = 0;
        isGameTimeActive = true;
    }
}


function handleTimeUp() {
    if (countquestion >= 3) {
        io.emit("game finished", { questions: questiontext, answers: answertext });
        console.log("ゲーム終了: 質問3回完了");
        io.emit("game finished", {
            questions: questiontext,
            answers: answertext,
            scores: score  // ←★ スコアを追加で送信
        });
        return;
    }

    if (nextQuestioner !== null && connectedSockets[nextQuestioner]) {
        questioner = nextQuestioner;
    } else {
        const activeUsers = connectedSockets.map((s, i) => s ? i : null).filter(i => i !== null);
        if (activeUsers.length > 0) {
            questioner = activeUsers[Math.floor(Math.random() * activeUsers.length)];
        } else {
            console.log("出題者を選べませんでした。");
            return;
        }
    }

    usermode = [0, 0, 0, 0];
    usermode[questioner] = 1;
    console.log("新しい出題者: " + questioner);

    io.emit("questioner decided", questioner);
    io.emit("usermodes", usermode);

    answeredThisPhase = false;
    nextQuestioner = null;
    clickedCount = [0, 0, 0, 0]; // 各フェーズの最初でリセット
}

function handleClick(socket) {
    const usernumber = socket.data.usernumber;
    if (usernumber === undefined) return;

    clickedCount[usernumber]++;
    score[usernumber] += 5;  // ⭐ 自分に +5 点

    // ⭐ 質問者に +1 点（自分が質問者でなければ）
    if (questioner !== undefined && questioner !== usernumber) {
        score[questioner] += 1;
    }

    // ⭐ 回答者に +1 点（自分が回答者でなければ）
    if (nextQuestioner !== null && nextQuestioner !== usernumber) {
        score[nextQuestioner] += 1;
    }

    const totalClicks = clickedCount.reduce((a, b) => a + b, 0);

    if (isGameTimeActive && totalClicks % 3 === 0) {
        timeLeft++;
    }

    connectedSockets.forEach((sock, idx) => {
        if (sock) {
            sock.emit('timer_update', {
                timeLeft,
                counter: clickedCount[idx],
                anstimer,
                score: score[idx]
            });
        }
    });
}

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
    }
}

function handleSendAnswer(socket, answer) {
    const usernumber = socket.data.usernumber;
    const qIndex = countquestion - 1;

    if (qIndex >= 0 && qIndex < 3) {
        if (!answertext[qIndex]) {
            answertext[qIndex] = answer;
            nextQuestioner = usernumber;
            console.log(`【記録】ユーザー${usernumber}の回答: ${answer}`);


            isAnswerTimeActive = false;
            io.emit("answer locked", { user: usernumber });
            handleAnswerTimeout();
        } else {
            console.log(`ユーザー${usernumber}の回答（記録済みのため保存せず）: ${answer}`);
        }
    }

    io.emit("answer received", { user: usernumber, text: answer });
}

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

function getAvailableUserNumber() {
    return connectedSockets.findIndex(s => s === null);
}

function rejectConnectionFull(socket) {
    socket.emit("login rejected", "これ以上参加できません。定員に達しています。");
    socket.disconnect(true);
}

function reset() {
    console.log("🔄 リセット要求を受信。ゲームを初期化します。");

    // サーバー状態リセット（scoreやクリック数など）
    r = Math.floor(Math.random() * 4);
    questioner = null;
    usermode = [0, 0, 0, 0];
    countquestion = 0;
    questiontext = ['', '', ''];
    answertext = ['', '', ''];
    answeredThisPhase = false;
    nextQuestioner = null;

    counter = 0;
    timeLeft = 30;
    anstimer = 0;
    isAnswerTimeActive = false;
    isGameTimeActive = false;
    clickedCount = [0, 0, 0, 0];
    score = [0, 0, 0, 0];

    // 現在接続中のユーザーの数を数える
    const currentUsers = connectedSockets.filter(s => s !== null).length;

    // 出題者をランダムに選ぶ
    if (currentUsers === 4) {
        questioner = r;
        usermode[questioner] = 1;

        console.log("🔁 出題者は: " + questioner);
        io.emit("questioner decided", questioner);
        io.emit("usermodes", usermode);
    } else {
        console.log(`⚠️ リセット後、${currentUsers}人しか接続していません。4人必要です。`);
    }

    // 全クライアントに初期化情報を送信
    connectedSockets.forEach((sock, idx) => {
        if (sock) {
            sock.emit("reset_done", {
                yourNumber: idx,
                score: 0,
                clicked: 0
            });
        }
    });
}



setInterval(() => {
    // Timer変数の増加
    updateAnswerTimer();
    updateGameTimer();

    // // Timer変数の送信
    // connectedSockets.forEach((sock, idx) => {
    //     if (sock) {
    //         sock.emit("timer_update", {
    //             timeLeft,
    //             counter: clickedCount[idx],
    //             anstimer,
    //             score: score[idx]
    //         });
    //     }
    // });
}, 1000); // 毎秒送信

setInterval(() => {
    // 0.5秒ごとにタイマー状態をクライアントに送信
    connectedSockets.forEach((sock, idx) => {
        if (sock) {
            sock.emit("timer_update", {
                timeLeft,
                counter: clickedCount[idx],
                anstimer,
                score: score[idx]
            });
        }
    });
}, 50);




//変数を分ける　　1000m秒と100ミリ秒とかで分ける

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

    socket.on("send answer", (answer) => {
        handleSendAnswer(socket, answer);
    });

    socket.on("clicked", () => {
        handleClick(socket);
    });

    socket.emit("timer_update", {
        timeLeft,
        counter: clickedCount[usernumber],
        anstimer
    });
     socket.on("reset", () => {
       reset();
    });


});

server.listen(PORT, () => {
    resetServerState();  // ← 起動時に状態リセット！
    console.log(`listening on ${PORT}`);

});


//push用　
//点数の時間の点数