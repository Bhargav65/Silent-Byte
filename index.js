const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
require('dotenv').config()

const MONGO_URL = process.env.uri || process.env.URI;
const DB_NAME = 'videochat';
const ROOMS = 'rooms';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});
app.use(express.static(__dirname));

app.get('/chat.html', (_, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/waiting.html', (_, res) => res.sendFile(path.join(__dirname, 'waiting.html')));
app.get('/create_room', (_, res) => res.sendFile(path.join(__dirname, 'createroom.html')));
app.get('/join_room', (_, res) => res.sendFile(path.join(__dirname, 'join_room.html')));

let roomsColl;
MongoClient.connect(MONGO_URL, { useUnifiedTopology: true })
    .then(client => {
        const db = client.db(DB_NAME);
        roomsColl = db.collection(ROOMS);
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
    })
    .catch(err => { console.error(err); process.exit(1); });


io.on('connection', (socket) => {
    socket.on('create-room', async (roomCode, cb) => {
        if (!/^[A-Za-z0-9]{6}$/.test(roomCode)) return cb({ success: false, msg: 'Invalid code' });
        const exists = await roomsColl.findOne({ roomCode });
        //if (exists) return cb({success:false, msg:'Room already exists!'});
        if (!exists) {
            await roomsColl.insertOne({ roomCode, users: [{ socketId: socket.id, role: 'user1' }] });
        } else {
            const hasUser1 = exists.users.some(u => u.role === 'user1');
            if (hasUser1) {
                await roomsColl.updateOne({ roomCode, 'users.role': 'user1' }, { $set: { 'users.$.socketId': socket.id } });
            } else {
                await roomsColl.updateOne({ roomCode }, { $push: { users: { socketId: socket.id, role: 'user1' } } });
            }
        }
        socket.join(roomCode);
        cb({ success: true, role: 'user1' });
    });


    socket.on('join-room', async (roomCode, cb) => {
        if (!/^[A-Za-z0-9]{6}$/.test(roomCode)) return cb({ success: false, msg: 'Invalid code' });
        const room = await roomsColl.findOne({ roomCode });
        if (!room || !Array.isArray(room.users) || room.users.length == 0) {
            return cb({ success: false, msg: 'Room not found or user1 missing' });
        }

        const hasUser2 = room.users.some(u => u.role === 'user2');
        if (hasUser2) {
            await roomsColl.updateOne({ roomCode, 'users.role': 'user2' }, { $set: { 'users.$.socketId': socket.id } });
        } else {
            await roomsColl.updateOne({ roomCode }, { $push: { users: { socketId: socket.id, role: 'user2' } } });
        }

        socket.join(roomCode);
        cb({ success: true, role: 'user2' });

        // Find user1 safely:
        const updatedRoom = await roomsColl.findOne({ roomCode });
        const user1Info = updatedRoom.users.find(u => u.role === 'user1');
        if (user1Info && user1Info.socketId) {
            io.to(user1Info.socketId).emit('start-chat', { roomCode });
        }
    });

    socket.on('rejoin-room', async ({ roomCode, role }) => {
        let room = await roomsColl.findOne({ roomCode });
        if (!room) {
            await roomsColl.insertOne({ roomCode, users: [{ socketId: socket.id, role }] });
        } else {
            const hasRole = room.users.some(u => u.role === role);
            if (hasRole) {
                await roomsColl.updateOne(
                    { roomCode, 'users.role': role },
                    { $set: { 'users.$.socketId': socket.id } }
                );
            } else {
                await roomsColl.updateOne(
                    { roomCode },
                    { $push: { users: { socketId: socket.id, role } } }
                );
            }
        }

        socket.join(roomCode);

        // Fetch the (possibly updated) room
        const updatedRoom = await roomsColl.findOne({ roomCode });
        if (updatedRoom) {
            const user1 = updatedRoom.users.find(u => u.role === 'user1');
            const user2 = updatedRoom.users.find(u => u.role === 'user2');

            // If both are present, trigger renegotiation for both
            if (user1 && user2) {
                io.to(user1.socketId).emit('restart-webrtc');
                io.to(user2.socketId).emit('restart-webrtc');
            }
        }
        io.to(roomCode).emit('start-chat', { roomCode });
    });

    socket.on('leave-room', (roomCode) => {
        socket.leave(roomCode);
        // Broadcast to everyone (including the leaver)
        io.in(roomCode).emit('peer-left');
    });

    // --- WebRTC signaling only: offer/answer/ICE ---
    socket.on('offer', data => { socket.to(data.roomCode).emit('offer', { sdp: data.sdp }); });
    socket.on('answer', data => { socket.to(data.roomCode).emit('answer', { sdp: data.sdp }); });
    socket.on('ice-candidate', data => { socket.to(data.roomCode).emit('ice-candidate', { candidate: data.candidate }); });

    socket.on('disconnect', async (reason) => {
        const room = await roomsColl.findOne({ "users.socketId": socket.id });
        if (!room) return;
        await roomsColl.updateOne(
            { roomCode: room.roomCode },
            { $pull: { users: { socketId: socket.id } } }
        );
        const updated = await roomsColl.findOne({ roomCode: room.roomCode });
        if (!updated || updated.users.length === 0) {
            await roomsColl.deleteOne({ roomCode: room.roomCode });
        }
    });
});
