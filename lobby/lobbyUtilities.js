import { setTimeout } from 'timers/promises';
import { createLogger } from '../utilities/logger.js';
import { write } from '../utilities/db-connection.js';
import { getCache, deleteCache, setCache } from '../utilities/redis-connection.js';

const logger = createLogger('Lobbies', 'jsonl');
const LOBBY_SQL = `INSERT IGNORE INTO lobbies(lobby_id, start_time, end_time, fruit_data, server_time) VALUES (?,?,?,?,?)`;

const lobbyIntervals = new Map();

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

export async function startRoundsForUser(socket, lobbyId) {
    const lobbyData = await getCache(lobbyId);
    const parsedLobbyData = JSON.parse(lobbyData);
    console.log("lobby data", JSON.stringify(parsedLobbyData));
    if (parsedLobbyData) {
        console.warn(`⚠️ Rounds already running for user ${lobbyId}`);
        return;
    }
    const startTime = Date.now();
    async function roundHandler() {
        if (!socket.connected) {
            await stopRoundsForUser(lobbyId);
            return;
        }

        const now = Date.now();
        if (now - startTime >= 50 * 1000) {
            await stopRoundsForUser(lobbyId);
            console.log(`⏹️ Stopped rounds for user ${lobbyId}`);
            return;
        }

        try {
            await handleRound(socket, lobbyId);
        } catch (error) {
            console.error(`❌ Error in round for user ${lobbyId}:`, error);
            await stopRoundsForUser(lobbyId);
        }
    }

    await roundHandler();
    const interval = setInterval(roundHandler, 10000);
    lobbyIntervals.set(lobbyId, interval);
    console.log(`▶️ Started rounds for user ${lobbyId}`);
}

export async function stopRoundsForUser(lobbyId) {
    try {
        const interval = lobbyIntervals.get(lobbyId); // get the interval object
        if (interval) {
            clearInterval(interval); // stop the interval
            lobbyIntervals.delete(lobbyId); // clean up the memory
            await deleteCache(lobbyId);
            console.log(`🛑 Manually stopped rounds for user ${lobbyId}`);
        } else {
            console.log(`ℹ️ No active rounds to stop for user ${lobbyId}`);
        }
    } catch (error) {
        console.error("❌ Error occurred during stopping lobby:", error.message);
    }
}


async function handleRound(socket, lobbyId) {
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

    await setCache(lobbyId, JSON.stringify(newRound))

    console.log("✅ Round added for user:", lobbyId);

    if (socket.connected) {
        socket.emit('round', newRound);
    }

    await setTimeout(5000); // simulate wait for round to complete

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
}

export async function getCurrentRound(lobbyId) {
    return JSON.parse(await getCache(lobbyId));
}

export async function handleDisconnect(socket) {
    try {
        const cachedData = await getCache(`PL:${socket.id}`);
        if (cachedData) {
            const playerDetails = typeof cachedData === 'string' ? JSON.parse(cachedData) : cachedData;
            if (playerDetails.user_id) {
                const lobbyId = `LB:${playerDetails.operatorId}:${playerDetails.user_id}`;
                await stopRoundsForUser(lobbyId);
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
