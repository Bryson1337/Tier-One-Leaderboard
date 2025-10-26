// server.js - Secure CFTools API Proxy
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files from 'public' folder

// ========================================
// CFTOOLS API CONFIGURATION (Secured on server)
// ========================================
const CFTOOLS_CONFIG = {
    APPLICATION_ID: process.env.CFTOOLS_API_APPLICATION_ID,
    SECRET: process.env.CFTOOLS_API_SECRET,
    SERVER_API_ID: process.env.CFTOOLS_SERVER_API_ID,
};

// Token cache
let authToken = null;
let tokenExpiry = null;

// ========================================
// CFTOOLS API FUNCTIONS
// ========================================

async function authenticate() {
    try {
        const response = await fetch('https://data.cftools.cloud/v1/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                application_id: CFTOOLS_CONFIG.APPLICATION_ID,
                secret: CFTOOLS_CONFIG.SECRET
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Authentication failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        authToken = data.token;
        
        // CFTools tokens last 24 hours, refresh before expiry
        tokenExpiry = Date.now() + (23 * 60 * 60 * 1000); // 23 hours
        
        console.log('✅ Successfully authenticated with CFTools API');
        return authToken;
    } catch (error) {
        console.error('❌ Authentication error:', error.message);
        throw error;
    }
}

async function getValidToken() {
    if (!authToken || !tokenExpiry || Date.now() >= tokenExpiry) {
        await authenticate();
    }
    return authToken;
}

async function fetchLeaderboardFromCFTools(stat = 'kills', order = -1, limit = 50) {
    try {
        const token = await getValidToken();

        const response = await fetch(
            `https://data.cftools.cloud/v1/server/${CFTOOLS_CONFIG.SERVER_API_ID}/leaderboard?stat=${stat}&order=${order}&limit=${limit}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch leaderboard: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        // CFTools API returns an array directly for leaderboard endpoint
        // If it's wrapped in an object, extract the array
        if (Array.isArray(data)) {
            return data;
        } else if (data && Array.isArray(data.leaderboard)) {
            return data.leaderboard;
        } else if (data && typeof data === 'object') {
            // Log the actual response structure for debugging
            console.log('⚠️  Unexpected response structure:', JSON.stringify(data).substring(0, 200));
            return [];
        }
        
        return data;
    } catch (error) {
        console.error('❌ Leaderboard fetch error:', error.message);
        throw error;
    }
}

// ========================================
// API ENDPOINTS
// ========================================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok',
        message: 'CFTools Leaderboard API is running',
        timestamp: new Date().toISOString()
    });
});

// Get leaderboard endpoint
app.get('/api/leaderboard', async (req, res) => {
    try {
        const stat = req.query.stat || 'kills';
        const order = parseInt(req.query.order) || -1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100

        console.log(`📊 Fetching leaderboard: stat=${stat}, order=${order}, limit=${limit}`);

        const data = await fetchLeaderboardFromCFTools(stat, order, limit);
        
        // Ensure we're returning an array
        const leaderboardArray = Array.isArray(data) ? data : [];
        
        console.log(`✅ Returning ${leaderboardArray.length} leaderboard entries`);

        res.json({
            success: true,
            data: leaderboardArray,
            count: leaderboardArray.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in /api/leaderboard:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Serve the HTML widget
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// START SERVER
// ========================================

app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ================================');
    console.log('🎮 DayZ Leaderboard Server Started');
    console.log('🚀 ================================');
    console.log('');
    console.log(`✅ Server running on: http://localhost:${PORT}`);
    console.log(`✅ API endpoint: http://localhost:${PORT}/api/leaderboard`);
    console.log(`✅ Widget available at: http://localhost:${PORT}`);
    console.log('');
    console.log('📊 Available query parameters:');
    console.log('   - stat: kills, kdratio, deaths, longest_kill, longest_shot, playtime, suicides');
    console.log('   - order: -1 (descending) or 1 (ascending)');
    console.log('   - limit: 1-100 (default: 50)');
    console.log('');
    console.log('Example: http://localhost:' + PORT + '/api/leaderboard?stat=kdratio&limit=25');
    console.log('');
    
    // Authenticate on startup
    authenticate().catch(err => {
        console.error('⚠️  Warning: Initial authentication failed. Will retry on first request.');
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n🛑 SIGINT received, shutting down gracefully...');
    process.exit(0);
});
