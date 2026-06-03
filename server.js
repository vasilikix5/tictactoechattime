const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let waitingPlayer = null;
let games = {};
const TURN_TIME_LIMIT = 15; 

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- MATCHMAKING ---
    if (waitingPlayer) {
        const roomName = `room-${waitingPlayer.id}-${socket.id}`;
        socket.join(roomName);
        waitingPlayer.join(roomName);

        games[roomName] = {
            players: [waitingPlayer.id, socket.id],
            board: Array(9).fill(null),
            turn: waitingPlayer.id,
            timer: null,
            timeLeft: TURN_TIME_LIMIT,
            rematchVotes: {} 
        };

        startGameRound(roomName);
        waitingPlayer = null;
    } else {
        waitingPlayer = socket;
        socket.emit('waiting', 'Περιμένω αντίπαλο για Blitz παρτίδα...');
    }

    // --- START ROUND ---
    function startGameRound(room) {
        const game = games[room];
        if (!game) return;

        game.board = Array(9).fill(null);
        game.rematchVotes = {};
        game.turn = game.players[0]; 

        io.to(game.players[0]).emit('gameStart', { room, symbol: 'X', myTurn: true });
        io.to(game.players[1]).emit('gameStart', { room, symbol: 'O', myTurn: false });

        resetTurnTimer(room);
    }

    // --- TIMER LOGIC ---
    function resetTurnTimer(room) {
        const game = games[room];
        if (!game) return;

        clearInterval(game.timer);
        game.timeLeft = TURN_TIME_LIMIT;

        io.to(room).emit('timerUpdate', { timeLeft: game.timeLeft, turn: game.turn });

        game.timer = setInterval(() => {
            game.timeLeft--;
            io.to(room).emit('timerUpdate', { timeLeft: game.timeLeft, turn: game.turn });

            if (game.timeLeft <= 0) {
                clearInterval(game.timer);
                handleTimeout(room);
            }
        }, 1000);
    }

    function handleTimeout(room) {
        const game = games[room];
        if (!game) return;

        const loserId = game.turn;
        const winnerId = game.players.find(id => id !== loserId);
        
        io.to(room).emit('gameOver', { winner: winnerId, reason: 'timeout', board: game.board });
    }

    // --- GAME ACTIONS ---
    socket.on('makeMove', ({ room, index }) => {
        const game = games[room];
        if (game && game.turn === socket.id && game.board[index] === null) {
            const currentSymbol = game.players[0] === socket.id ? 'X' : 'O';
            game.board[index] = currentSymbol;
            
            const winStatus = checkWinnerBackend(game.board);
            
            if (winStatus === 'win') {
                clearInterval(game.timer);
                io.to(room).emit('moveMade', { board: game.board, turn: null });
                io.to(room).emit('gameOver', { winner: socket.id, reason: 'win', board: game.board });
            } else if (winStatus === 'draw') {
                clearInterval(game.timer);
                io.to(room).emit('moveMade', { board: game.board, turn: null });
                io.to(room).emit('gameOver', { winner: null, reason: 'draw', board: game.board });
            } else {
                game.turn = game.players.find(id => id !== socket.id);
                io.to(room).emit('moveMade', { board: game.board, turn: game.turn });
                resetTurnTimer(room);
            }
        }
    });

    // --- REMATCH LOGIC ---
    socket.on('requestRematch', ({ room }) => {
        const game = games[room];
        if (game) {
            game.rematchVotes[socket.id] = true;
            
            // Ειδοποίηση στον άλλον παίκτη
            socket.to(room).emit('rematchRequested');

            // Αν ψηφίσουν και οι δύο (2 votes), ξεκινάει νέος γύρος
            if (Object.keys(game.rematchVotes).length === 2) {
                startGameRound(room);
            }
        }
    });

    // --- CHAT LOGIC ---
    socket.on('sendMessage', ({ room, message }) => {
        if (room && message.trim() !== "" && games[room]) {
            const senderSymbol = socket.id === games[room].players[0] ? 'X' : 'O';
            io.to(room).emit('receiveMessage', { sender: senderSymbol, text: message.trim() });
        }
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        if (waitingPlayer && waitingPlayer.id === socket.id) waitingPlayer = null;
        
        for (const room in games) {
            if (games[room].players.includes(socket.id)) {
                clearInterval(games[room].timer);
                socket.to(room).emit('opponentLeft');
                delete games[room];
            }
        }
    });
});

function checkWinnerBackend(board) {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (let line of lines) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return 'win';
    }
    if (!board.includes(null)) return 'draw';
    return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
