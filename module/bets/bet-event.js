import { getCurrentRound, getPreviousRoundData, getRoundData, startNewRound } from "../../lobby/lobbyUtilities.js";
import { logEventAndEmitResponse } from "../../utilities/helper-function.js";
import { getCache } from "../../utilities/redis-connection.js";
import { appConfig } from "../../utilities/app-config.js";
import { createLogger } from "../../utilities/logger.js";
import { generateUUIDv7 } from "../../utilities/common-function.js";

const betsLogger = createLogger("Bets", "jsonl")

let bets = [];
export async function placeBet(socket, data) {

  let [amount] = data;
  let betAmount = amount;
  const playerId = `PL:${socket.id}`;
  const logReqObj = { amount, playerId };
  if (!betAmount) {
    return socket.emit('betError', 'Invalid Bet Amount');
  }
  const playerDetailsStr = await getCache(playerId);
  if (!playerDetailsStr) {
    return socket.emit('betError', 'Invalid Player Details');
  }

  const playerDetails = JSON.parse(playerDetailsStr);
  if (Number(playerDetails.balance) < betAmount) {
    return logEventAndEmitResponse({ player: playerDetails, betAmount, bet }, 'Insufficient Balance', 'bet', socket);
  }

  if (betAmount < appConfig.minBetAmount || betAmount > appConfig.maxBetAmount) {
    return logEventAndEmitResponse({ player: playerDetails, betAmount, bet }, 'Invalid Bet Amount', 'bet', socket);
  }
  startNewRound(socket, playerDetails.user_id)
  const bet = {};
  const currentRound = getCurrentRound(playerDetails.user_id);
  bet.matchId = currentRound ? generateUUIDv7() : "";
  bet.multiplier = 1;
  bet.betAmount = Number(amount);
  bet.winAmount = 0;
  bet.timeoutInterval = 50;
  bet.cutFruits = [];
  bet.status = currentRound ? 'ACTIVE' : 'NOT_STARTED';
  bet.matchStartTime = Date.now();
  bet.serverTime = Date.now();
  bets.push(bet);
  betsLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
  return socket.emit('bet', bet);
}

// Slice Fruit Logic
const timers = {};

export async function sliceSweet(socket, data) {
  const [matchId, roundId, fruitId] = data;
  const playerId = `PL:${socket.id}`;
  const releaseLock = await acquireLock(playerId);
  try {
    let logReqObj = { playerId, matchId, roundId, fruitId }
    const bet = bets.find(e => e.matchId === matchId);
    if (!bet || !matchId) return logEventAndEmitResponse(socket, logReqObj, 'No Active bet for the match ID', 'sliceFruit');



    let getRoundDetails = getRoundData(playerDetails.user_id, roundId);

    if (!getRoundDetails) {
      getRoundDetails = getPreviousRoundData(playerDetails.user_id, roundId);

      if (getRoundDetails) {
        getRoundDetails.FruitData = typeof getRoundDetails.FruitData === 'string' ? JSON.parse(getRoundDetails.FruitData) : getRoundDetails.FruitData;
        const timeDifference = (Date.now() - getRoundDetails.RoundEndTime) / 1000;
        if (timeDifference > 3) {
          return logEventAndEmitResponse(socket, logReqObj, 'Round has been closed for this event', 'sliceFruit');
        }
      }
    }

    if (!getRoundDetails || !roundId) return logEventAndEmitResponse(socket, logReqObj, 'Round has been closed for this event', 'sliceFruit');

    let fruit = getRoundDetails.FruitData.find(e => e.FruitId == fruitId);
    if (!fruit || !fruitId) return logEventAndEmitResponse(socket, logReqObj, 'Invalid fruit id or fruit does not belongs to the round', 'sliceFruit');

    let playerDetails = await getCache(playerId);
    if (!playerDetails) return logEventAndEmitResponse(socket, logReqObj, 'Session Timed Out', 'bet', io);

    bet.timeoutInterval = 50;

    clearExistingTimer(matchId);
    setMatchEndTimer(socket, matchId);

    bet.serverTime = Date.now();
    let { FruitId, Multiplier, AssetId } = fruit;
    bet.cutFruits.push({ FruitId, Multiplier, AssetId });
    bet.lastMaxMult = bet.cutFruits.length > 0 ? (bet.cutFruits[bet.cutFruits.length - 1]).Multiplier : 0;

    //Send Callback
    if (bet.cutFruits.length === 1) {
      const firstCutSuccess = await handleFirstCut(io, socket, bet, playerDetails, logReqObj);
      if (!firstCutSuccess) return;
    }

    // Handle fruit with a multiplier of 0
    if (fruit.Multiplier === 0) {
      await handleFruitLoss(socket, matchId, bet, playerDetails, logReqObj);
      return;
    }

    bet.multiplier *= Number(fruit.Multiplier);
    bet.winAmount = parseFloat(Number(bet.betAmount) * bet.multiplier);
    bet.winAmount = bet.winAmount < 0.01 ? 0 : Number(Number(bet.winAmount).toFixed(2));
    if (Number(bet.winAmount) <= 0) {
      await handleFruitLoss(io, socket, matchId, bet, playerDetails, logReqObj);
      return;
    }
    bet.status = 'BET_PLACED';
    sliceFruitLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
    return socket.emit('fruitSlice', bet);
  } catch (err) {
    console.log(err);
    return socket.emit('fruitSlice', 'Something went wrong');
  } finally {
    releaseLock();
  }

}

function clearExistingTimer(matchId) {
  if (timers[matchId]) {
    clearTimeout(timers[matchId]);
    delete timers[matchId];
  }
}

function setMatchEndTimer(socket, matchId) {
  timers[matchId] = setTimeout(async () => await endMatch(io, socket, [matchId]), 50000); // 50 seconds
}

const acquireLock = async (user_id) => {
  while (userLocks.get(user_id)) {
    await userLocks.get(user_id);
  }

  let resolveLock;
  const lockPromise = new Promise((resolve) => {
    resolveLock = resolve;
  });

  userLocks.set(user_id, lockPromise);

  return () => {
    resolveLock();
    userLocks.delete(user_id);
  };
};


export async function handleFirstCut(socket, bet, playerDetails, logReqObj) {
  await addBetsToDB({ ...bet, ...playerDetails });
  const playerId = playerDetails.socket_id;
  const webhookData = await prepareDataForWebhook({ ...bet, user_id: playerDetails.id, playerId, game_id: playerDetails.game_id }, "DEBIT", socket);
  bet.txn_id = webhookData.txn_id;

  try {
    const data = await postDataToSourceForBet({ webhookData, token: playerDetails.session_token });
    if (data.status !== 200) {
      handleBetFailure(socket, bet.matchId, logReqObj, 'Slice Fruit event failed from upstream server');
      return false;
    }

    console.log(`User balance updated successfully for user id: ${playerDetails.id}`);
    playerDetails.balance -= bet.betAmount;
    await setCache(playerId, JSON.stringify(playerDetails));
    socket.emit('info', playerDetails);
    return true;
  } catch (err) {
    await handleBetError(io, socket, bet.matchId, err, logReqObj, playerId);
    return false;
  }
}

function handleBetFailure(socket, matchId, logReqObj, errorMsg) {
  bets = bets.filter(e => e.matchId !== matchId);
  clearExistingTimer(matchId);
  logEventAndEmitResponse(socket, logReqObj, errorMsg, 'sliceFruit');
  return;
}

export async function handleBetError(socket, matchId, err, logReqObj, playerId) {
  bets = bets.filter(e => e.matchId !== matchId);
  clearExistingTimer(matchId);

  if (err.response?.data?.msg === "Invalid Token or session timed out") {
    await deleteCache(playerId);
    sliceFailedFruitLogger.error(JSON.stringify({ req: logReqObj, res: 'Invalid Token or session timed out' }));
    io.to(playerId).emit("logout", playerId);
  } else {
    sliceFailedFruitLogger.error(JSON.stringify({ req: logReqObj, res: 'Bet Debit request failed from upstream server' }));
    socket.emit('betError', 'Bet Debit request failed from upstream server');
  }

  return;
}

export async function handleFruitLoss(socket, matchId, bet, playerDetails, logReqObj) {
  bets = bets.filter(e => e.matchId !== matchId);
  bet.winAmount = 0;
  bet.multiplier = 0;
  bet.status = 'LOSS';
  bet.balance = playerDetails.balance;
  bet.matchEndTime = Date.now();
  await addSettlement({ ...bet, ...playerDetails });
  clearExistingTimer(matchId);
  matchEndLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
  return socket.emit('matchEnd', bet);
}


//End Match Logic
export async function endMatch(socket, data) {
  const [matchId] = data;
  const playerId = socket.id;
  let logReqObj = { matchId };
  const bet = bets.find(e => e.matchId === matchId);

  if (!bet || bet.matchId !== matchId || !matchId) {
    const errorMsg = !bet ? 'No active bet for the player' : 'Invalid match id or match id does not belong to the player';
    return logEventAndEmitResponse(socket, logReqObj, errorMsg, 'endMatch');
  }

  bet.matchEndTime = Date.now();
  bet.serverTime = Date.now();
  bet.timeoutInterval = 50;
  let playerDetails = await getUserData(playerId);
  if (!playerDetails) return logEventAndEmitResponse(socket, matchId, 'Invalid Player Details', 'endMatch', io);

  if (bet.cutFruits.length === 0) {
    matchEndLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
    return socket.emit('matchEnd', bet)
  };

  bet.winAmount = parseFloat(+bet.betAmount * bet.multiplier);
  bet.winAmount = bet.winAmount < 0.01 ? 0 : Number(Number(bet.winAmount).toFixed(2));
  bet.status = "WIN";
  bet.balance = playerDetails.balance + Number(bet.winAmount);


  //storing in db
  await addSettlement({ ...bet, ...playerDetails });
  const webhookData = await prepareDataForWebhook({ ...bet, user_id: playerDetails.id, playerId, game_id: playerDetails.game_id }, "CREDIT", socket);

  //third party API call
  const apiSuccess = await handleThirdPartyAPICall(webhookData, playerDetails);
  if (!apiSuccess) return;


  playerDetails.balance = bet.balance;
  await setCache(playerId, JSON.stringify(playerDetails));
  bets = bets.filter(e => e.matchId !== matchId);
  socket.emit('info', playerDetails);
  clearExistingTimer(matchId);
  matchEndLogger.info(JSON.stringify({ req: logReqObj, res: bet }));
  return socket.emit('matchEnd', bet)

}

export async function handleThirdPartyAPICall(webhookData, playerDetails) {
  try {
    await sendToQueue('', 'games_cashout', JSON.stringify({ ...webhookData, token: playerDetails.session_token, operatorId: playerDetails.operator_id }));
    return true;
  } catch (err) {
    failedCashoutLogger.error(JSON.stringify({ req: CashObj, res: 'Error sending to queue' }));
  }
}
