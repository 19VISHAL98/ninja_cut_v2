import express from 'express';
import { getHistory, getTopWin, getMatchData} from '../module/bets/bet-db.js';

const router = express.Router();

router.get('/history', async (req, res) => {
  try {
    const { user_id, operator_id, match_id } = req.query;
    const historyData = await getHistory({ user_id, operator_id, match_id });
    res.json(historyData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/topwin', async (req, res) => {
  try {
    const { user_id, operator_id,match_id } = req.query;
    const topWinData = await getTopWin({ user_id, operator_id,match_id });
    res.json(topWinData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/matchdata', async (req, res) => {
  try {
    const { user_id, operator_id, lobby_id } = req.query; 
    const matchData = await getMatchData(user_id, operator_id,lobby_id);
    res.json(matchData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
export default router;