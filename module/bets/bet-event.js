
import { getCurrentRound, startRoundsForUser, stopRoundsForUser } from "../../lobby/lobbyUtilities.js";
import { logEventAndEmitResponse } from "../../utilities/helper-function.js";
import { getCache, setCache } from "../../utilities/redis-connection.js";
import { appConfig } from "../../utilities/app-config.js";
import { createLogger } from "../../utilities/logger.js";
import { generateUUIDv7, updateBalanceFromAccount } from "../../utilities/common-function.js";
import { addBetsToDB, addSettlement } from "./bet-db.js";

const betsLogger = createLogger("Bets", "jsonl");
const failedCashoutLogger = createLogger("FailedBets", "jsonl");
const sliceFailedFruitLogger = createLogger("FailedSliceFruit", "jsonl");
const sliceFruitLogger = createLogger("SliceFruit", "jsonl");
const matchEndLogger = createLogger("MatchEnd", "jsonl");

let bets = [];
export async function placeBet(socket, data) {
  try {
    let [betAmount] = data;
    const playerId = `PL:${socket.id}`;
    const logReqObj = { betAmount, playerId };
    if (!betAmount) return socket.emit('betError', 'Invalid Bet Amount');
    const playerDetailsStr = await getCache(playerId);
    if (!playerDetailsStr) {
      return socket.emit('betError', 'Invalid Player Details');
    }
    const playerDetails = JSON.parse(playerDetailsStr);
    if (Number(playerDetails.balance) < betAmount) {
      stopRoundsForUser(playerDetails.user_id);
      return logEventAndEmitResponse({ player: playerDetails, betAmount }, 'Insufficient Balance', 'bet', socket);
    }
    if (betAmount < appConfig.minBetAmount || betAmount > appConfig.maxBetAmount) {
      stopRoundsForUser(playerDetails.user_id);
      return logEventAndEmitResponse({ player: playerDetails, betAmount }, 'Invalid Bet Amount', 'bet', socket);
    }
    startRoundsForUser(socket, playerDetails.user_id);
    const bet = {
      //matchId: getCurrentRound(playerDetails.user_id) ? generateUUIDv7() : "",
      matchId: "01962b34-1eaf752b-75e6-8f4e0b-37",//getCurrentRound(playerDetails.user_id) ? generateUUIDv7() : "",
      multiplier: 1,
      betAmount: Number(betAmount),
      winAmount: 0,
      timeoutInterval: 50,
      cutFruits: [],
      status: getCurrentRound(playerDetails.user_id) ? 'ACTIVE' : 'NOT_STARTED',
      matchStartTime: Date.now(),
      serverTime: Date.now()
    };
    bets.push(bet);
    betsLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
    return socket.emit('bet', bet);
  } catch (err) {
    console.error("placeBet error:", err);
    return socket.emit('betError', 'An unexpected error occurred');
  }
}

export async function sliceSweet(socket, data) {
  const [matchId, roundId, fruitId] = data;
  const playerId = `PL:${socket.id}`;
  let logReqObj = { playerId, matchId, roundId, fruitId };
  try {
    const bet = bets.find(e => e.matchId === matchId);
    if (!bet || !matchId) {
      return logEventAndEmitResponse(logReqObj, 'No Active bet for the match ID', 'sliceFruit', socket);
    }
    const playerDetailsStr = await getCache(playerId);
    if (!playerDetailsStr) {
      return logEventAndEmitResponse(logReqObj, 'Session Timed Out', 'sliceFruit', socket);
    }
    const playerDetails = JSON.parse(playerDetailsStr);
    let getRoundDetails = getCurrentRound(playerDetails?.user_id, roundId);
    if (!getRoundDetails || !roundId) {
      stopRoundsForUser(playerDetails.user_id);
      return logEventAndEmitResponse(logReqObj, 'Round has been closed for this event', 'sliceFruit', socket);
    }
    const timeDifference = (Date.now() - getRoundDetails.RoundEndTime) / 1000;
    if (timeDifference > 3) {
      stopRoundsForUser(playerDetails.user_id);
      return logEventAndEmitResponse(logReqObj, 'Round has been closed for this event', 'sliceFruit', socket,);
    }
    let fruit = getRoundDetails.FruitData.find(e => e.FruitId == fruitId);
    if (!fruit || !fruitId) {
      stopRoundsForUser(playerDetails.user_id);
      return logEventAndEmitResponse(logReqObj, 'Invalid fruit id or fruit does not belong to the round', 'sliceFruit', socket);
    }
    const { FruitId, Multiplier, AssetId } = fruit;
    bet.cutFruits.push({ FruitId, Multiplier, AssetId });
    bet.lastMaxMult = bet.cutFruits[bet.cutFruits.length - 1]?.Multiplier || 0;
    if (bet.cutFruits.length === 1) {
      const firstCutSuccess = await handleFirstCut(socket, bet, playerDetails, logReqObj);
      if (!firstCutSuccess) return;
    }
    if (fruit.Multiplier === 0) {
      return await handleFruitLoss(socket, matchId, bet, playerDetails, logReqObj);
    }
    bet.multiplier *= Number(fruit.Multiplier);
    bet.winAmount = parseFloat(bet.betAmount * bet.multiplier);
    bet.winAmount = bet.winAmount < 0.01 ? 0 : Number(bet.winAmount.toFixed(2));
    if (bet.winAmount <= 0) {
      return await handleFruitLoss(socket, matchId, bet, playerDetails, logReqObj);
    }
    bet.status = 'BET_PLACED';
    sliceFruitLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
    return socket.emit('fruitSlice', bet);
  } catch (err) {
    console.error("sliceSweet error:", err);
    sliceFailedFruitLogger.error(JSON.stringify({ req: logReqObj, res: err.message || 'Unknown error' }));
    return socket.emit('fruitSlice', 'Something went wrong');
  }
}

async function handleFirstCut(socket, bet, playerDetails, logReqObj) {
  await addBetsToDB({ ...bet, ...playerDetails });
  const playerId = playerDetails.socket_id;
  const transaction = await updateBalanceFromAccount(bet, "DEBIT", playerDetails);
  if (!transaction) return socket.emit('betError', 'Bet Cancelled by Upstream');
  playerDetails.balance -= bet.betAmount;

  await setCache(playerId, JSON.stringify(playerDetails));
  socket.emit('info', playerDetails);
  return true;
}


async function handleFruitLoss(socket, matchId, bet, playerDetails, logReqObj) {
  bets = bets.filter(e => e.matchId !== matchId);
  bet.winAmount = 0;
  bet.multiplier = 0;
  bet.status = 'LOSS';
  bet.balance = playerDetails.balance;
  bet.matchEndTime = Date.now();
  await addSettlement({ ...bet, ...playerDetails });
  stopRoundsForUser(playerDetails.user_id);
  matchEndLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
  return socket.emit('matchEnd', bet);
}

export async function endMatch(socket, data) {
  const [matchId] = data;
  const playerId = `PL:${socket.id}`;
  const logReqObj = { matchId };
  try {
    const bet = bets.find(e => e.matchId === matchId);
    if (!bet) {
      return logEventAndEmitResponse(logReqObj, 'No active bet for the player', 'endMatch', socket);
    }
    const playerDetailsStr = await getCache(playerId);
    if (!playerDetailsStr) {
      return logEventAndEmitResponse(logReqObj, 'Invalid Player Details', 'endMatch', socket);
    }
    const playerDetails = JSON.parse(playerDetailsStr);
    bet.matchEndTime = Date.now();
    bet.serverTime = Date.now();
    bet.timeoutInterval = 50;

    if (bet.cutFruits.length === 0) {
      stopRoundsForUser(playerDetails.user_id);
      matchEndLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
      return socket.emit('matchEnd', bet);
    }

    bet.winAmount = parseFloat(bet.betAmount * bet.multiplier);
    bet.winAmount = bet.winAmount < 0.01 ? 0 : Number(bet.winAmount.toFixed(2));
    bet.status = "WIN";
    bet.balance = playerDetails.balance + bet.winAmount;
    const transaction = await updateBalanceFromAccount(bet, "CREDIT", playerDetails);
    if (!transaction) return socket.emit('betError', 'Bet Cancelled by Upstream');
    playerDetails.balance = bet.balance;
    await setCache(playerId, JSON.stringify(playerDetails));
    socket.emit('info', playerDetails);
    bets = bets.filter(e => e.matchId !== matchId);
    stopRoundsForUser(playerDetails.user_id);
    matchEndLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
    return socket.emit('matchEnd', bet);
  } catch (err) {
    console.error("endMatch error:", err);
    matchEndLogger.error(JSON.stringify({ req: logReqObj, res: err.message || 'Unknown error during match end' }));
    return socket.emit('matchEnd', 'Something went wrong during match end');
  }
}

