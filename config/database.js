'use strict';

const { Pool } = require('pg');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

/**
 * Converts MySQL-style `?` placeholders to PostgreSQL `$1, $2, ...` syntax.
 */
function normalizeSql(text) {
    let index = 0;
    return text.replace(/\?/g, () => `$${++index}`);
}

/**
 * Builds the Pool configuration from environment variables.
 * Requires either individual SUPABASE_DB_* vars or a DATABASE_URL.
 */
function buildPoolConfig() {
    const useSsl = process.env.DB_SSL !== 'false';

    // Supabase pooler requires rejectUnauthorized: false (their documented config).
    // For other PostgreSQL providers with proper certs, set DB_SSL_REJECT_UNAUTHORIZED=true.
    const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true';
    const sslConfig = useSsl ? { rejectUnauthorized } : false;

    // Prefer DATABASE_URL (connection string) — this is the standard for Supabase pooler
    const connectionString =
        process.env.DATABASE_URL ||
        process.env.SUPABASE_DATABASE_URL ||
        process.env.SUPABASE_DB_URL;

    if (connectionString) {
        return { connectionString, ssl: sslConfig };
    }

    // Fallback to individual host/port/user/password vars
    const host = process.env.SUPABASE_DB_HOST;
    const port = Number(process.env.SUPABASE_DB_PORT) || 5432;
    const user = process.env.SUPABASE_DB_USER || 'postgres';
    const password = process.env.SUPABASE_DB_PASSWORD || '';
    const database = process.env.SUPABASE_DB_NAME || 'postgres';

    if (host && password) {
        return { host, port, user, password, database, ssl: sslConfig };
    }

    throw new Error(
        'Missing PostgreSQL configuration. Set DATABASE_URL or SUPABASE_DB_HOST + SUPABASE_DB_PASSWORD in .env.'
    );
}

const pool = new Pool(buildPoolConfig());

/**
 * Normalizes row keys to UPPER CASE for backward-compatible access.
 */
function normalizeRowKeys(row) {
    const normalized = { ...row };
    for (const [key, value] of Object.entries(row)) {
        const upperKey = key.toUpperCase();
        if (!(upperKey in normalized)) {
            normalized[upperKey] = value;
        }
    }
    return normalized;
}

/**
 * Executes a parameterized query and returns normalized rows.
 * Supports both callback and promise styles.
 */
function query(text, params, callback) {
    let values = params;
    let cb = callback;

    if (typeof params === 'function') {
        cb = params;
        values = [];
    }

    const promise = pool
        .query(normalizeSql(text), values)
        .then((result) => result.rows.map(normalizeRowKeys));

    if (cb) {
        promise.then((rows) => cb(null, rows)).catch((err) => cb(err));
        return undefined;
    }

    return promise;
}

module.exports = { pool, query };
