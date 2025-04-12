import { setTimeout } from 'timers/promises';
import { createLogger } from '../utilities/logger.js';
import { write } from '../utilities/db-connection.js';
const logger = createLogger('Lobbies', 'jsonl');
const LOBBY_SQL = `INSERT IGNORE INTO lobbies(lobby_id, start_time, end_time, fruit_data, server_time) VALUES (?,?,?,?,?)`;

let rounds = {};
let previousRound = {};

function generateFruitData(min, max) {
    const fruitCount = Math.floor(Math.random() * (max - min + 1) + min);
    const fruits = [];

    for (let i = 0; i < fruitCount; i++) {
        fruits.push({
            FruitId: i + 1,
            Multiplier: parseFloat(getRandomMultiplier()),
            AssetId: Math.floor(Math.random() * 11),
            Delay: Math.floor(Math.random() * 1000), // IN MS
            FlyTime: Math.floor(Math.random() * (1800 - 1200 + 1)) + 1200 //IN MS
        });
    }
    return fruits;
}

export function getRandomMultiplier() {
    const prob = Math.random();
    if (prob < 0.20) return 0.00;
    if (prob < 0.70) return (Math.random() * 0.51).toFixed(2);
    else if (prob < 0.80) return (Math.random() * (1.00 - 0.51) + 0.51).toFixed(2);
    else if (prob < 0.90) return (Math.random() * (2.00 - 1.00) + 1.00).toFixed(2);
    else return (Math.random() * (5.00 - 2.00) + 2.00).toFixed(2);
}

export async function startNewRound(socket, userId) {
    const roundId = `ROUND${Date.now()}`;
    const roundStartTime = Date.now();
    const roundEndTime = roundStartTime + 5000;
    const delay = 10;

    const newRound = {
        RoundId: roundId,
        RoundStartTime: roundStartTime,
        RoundEndTime: roundEndTime,
        Status: "NOT_STARTED",
        FruitData: generateFruitData(2, 4),
        serverTime: Date.now()
    };
    if ((Array.isArray(rounds[`${userId}`]))) rounds[`${userId}`].push(newRound)
    else rounds[`${userId}`] = [newRound];
    socket.emit('round', newRound);
    //log to logger the current round
    await setTimeout(1000);

    updateRoundStatus(socket, userId, roundId, 'ONGOING');
    await setTimeout(delay * 1000);

    endRound(socket, userId, roundId);
    await setTimeout(1000);

    if ((Array.isArray(previousRound[`${userId}`]))) previousRound[`${userId}`].push(newRound)
    else previousRound[`${userId}`] = [newRound];

    //Insert Into Database;
    delete newRound.Status;
    newRound.FruitData = JSON.stringify(newRound.FruitData);
    logger.info(JSON.stringify(newRound));
    // await write(LOBBY_SQL, [...Object.values(newRound)]);
    rounds.length = 0; //Deleting ended round to avoid unnecassary consumption of memory
    return startNewRound(socket);
}

function updateRoundStatus(socket, userId, roundId, status) {
    const round = rounds[`${userId}`].find(r => r.RoundId === roundId);
    if (round) {
        round.Status = status;
        round.serverTime = Date.now();
    }
    socket.emit('round', round);
}

function endRound(socket, userId, roundId) {
    const round = rounds[`${userId}`].find(r => r.RoundId === roundId);
    if (round) {
        round.Status = 'ENDED';
        round.RoundEndTime = Date.now();
        round.serverTime = Date.now();
    }
    socket.emit('round', round);
}

export function getCurrentRound(userId) {
    const lastCurRound = rounds[`${userId}`][rounds[`${userId}`].length - 1];
    return lastCurRound;
}

export function getRoundData(userId, roundId) {
    return rounds[`${userId}`].find(r => r.RoundId === roundId);
}

export function getPreviousRoundData(userId, roundId) {
    return previousRound[`${userId}`].find(r => r.RoundId === roundId);
}
