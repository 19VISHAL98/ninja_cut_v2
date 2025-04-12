import { createLogger } from "./logger.js";
const failedBetLogger = createLogger('failedBets', 'jsonl');

export const logEventAndEmitResponse = (req, res, event, socket) => {
  let logData = JSON.stringify({ req, res, event, socket: socket.id })
  if (event === 'bet') {
    failedBetLogger.error(logData)
  }
  return socket.emit('betError', res);
}

export const bet_multi = [
  {
    mult: 1.9,
    // color: "#2ba1a9" 
    color: 'linear-gradient(90deg, #f0ca40, #d64747 26.56%, #df853b 51.04%, #4157c7 75%, #2ba1a9)'
  },
  { mult: 4, color: "#2ba1a9" },
  { mult: 6, color: "#ffb600" },
  { mult: 15, color: "#d64747" },
  { mult: 25, color: "#dc6a34" },
  { mult: 55, color: "#4157c7" }
];

// export const bet_multi = [{"mult":1.9,"color":"rainbow"},{"mult":4,"color":"blue"},{"mult":6,"color":"yellow"},{"mult":15,"color":"red"},{"mult":25,"color":"orange"},{"mult":55,"color":"purple"}]
// export const bet_amount = [100 , 50 , 25 ,10 ,5 , 2, 1, 0.5 , 0.25]
export const bet_amount = [25000, 20000, 10000, 5000, 1000, 500, 200, 100, 50, 20, 10]
// ["bet_amount_list", [5000, 1000, 500, 200, 100, 50, 20, 10]]



