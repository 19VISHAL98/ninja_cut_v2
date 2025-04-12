import { createPool, format } from 'mysql2/promise';
import { createLogger } from './logger.js';
const logger = createLogger('Database');
import { appConfig } from './app-config.js';
const { dbConfig, dbReadConfig, dbProps: { retries, interval } } = appConfig;


const maxRetries = +retries;
const retryInterval = +interval;

let pool;
let readpool;
const createDatabasePool = async () => {
    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            pool = createPool(dbConfig);
            readpool = createPool(dbReadConfig)
            logger.info("DATABASE POOLS CREATED AND EXPORTED");
            return;
        } catch (err) {
            attempts += 1;
            logger.error(`DATABASE CONNECTION FAILED. Retry ${attempts}/${maxRetries}. Error: ${err.message}`);
            if (attempts >= maxRetries) {
                logger.error("Maximum retries reached. Could not connect to the database.");
                process.exit(1);
            }
            await new Promise(res => setTimeout(res, retryInterval));
        }
    }
};

export const read = async (query, params = [], attempts = 0) => {
    if (!readpool) throw new Error('Read Database pool is not initialized');
    const connection = await readpool.getConnection();
    try {
        const finalQuery = format(query, params)
        const [results] = await connection.query(finalQuery);
        connection.release(); // Release the connection back to the pool
        return results;
    } catch (err) {
        console.error(err);
        connection.destroy();
        logger.warn(`Read Query failed. Retry ${attempts}/${maxRetries}. Error: ${err.message}`);
        if (attempts > maxRetries) throw err;
        await new Promise(res => setTimeout(res, 100)); // Small delay before retry
    }
    return await read(query, params = [], attempts + 1);

};

export const write = async (query, params = [], attempts = 0) => {
    if (!pool) throw new Error('Write Database pool is not initialized');
    const connection = await pool.getConnection();
    try {
        const undefinedIndex = params.findIndex(e => e === undefined);
        if (undefinedIndex !== -1)
            logger.error(JSON.stringify({ err: "Undefined params in sql", query, params }));
        const finalQuery = format(query, params)
        const [results] = await connection.query(finalQuery);
        connection.release(); // Release the connection back to the pool
        return results;
    } catch (err) {
        console.error(err);
        connection.destroy();
        logger.warn(`Write Query failed. Retry ${attempts}/${maxRetries}. Error: ${err.message}`);
        if (attempts > maxRetries) throw err;
        await new Promise(res => setTimeout(res, 200)); // Small delay before retry;
    }
    return await write(query, params = [], attempts + 1);
};

export const checkDatabaseConnection = async () => {
    if (!pool || !readpool) {
        await createDatabasePool();
    }
    logger.info("DATABASE CONNECTION CHECK PASSED");
};
