'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { createWriteStream } = require('fs');
const https = require('https');
const { pipeline } = require('stream/promises');
const ejsMate = require('ejs-mate');
const { randomUUID, randomBytes } = require('crypto');
const bcrypt = require('bcrypt');
const methodOverride = require('method-override');
const session = require('express-session');
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const wrapAsync = require('./utils/wrapAsync.js');
const connection = require('./config/database.js');

const app = express();
const port = Number(process.env.PORT) || 5000;

// ============ SECURITY HELPERS ============

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getSecretOrGenerate(name) {
    const value = process.env[name];
    if (value && value !== 'change-me') {
        return value;
    }
    console.warn(`WARNING: ${name} not set or is placeholder. Using random value (sessions will not persist across restarts).`);
    return randomBytes(32).toString('hex');
}

const BCRYPT_ROUNDS = 12;
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000; // 12 hours
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

// ============ APP CONFIGURATION ============

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, './views'));
app.engine('ejs', ejsMate);
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(express.static(path.join(__dirname, './public')));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(methodOverride('_method'));

const cookieSecret = getSecretOrGenerate('COOKIE_SECRET');
const sessionSecret = getSecretOrGenerate('SESSION_SECRET');

app.use(cookieParser(cookieSecret));

app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'mindbloom.sid',
    cookie: {
        httpOnly: true,
        maxAge: SESSION_MAX_AGE,
        secure: process.env.COOKIE_SECURE === 'true',
        sameSite: 'lax'
    }
}));

app.use(flash());

// Rate limiter for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: 'Too many attempts. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});

// Global locals middleware
app.use((req, res, next) => {
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    res.locals.isLoggedIn = req.session.isLoggedIn || false;
    res.locals.currentUser = req.session.user || null;
    res.locals.currentAdmin = req.session.admin || null;
    res.locals.isAdmin = Boolean(req.session.admin && req.session.admin.isAdmin);
    next();
});

// ============ MIDDLEWARE FUNCTIONS ============

function requireLogin(req, res, next) {
    if (!req.session.isLoggedIn || !req.session.user_id) {
        req.flash('error', 'Please login to access this page.');
        return res.redirect('/mindbloom/login');
    }
    return next();
}

function requireAdmin(req, res, next) {
    if (!req.session.admin || !req.session.admin.isAdmin) {
        req.flash('error', 'Admin access required.');
        return res.redirect('/mindbloom/login');
    }
    return next();
}

// ============ UTILITY FUNCTIONS ============

function buildTeacherEmail(tname) {
    const localPart = String(tname || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '');

    return `${localPart || 'teacher'}@mindbloom.local`;
}

function getImageExtension(contentType) {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('png')) return '.png';
    if (type.includes('webp')) return '.webp';
    if (type.includes('gif')) return '.gif';
    if (type.includes('svg')) return '.svg';
    return '.jpg';
}

function isDatabaseConnectionError(error) {
    const connectionCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'];
    return Boolean(error && connectionCodes.includes(error.code));
}

async function queryOrFallback(text, params, fallback = []) {
    try {
        return await connection.query(text, params);
    } catch (error) {
        if (isDatabaseConnectionError(error)) {
            return fallback;
        }
        throw error;
    }
}

async function hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(plaintext, storedPassword) {
    const stored = String(storedPassword || '');
    if (!stored) {
        return false;
    }
    if (stored.startsWith('$2')) {
        return bcrypt.compare(plaintext, stored);
    }
    // Legacy plaintext comparison — passwords should be migrated to bcrypt
    return plaintext === stored;
}

/**
 * Downloads a course image from a given HTTPS URL and stores it locally.
 * Only HTTPS URLs are accepted to prevent SSRF attacks on internal services.
 */
async function persistCourseImage(imageUrl, courseId) {
    const trimmedUrl = String(imageUrl || '').trim();
    if (!trimmedUrl) {
        return '';
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(trimmedUrl);
    } catch {
        return trimmedUrl;
    }

    // Only allow HTTPS to prevent SSRF on internal networks
    if (parsedUrl.protocol !== 'https:') {
        return trimmedUrl;
    }

    // Block private/internal IP ranges
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.') ||
        hostname.endsWith('.local') ||
        hostname === '0.0.0.0'
    ) {
        return trimmedUrl;
    }

    try {
        const downloadResult = await new Promise((resolve, reject) => {
            const request = https.get(parsedUrl, { timeout: 10000 }, (response) => {
                if (response.statusCode !== 200) {
                    response.resume();
                    reject(new Error(`Image download failed with status ${response.statusCode}`));
                    return;
                }

                const contentType = String(response.headers['content-type'] || '').toLowerCase();
                if (!ALLOWED_IMAGE_TYPES.some((allowed) => contentType.includes(allowed))) {
                    response.resume();
                    reject(new Error(`Disallowed content type: ${contentType}`));
                    return;
                }

                const contentLength = Number(response.headers['content-length'] || 0);
                if (contentLength > MAX_IMAGE_SIZE) {
                    response.resume();
                    reject(new Error('Image exceeds maximum allowed size'));
                    return;
                }

                resolve({ response, contentType });
            });

            request.on('error', reject);
            request.on('timeout', () => {
                request.destroy();
                reject(new Error('Image download timed out'));
            });
        });

        const uploadsDir = path.join(__dirname, 'public', 'uploads', 'courses');
        const fileName = `${courseId}${getImageExtension(downloadResult.contentType)}`;
        const filePath = path.join(uploadsDir, fileName);

        await fs.mkdir(uploadsDir, { recursive: true });
        await pipeline(downloadResult.response, createWriteStream(filePath));

        return `/uploads/courses/${fileName}`;
    } catch (error) {
        console.warn('Course image download failed, using original URL:', error.message);
        return trimmedUrl;
    }
}

async function findOrCreateTeacherId(tname) {
    const teacherName = String(tname || '').trim();
    if (!teacherName) {
        throw new Error('Teacher username is required.');
    }

    const teacherResult = await connection.query(
        'SELECT TID FROM teachers WHERE TNAME = ?',
        [teacherName]
    );

    if (teacherResult.length > 0) {
        return { teacherId: teacherResult[0].TID, created: false };
    }

    const teacherId = randomUUID();
    const teacherEmail = buildTeacherEmail(teacherName);
    await connection.query(
        'INSERT INTO teachers (TID, TNAME, EMAIL, BIO, PASS, SPECIAL) VALUES (?, ?, ?, ?, ?, ?)',
        [teacherId, teacherName, teacherEmail, 'The instructor teaches this course', '', 'General']
    );

    return { teacherId, created: true };
}

async function ensureTextColumns() {
    const migrations = [
        'ALTER TABLE users ALTER COLUMN PSWD TYPE TEXT USING PSWD::TEXT',
        'ALTER TABLE teachers ALTER COLUMN BIO TYPE TEXT USING BIO::TEXT',
        'ALTER TABLE teachers ALTER COLUMN PASS TYPE TEXT USING PASS::TEXT',
        'ALTER TABLE courses ALTER COLUMN DESCRIP TYPE TEXT USING DESCRIP::TEXT'
    ];

    for (const statement of migrations) {
        try {
            await connection.pool.query(statement);
        } catch (error) {
            // Skip if table/column doesn't exist
            if (error.code === '42P01' || error.code === '42703') {
                continue;
            }
            if (isDatabaseConnectionError(error)) {
                console.warn('Skipping schema migration — database unreachable:', error.message);
                return;
            }
            throw error;
        }
    }
}

// ============ ROUTES ============

app.get('/', (req, res) => {
    return res.redirect('/mindbloom');
});

// ---- Authentication ----

app.get('/mindbloom/signup', (req, res) => {
    if (req.session.isLoggedIn) {
        return res.redirect('/mindbloom');
    }
    return res.render('listings/signup.ejs');
});

app.post('/mindbloom/signup', authLimiter, wrapAsync(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');

    if (!username || !email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/mindbloom/signup');
    }

    if (password.length < 8) {
        req.flash('error', 'Password must be at least 8 characters.');
        return res.redirect('/mindbloom/signup');
    }

    const uuid = randomUUID();
    const hashedPassword = await hashPassword(password);

    try {
        await connection.query(
            'INSERT INTO users (USERID, UNAME, EMAIL, PSWD) VALUES (?, ?, ?, ?)',
            [uuid, username, email, hashedPassword]
        );
    } catch (error) {
        if (isDatabaseConnectionError(error)) {
            req.flash('error', 'Registration is unavailable while the database is offline.');
            return res.redirect('/mindbloom/signup');
        }
        throw error;
    }

    req.session.user = { id: uuid, username, email, isAdmin: false };
    req.session.user_id = uuid;
    req.session.isLoggedIn = true;
    req.flash('success', 'Registration successful — you are now logged in.');

    await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
    });

    return res.redirect('/mindbloom');
}));

app.get('/mindbloom/login', (req, res) => {
    if (req.session.isLoggedIn) {
        return res.redirect('/mindbloom');
    }
    return res.render('listings/login.ejs');
});

app.post('/mindbloom/login', authLimiter, wrapAsync(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    let adminResults;
    try {
        adminResults = await connection.query('SELECT * FROM admins WHERE username = ?', [username]);
    } catch (error) {
        if (isDatabaseConnectionError(error)) {
            req.flash('error', 'Login is unavailable while the database is offline.');
            return res.redirect('/mindbloom/login');
        }
        throw error;
    }

    if (adminResults.length > 0 && await verifyPassword(password, adminResults[0].password)) {
        req.session.admin = { id: adminResults[0].id, username: adminResults[0].username, isAdmin: true };
        req.session.user_id = adminResults[0].id;
        req.session.isLoggedIn = true;
        req.flash('success', 'Login successful as admin!');
        return res.redirect('/mindbloom');
    }

    let results;
    try {
        results = await connection.query('SELECT * FROM users WHERE UNAME = ?', [username]);
    } catch (error) {
        if (isDatabaseConnectionError(error)) {
            req.flash('error', 'Login is unavailable while the database is offline.');
            return res.redirect('/mindbloom/login');
        }
        throw error;
    }

    if (results.length === 0 || !(await verifyPassword(password, results[0].PSWD))) {
        req.flash('error', 'Invalid username or password.');
        return res.redirect('/mindbloom/login');
    }

    const user = results[0];
    req.session.user = { id: user.USERID, username: user.UNAME, email: user.EMAIL, isAdmin: false };
    req.session.user_id = user.USERID;
    req.session.isLoggedIn = true;
    req.flash('success', 'Login successful!');
    return res.redirect('/mindbloom');
}));

app.get('/mindbloom/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('mindbloom.sid');
        return res.redirect('/mindbloom');
    });
});

// ---- Course Listing ----

app.get('/mindbloom', wrapAsync(async (req, res) => {
    const result = await queryOrFallback('SELECT * FROM courses', [], []);
    return res.render('listings/home.ejs', { result });
}));

app.get('/mindbloom/search', wrapAsync(async (req, res) => {
    const searchTerm = String(req.query.q || '').trim();
    if (!searchTerm) {
        return res.redirect('/mindbloom');
    }

    const like = `%${searchTerm}%`;
    const q = `
        SELECT *
        FROM courses
        JOIN teachers ON courses.TID = teachers.TID
        WHERE courses.TITLE LIKE ?
           OR courses.DESCRIP LIKE ?
           OR teachers.TNAME LIKE ?
    `;
    const result = await queryOrFallback(q, [like, like, like], []);
    return res.render('listings/home.ejs', { result });
}));

app.get('/mindbloom/teachers/:tid', wrapAsync(async (req, res) => {
    const { tid } = req.params;
    const q = 'SELECT * FROM courses JOIN teachers ON courses.TID = teachers.TID WHERE teachers.TID = ?';
    const result = await queryOrFallback(q, [tid], []);

    if (result.length === 0) {
        req.flash('error', 'Teacher profile is unavailable right now.');
        return res.redirect('/mindbloom');
    }
    return res.render('listings/teachershow.ejs', { result });
}));

app.get('/mindbloom/course/:id', wrapAsync(async (req, res) => {
    const { id } = req.params;
    const ad = req.session.admin;
    const userId = req.session.user ? req.session.user.id : null;

    const result = await queryOrFallback(
        'SELECT * FROM courses JOIN teachers ON courses.TID = teachers.TID WHERE CID = ?',
        [id],
        []
    );

    if (result.length === 0) {
        req.flash('error', 'Course not found.');
        return res.redirect('/mindbloom');
    }

    let isEnrolled = false;
    if (userId) {
        const enrollmentResult = await queryOrFallback(
            'SELECT 1 FROM enrollments WHERE USERID = ? AND CID = ? LIMIT 1',
            [userId, id],
            []
        );
        isEnrolled = enrollmentResult.length > 0;
    }

    return res.render('listings/show.ejs', { result, userId, ad, isEnrolled });
}));

// ---- Enrollments ----

app.post('/mindbloom/course/:id/enroll', requireLogin, wrapAsync(async (req, res) => {
    const userId = req.session.user_id;
    const courseId = req.params.id;

    const existing = await connection.query(
        'SELECT 1 FROM enrollments WHERE USERID = ? AND CID = ?',
        [userId, courseId]
    );

    if (existing.length > 0) {
        req.flash('error', 'You are already enrolled in this course.');
        return res.redirect(`/mindbloom/course/${courseId}`);
    }

    const eid = randomUUID();
    await connection.query(
        'INSERT INTO enrollments (EID, USERID, CID) VALUES (?, ?, ?)',
        [eid, userId, courseId]
    );

    req.flash('success', 'Enrolled successfully!');
    return res.redirect(`/mindbloom/course/${courseId}`);
}));

// ---- Profile ----

app.get('/mindbloom/profile', requireLogin, wrapAsync(async (req, res) => {
    const userId = req.session.user.id;

    const userResult = await connection.query(
        'SELECT USERID, UNAME, EMAIL, IMG FROM users WHERE USERID = ?',
        [userId]
    );

    if (userResult.length === 0) {
        req.flash('error', 'User not found.');
        return res.redirect('/mindbloom');
    }

    const enrolledCourses = await connection.query(
        `SELECT c.CID, c.TITLE, c.DESCRIP, c.VIDEO, c.IMGLINK, c.VIDLINK,
                t.TNAME, t.EMAIL as teachers_EMAIL
         FROM enrollments e
         JOIN courses c ON e.CID = c.CID
         JOIN teachers t ON c.TID = t.TID
         WHERE e.USERID = ?`,
        [userId]
    );

    return res.render('listings/profile.ejs', {
        user: userResult[0],
        enrolledCourses,
        currentUser: req.session.user
    });
}));

// ---- Admin Course CRUD ----

app.get('/mindbloom/courses/new', requireAdmin, wrapAsync(async (req, res) => {
    const teachers = await connection.query('SELECT * FROM teachers');
    return res.render('listings/newcourse.ejs', { teachers });
}));

app.post('/mindbloom/courses', requireAdmin, wrapAsync(async (req, res) => {
    const { title, description, video, tname, imgLink, vidLink } = req.body;
    const { teacherId, created: teacherCreated } = await findOrCreateTeacherId(tname);
    const courseId = randomUUID();
    const storedImagePath = await persistCourseImage(imgLink, courseId);

    await connection.query(
        'INSERT INTO courses (CID, TITLE, DESCRIP, VIDEO, TID, IMGLINK, VIDLINK) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [courseId, title, description, video, teacherId, storedImagePath, vidLink]
    );

    const msg = teacherCreated
        ? 'Teacher account created and course added successfully!'
        : 'Course created successfully!';
    req.flash('success', msg);
    return res.redirect(`/mindbloom/course/${courseId}`);
}));

app.get('/mindbloom/course/:id/edit', requireAdmin, wrapAsync(async (req, res) => {
    const courseId = req.params.id;
    const courseResult = await connection.query('SELECT * FROM courses WHERE CID = ?', [courseId]);

    if (courseResult.length === 0) {
        req.flash('error', 'Course not found.');
        return res.redirect('/mindbloom');
    }

    const teachersResult = await connection.query('SELECT * FROM teachers WHERE TID = ?', [courseResult[0].TID]);
    return res.render('listings/editcourse.ejs', {
        course: courseResult[0],
        teachers: teachersResult[0] || null
    });
}));

app.put('/mindbloom/course/:id', requireAdmin, wrapAsync(async (req, res) => {
    const courseId = req.params.id;
    const { title, description, video, tname, imglink, vidLink } = req.body;
    const { teacherId, created: teacherCreated } = await findOrCreateTeacherId(tname);
    const storedImagePath = await persistCourseImage(imglink, courseId);

    await connection.query(
        'UPDATE courses SET TITLE = ?, DESCRIP = ?, VIDEO = ?, TID = ?, IMGLINK = ?, VIDLINK = ? WHERE CID = ?',
        [title, description, video, teacherId, storedImagePath, vidLink, courseId]
    );

    const msg = teacherCreated
        ? 'Teacher account created and course updated successfully!'
        : 'Course updated successfully!';
    req.flash('success', msg);
    return res.redirect(`/mindbloom/course/${courseId}`);
}));

app.delete('/mindbloom/course/:id', requireAdmin, wrapAsync(async (req, res) => {
    const courseId = req.params.id;
    await connection.query('DELETE FROM courses WHERE CID = ?', [courseId]);
    req.flash('success', 'Course deleted successfully!');
    return res.redirect('/mindbloom');
}));

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
    res.status(404).render('listings/home.ejs', { result: [] });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    req.flash('error', 'Something went wrong. Please try again.');
    return res.redirect('/mindbloom');
});

// ============ SERVER STARTUP ============

if (require.main === module && !process.env.VERCEL) {
    ensureTextColumns()
        .then(() => {
            app.listen(port, () => {
                console.log(`MindBloom server running on port ${port}`);
            });
        })
        .catch((error) => {
            console.error('Failed to prepare database schema:', error.message);
            process.exit(1);
        });
}

module.exports = app;
