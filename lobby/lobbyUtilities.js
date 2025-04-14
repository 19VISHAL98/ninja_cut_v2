import { setTimeout } from 'timers/promises';
import { createLogger } from '../utilities/logger.js';
import { write } from '../utilities/db-connection.js';
import { getCache, deleteCache } from '../utilities/redis-connection.js';

const logger = createLogger('Lobbies', 'jsonl');
const LOBBY_SQL = `INSERT IGNORE INTO lobbies(lobby_id, start_time, end_time, fruit_data, server_time) VALUES (?,?,?,?,?)`;

let rounds = {};
const activeIntervals = {};

function generateFruitData(min, max) {
    const fruitCount = Math.floor(Math.random() * (max - min + 1) + min);
    const fruits = [];

    for (let i = 0; i < fruitCount; i++) {
        fruits.push({
            FruitId: i + 1,
            Multiplier: parseFloat(getRandomMultiplier()),
            AssetId: Math.floor(Math.random() * 11),
            Delay: Math.floor(Math.random() * 1000), // in ms
            FlyTime: Math.floor(Math.random() * (1800 - 1200 + 1)) + 1200 // in ms
        });
    }

    return fruits;
}

export function getRandomMultiplier() {
    const prob = Math.random();
    if (prob < 0.20) return 0.00;
    if (prob < 0.70) return (Math.random() * 0.51).toFixed(2);
    if (prob < 0.80) return (Math.random() * (1.00 - 0.51) + 0.51).toFixed(2);
    if (prob < 0.90) return (Math.random() * (2.00 - 1.00) + 1.00).toFixed(2);
    return (Math.random() * (5.00 - 2.00) + 2.00).toFixed(2);
}

export async function startRoundsForUser(socket, userId) {
    if (activeIntervals[userId]) {
        console.warn(`⚠️ Rounds already running for user ${userId}`);
        return;
    }
    const startTime = Date.now();
    let isRunning = true;

    async function roundHandler() {
        if (!isRunning || !socket.connected) {
            stopRoundsForUser(userId);
            return;
        }

        const now = Date.now();
        if (now - startTime >= 5 * 60 * 1000) {
            stopRoundsForUser(userId);
            console.log(`⏹️ Stopped rounds for user ${userId}`);
            return;
        }

        try {
            await handleRound(socket, userId);
        } catch (error) {
            console.error(`❌ Error in round for user ${userId}:`, error);
            stopRoundsForUser(userId);
        }
    }

    await roundHandler();
    const interval = setInterval(roundHandler, 10000);
    activeIntervals[userId] = interval;
    console.log(`▶️ Started rounds for user ${userId}`);
}

export function stopRoundsForUser(userId) {
    if (activeIntervals[userId]) {
        clearInterval(activeIntervals[userId]);
        delete activeIntervals[userId];
        console.log(`🛑 Manually stopped rounds for user ${userId}`);
    } else {
        console.log(`ℹ️ No active rounds to stop for user ${userId}`);
    }
}

async function handleRound(socket, userId) {
    const roundId = `ROUND${Date.now()}`;
    const roundStartTime = Date.now();
    const roundEndTime = roundStartTime + 5000;

    const newRound = {
        RoundId: roundId,
        RoundStartTime: roundStartTime,
        RoundEndTime: roundEndTime,
        FruitData: generateFruitData(2, 4),
        serverTime: Date.now()
    };

    if (!Array.isArray(rounds[userId])) rounds[userId] = [];
    rounds[userId].push(newRound);

    console.log("✅ Round added for user:", userId);

    if (socket.connected) {
        socket.emit('round', newRound);
    }

    await setTimeout(10000); // simulate wait for round to complete

    const dbPayload = [
        newRound.RoundId,
        newRound.RoundStartTime,
        newRound.RoundEndTime,
        JSON.stringify(newRound.FruitData),
        newRound.serverTime
    ];

    logger.info(JSON.stringify(newRound));
    console.log("📦 Saving round to DB:", { newRound });

    try {
        const result = await write(LOBBY_SQL, dbPayload);
        console.log("✅ DB Write Result:", result);
    } catch (dbErr) {
        console.error("❌ Failed to insert round into DB:", dbErr);
    }

    rounds[userId] = []; // optional: reset rounds for this user
}

export function getCurrentRound(userId) {
    const r = rounds[userId];
    return Array.isArray(r) && r.length > 0 ? r[r.length - 1] : null;
}

export const handleDisconnect = async (socket) => {
    try {
        const cachedData = await getCache(`PL:${socket.id}`);
        if (cachedData) {
            const playerDetails = typeof cachedData === 'string' ? JSON.parse(cachedData) : cachedData;
            if (playerDetails.user_id) {
                stopRoundsForUser(playerDetails.user_id);
                console.log(`🛑 User ${playerDetails.user_id} disconnected: ${socket.id}`);
            }
        } else {
            console.log(`ℹ️ No cached player for socket: ${socket.id}`);
        }

        await deleteCache(`PL:${socket.id}`);
    } catch (err) {
        console.error(`❌ Error during disconnect handling for ${socket.id}:`, err);
    } finally {
        socket.disconnect(true);
    }
};
