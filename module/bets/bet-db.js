import { write } from "../../utilities/db-connection.js";

const ADD_BETS_QUERY = `
  INSERT INTO bets 
  (match_id, round_data, name, user_id, operator_id, bet_amount, avatar, balance, match_start_time, server_time) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const addBetsToDB = async (betData) => {
    const { matchId, cutFruits, name, id, operatorId, betAmount, avatar, balance, matchStartTime, serverTime,
    } = betData;

    try {
        const userId = decodeURIComponent(id);
        const result = await write(ADD_BETS_QUERY, [matchId, JSON.stringify(cutFruits), name, userId, operatorId, betAmount, avatar, balance, matchStartTime, serverTime,]);
        console.log("Bet inserted with ID:", result.insertId);
    } catch (error) {
        console.error("Error inserting bet:", error);
        throw error;
    }
};

const ADD_SETTLEMENT_QUERY = `
  INSERT INTO settlement 
  (match_id, rounds_data, user_id, operator_id, name, bet_amount, avatar, balance, max_mult, status, match_start_time, match_end_time, server_time) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const addSettlement = async (settlementData) => {
    console.log({ settlementData })
    const {
        matchId,
        cutFruits,
        name,
        id,
        operatorId,
        betAmount,
        avatar,
        balance,
        matchStartTime,
        serverTime,
        matchEndTime,
        multiplier,
        status,
    } = settlementData;

    try {
        const userId = decodeURIComponent(id);
        const result = await write(ADD_SETTLEMENT_QUERY, [
            matchId,
            JSON.stringify(cutFruits),
            userId,
            operatorId,
            name,
            betAmount,
            avatar,
            balance,
            multiplier,
            status,
            matchStartTime,
            matchEndTime,
            serverTime,
        ]);
        console.log("Settlement inserted with ID:", result.insertId);
    } catch (error) {
        console.error("Error inserting settlement:", error);
    }
};

export { addBetsToDB, addSettlement };
