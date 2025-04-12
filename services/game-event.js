import { appConfig } from "../utilities/app-config.js";
console.log(appConfig)
import { generateUUIDv7, prepareDataForWebhook, updateBalanceFromAccount } from "../utilities/common-function.js";
import { getCache, deleteCache, setCache } from "../utilities/redis-connection.js";
import { createLogger } from "../utilities/logger.js";
import { bet_amount, logEventAndEmitResponse } from "../utilities/helper-function.js";
import { insertSettlement } from "../module/bets/bet-db.js";
import { sendToQueue } from "../utilities/amqp.js";

const betLogger = createLogger('Bets', 'jsonl');
const multipliers = [4, 6, 15, 25, 55, "wild"];

const getTotalBetAmount = (bet) => {
    return bet.split(',').reduce((total, item) => total + Number(item.split('-')[1]), 0);
};

export const disconnect = async (socket) => {
    const playerDetails = await getCache(`PL:${socket.id}`);
    if (playerDetails) {
        await deleteCache(`PL:${socket.id}`);
        console.log("User disconnected:", socket.id);
    }
    socket.disconnect(true);
};

export const spin = async (socket, bet) => {
    if (socket.bet) {
        return socket.emit('betError', 'Bet already placed');
    }

    const betAmount = getTotalBetAmount(bet);
    if (!betAmount) {
        return socket.emit('betError', 'Invalid Bet Amount');
    }
    const playerDetailsStr = await getCache(`PL:${socket.id}`);
    if (!playerDetailsStr) {
        return socket.emit('betError', 'Invalid Player Details');
    }

    const playerDetails = JSON.parse(playerDetailsStr);
    if (Number(playerDetails.balance) < betAmount) {
        return logEventAndEmitResponse({ player: playerDetails, betAmount, bet }, 'Insufficient Balance', 'bet', socket);
    }
    console.log("appConfig--------", appConfig)

    if (betAmount < appConfig.minBetAmount || betAmount > appConfig.maxBetAmount) {
        return logEventAndEmitResponse({ player: playerDetails, betAmount, bet }, 'Invalid Bet Amount', 'bet', socket);
    }

    const matchId = generateUUIDv7();
    const userIP = socket.handshake.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
    const playerId = playerDetails.id.split(':')[1];

    const updateBalanceData = {
        id: matchId,
        bet_amount: betAmount,
        socket_id: playerDetails.socketId,
        user_id: playerId,
        ip: userIP,
    };

    const transaction = await updateBalanceFromAccount(updateBalanceData, "DEBIT", playerDetails);
    if (!transaction) {
        return socket.emit('betError', 'Bet Cancelled by Upstream');
    }

    playerDetails.balance = (playerDetails.balance - betAmount).toFixed(2);
    await setCache(`PL:${playerDetails.socketId}`, JSON.stringify(playerDetails));
    socket.emit('info', {
        user_id: playerDetails.userId,
        operator_id: playerDetails.operatorId,
        balance: playerDetails.balance
    });

    const matchData = {
        userId: playerDetails.userId,
        operatorId: playerDetails.operatorId,
        betAmount,
        match_id: matchId,
        txn_id: transaction.txn_id,
    };

    betLogger.info(JSON.stringify({ player: playerDetails, betAmount, bet, matchData }));
    socket.bet = { ...matchData, bet, player: playerDetails };
    socket.emit('bet', { message: 'Init bet successfully' });

    const leftIndex = Math.floor(Math.random() * multipliers.length);
    const rightIndex = Math.floor(Math.random() * multipliers.length);
    const leftMultiplier = multipliers[leftIndex];
    const rightMultiplier = multipliers[rightIndex];
    socket.bet.matchMult = [leftMultiplier, rightMultiplier];

    const parsedBet = bet.split(",").map(item => item.split("-"));
    const multiplierValues = parsedBet.map(item => item[0]);
    const multiplierAmounts = parsedBet.map(item => item[1]);

    let winning_bet = 0;
    const calculateWinAmount = () => {
        if (leftMultiplier === rightMultiplier) {
            const index = multiplierValues.indexOf(leftMultiplier.toString());
            winning_bet = multiplierAmounts[index];
            return index !== -1 ? multiplierAmounts[index] * leftMultiplier : 0;
        }
        if ((leftMultiplier === "wild") ^ (rightMultiplier === "wild")) {
            const intVal = leftMultiplier == "wild" ? rightMultiplier : leftMultiplier;
            const index = multiplierValues.findIndex(x => x == intVal);

            if (index !== -1) {
                winning_bet = multiplierAmounts[index];
                return multiplierAmounts[index] * intVal;
            }
        }


        if (![leftMultiplier, rightMultiplier].includes("wild") && leftMultiplier !== rightMultiplier) {
            const index = multiplierValues.indexOf("1.9");
            winning_bet = multiplierAmounts[index];
            return index !== -1 ? multiplierAmounts[index] * 1.9 : 0;
        }

        return 0;
    };

    socket.bet.winAmount = Math.min(calculateWinAmount(), Number(process.env.MAX_CASHOUT)).toFixed(2);
    //     if (socket.bet.winAmount > 500000) {
    //     socket.bet.winAmount = 500000;
    // }

    const resultTimeout = setTimeout(() => sendResult(socket), 100);
    //  sendResult(socket);
    socket.on('stop', () => {
        if (socket.bet) {
            clearTimeout(resultTimeout);
            sendResult(socket);
        } else {
            socket.emit('betError', 'No bet placed');
        }
    });

    if (socket.bet.winAmount > 0) {
        const webhookData = await prepareDataForWebhook({
            id: matchId,
            bet_amount: betAmount,
            winning_amount: socket.bet.winAmount,
            game_id: playerDetails.game_id,
            user_id: playerDetails.user_id,
            txn_id: transaction.txn_id,
            ip: userIP,
        }, "CREDIT");

        await sendToQueue('', 'games_cashout', JSON.stringify({
            ...webhookData,
            operatorId: playerDetails.operatorId,
            token: playerDetails.token,
        }));

        playerDetails.balance = (parseFloat(playerDetails.balance) + parseFloat(socket.bet.winAmount)).toFixed(2);
        await setCache(`PL:${playerDetails.socketId}`, JSON.stringify(playerDetails));
        setTimeout(() => {
            socket.emit('info', {
                user_id: playerDetails.userId,
                operator_id: playerDetails.operatorId,
                balance: playerDetails.balance,
            });
        }, 2000);
    }

    await insertSettlement({
        match_id: matchData.match_id,
        user_id: playerDetails.user_id,
        operator_id: playerDetails.operatorId,
        bet_amount: betAmount,
        win_amount: socket.bet.winAmount,
        txn_id: transaction.txn_id,
        betdata: bet,
        status: socket.bet.winAmount === 0 ? "lose" : "win",
        result: `${leftMultiplier},${rightMultiplier}`,
        winning_bet: socket.bet.winAmount > 0 ? Number(winning_bet) : 0,
    });
};

export const sendResult = (socket) => {
    if (socket.bet) {
        socket.emit('result', {
            mult: { leftMultiplier: socket.bet.matchMult[0], rightMultiplier: socket.bet.matchMult[1] },
            winAmount: socket.bet.winAmount,
        });
        delete socket.bet;
    }
};