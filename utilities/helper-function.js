import { createLogger } from "./logger.js";
const failedBetLogger = createLogger('Failed_Bets', 'jsonl');
const sliceFruitLogger = createLogger('Failed_Slice_fruit_Bets', 'jsonl');
const endMatchLogger = createLogger('Failed_End_Match', 'jsonl');

export const logEventAndEmitResponse = (req, res, event, socket) => {
  let logData = JSON.stringify({ req, res })
  if (event === 'bet') {
    failedBetLogger.error(logData)
  }
  if (event === 'sliceFruit') {
    sliceFruitLogger.error(logData);
  }
  if (event === 'endMatch') {
    endMatchLogger.error(logData);
  }
  if (res === 'Session Timed Out') {
    return socket.to(socket.id).emit('logout', 'user_logout')
  }
  return socket.emit('betError', res);
}