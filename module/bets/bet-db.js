import { write, read } from "../../utilities/db-connection.js";


export const insertSettlement = async (data) => {
    try {
        const { match_id, user_id, operator_id, bet_amount, win_amount, txn_id, betdata, winning_bet, result, status } = data;
        const decodeUserId = decodeURIComponent(user_id);
        console.log("decodeUserId------------", decodeUserId);
        await write(`INSERT INTO settlement (match_id, user_id, operator_id, bet_amount, win_amount, txn_id, betdata, winning_bet, result, status) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [match_id, decodeUserId, operator_id, Number(bet_amount),
            Number(win_amount), txn_id, betdata, Number(winning_bet), result, status]);
        console.log(`Settlement data inserted successfully`);
    } catch (err) {
        console.error(`Err while inserting data in table is:::`, err);
    }
}
export const getHistory = async ({ user_id, operator_id, match_id }) => {
    try {

        const limit = 10;
        const data = await read(`
            SELECT 
                match_id,
                created_at,
                bet_amount,
                win_amount,
                result
            FROM 
                settlement
            WHERE 
                user_id = ? AND operator_id = ?
            ORDER BY 
                created_at DESC
            LIMIT ${limit}
        `, [user_id, operator_id]);
        return await data;
    } catch (err) {
        console.error(`Err while getting data from table is:::`, err);
        return { err };
    }
}

export const getTopWin = async ({ user_id, operator_id, match_id }) => {
    try {
        const limit = 10;
        const data = await read(`
            SELECT 
                user_id,
                match_id,
                bet_amount,
                winning_bet,
                result as odd,
                win_amount 
            FROM 
                settlement
            ORDER BY 
                win_amount DESC
            LIMIT ${limit}
        `);
        return await data;
    } catch (err) {
        console.error(`Err while getting data from table is:::`, err);
        return { err };
    }
}

export const getMatchData = async (user_id, operator_id, match_id) => {
    try {
        const data = await read(`
            SELECT *
            FROM settlement
            WHERE match_id = ? AND user_id = ? AND operator_id = ? `, [match_id, user_id, operator_id]);
        return data;
    } catch (err) {
        console.error(`Err while getting data from table is:::`, err);
        return { err };
    }
}
