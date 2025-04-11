import {spin} from '../services/game-event.js';

export const registerEvents = async (socket) => {
    socket.on('message', (data) => {
        const event = data.split(':')
        switch (event[0]) {
            case 'spin': return spin(socket, event[1]);
           
        }
    })
}
