import { endMatch, placeBet, sliceSweet } from "../module/bets/bet-event.js";

export const registerEvents = async (socket) => {
    socket.on('message', (data) => {
        const [event, ...rest] = data.split(':')
        switch (event) {
            case 'MS': return placeBet(socket, rest);
            case 'FC': return sliceSweet(socket, rest);
            case 'ME': return endMatch(socket, rest);
        }
    })
}
