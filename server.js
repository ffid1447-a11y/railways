require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const { spawn } = require('child_process');
const fs = require('fs').promises;

const app = express();
app.use(express.json());

// Config
const PORT = process.env.PORT || 3000;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "nic@impds#dedup05613";

// Session storage
let currentSession = null;
let sessionExpiry = null;

// ========== HELPER FUNCTIONS ==========

function encryptAadhaar(text) {
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

function decryptAadhaar(encrypted) {
    const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

async function getSession() {
    if (currentSession && Date.now() < sessionExpiry) {
        return currentSession;
    }
    
    console.log('🔄 Getting new session...');
    
    return new Promise((resolve, reject) => {
        const python = spawn('python3', ['impds_auth.py']);
        
        let output = '';
        python.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        python.on('close', () => {
            const match = output.match(/JSESSIONID:\s*([A-F0-9]{32})/);
            if (match) {
                currentSession = match[1];
                sessionExpiry = Date.now() + (25 * 60 * 1000); // 25 minutes
                console.log('✅ New session:', currentSession);
                resolve(currentSession);
            } else {
                reject(new Error('Failed to get session'));
            }
        });
    });
}

function parseResults(html) {
    const $ = cheerio.load(html);
    const results = [];
    const tables = $('table.table-striped.table-bordered.table-hover');
    
    if (tables.length < 2) {
        return { error: 'No data found' };
    }
    
    const rationCardMap = {};
    
    // Parse main table
    tables.first().find('tbody tr').each((i, row) => {
        const tds = $(row).find('td');
        if (tds.length >= 8) {
            const rationCardNo = $(tds[3]).text().trim();
            
            if (!rationCardMap[rationCardNo]) {
                rationCardMap[rationCardNo] = {
                    ration_card_details: {
                        state_name: $(tds[1]).text().trim(),
                        district_name: $(tds[2]).text().trim(),
                        ration_card_no: rationCardNo,
                        scheme_name: $(tds[4]).text().trim()
                    },
                    members: []
                };
            }
            
            rationCardMap[rationCardNo].members.push({
                s_no: parseInt($(tds[0]).text().trim()),
                member_id: $(tds[5]).text().trim(),
                member_name: $(tds[6]).text().trim(),
                remark: $(tds[7]).text().trim() || null
            });
        }
    });
    
    // Parse additional info
    if (tables.length > 1) {
        Object.values(rationCardMap).forEach(card => {
            card.additional_info = parseAdditionalInfo(tables.eq(1));
        });
    }
    
    return Object.values(rationCardMap);
}

function parseAdditionalInfo(table) {
    const $ = cheerio.load(table.html());
    const info = {
        fps_category: "Unknown",
        impds_transaction_allowed: false,
        exists_in_central_repository: false,
        duplicate_aadhaar_beneficiary: false
    };
    
    table.find('tbody tr').each((i, row) => {
        const tds = $(row).find('td');
        if (tds.length >= 2) {
            const label = $(tds[0]).text().trim().toLowerCase();
            const value = $(tds[1]).text().trim().toLowerCase();
            
            if (label.includes('fps category')) {
                info.fps_category = value === 'yes' ? 'Online FPS' : 'Offline FPS';
            } else if (label.includes('transaction')) {
                info.impds_transaction_allowed = value === 'yes';
            } else if (label.includes('central')) {
                info.exists_in_central_repository = value === 'yes';
            } else if (label.includes('duplicate')) {
                info.duplicate_aadhaar_beneficiary = value === 'yes';
            }
        }
    });
    
    return info;
}

// ========== API ROUTES ==========

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        service: 'IMPDS API',
        session: currentSession ? 'Active' : 'Inactive',
        uptime: process.uptime()
    });
});

// Search endpoint
app.get('/search', async (req, res) => {
    try {
        const { aadhaar, type = 'A' } = req.query;
        
        if (!aadhaar) {
            return res.status(400).json({ 
                success: false, 
                error: 'Aadhaar number is required' 
            });
        }
        
        // Validate Aadhaar (12 digits)
        if (!/^\d{12}$/.test(aadhaar.replace(/\s/g, ''))) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid Aadhaar. Must be 12 digits.' 
            });
        }
        
        console.log(`🔍 Searching: ${aadhaar.substring(0, 8)}...`);
        
        // Get session
        const sessionId = await getSession();
        
        // Prepare request
        const encryptedAadhaar = encryptAadhaar(aadhaar);
        
        const response = await axios.post(
            'https://impds.nic.in/impdsdeduplication/search',
            `search=${type}&aadhar=${encodeURIComponent(encryptedAadhaar)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': `JSESSIONID=${sessionId}`,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                    'Referer': 'https://impds.nic.in/impdsdeduplication/search'
                },
                timeout: 30000
            }
        );
        
        // Parse results
        const results = parseResults(response.data);
        
        if (results.error) {
            return res.status(404).json({ 
                success: false, 
                error: results.error 
            });
        }
        
        res.json({
            success: true,
            count: results.length,
            results: results
        });
        
    } catch (error) {
        console.error('Error:', error.message);
        
        let errorMessage = error.message;
        if (error.response?.status === 500) {
            errorMessage = 'Session expired. Please try again.';
            currentSession = null; // Reset session
        }
        
        res.status(500).json({ 
            success: false, 
            error: errorMessage 
        });
    }
});

// Encrypt endpoint
app.get('/encrypt', (req, res) => {
    const { text } = req.query;
    
    if (!text) {
        return res.status(400).json({ 
            success: false, 
            error: 'Text is required' 
        });
    }
    
    try {
        const encrypted = encryptAadhaar(text);
        res.json({
            success: true,
            original: text,
            encrypted: encrypted
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Decrypt endpoint
app.get('/decrypt', (req, res) => {
    const { text } = req.query;
    
    if (!text) {
        return res.status(400).json({ 
            success: false, 
            error: 'Text is required' 
        });
    }
    
    try {
        const decrypted = decryptAadhaar(text);
        res.json({
            success: true,
            encrypted: text,
            decrypted: decrypted
        });
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: 'Invalid encrypted text' 
        });
    }
});

// Root
app.get('/', (req, res) => {
    res.json({
        message: 'IMPDS Aadhaar Search API',
        endpoints: {
            search: 'GET /search?aadhaar=123456789012',
            encrypt: 'GET /encrypt?text=123456789012',
            decrypt: 'GET /decrypt?text=encrypted_string',
            health: 'GET /health'
        }
    });
});

// ========== START SERVER ==========

async function startServer() {
    try {
        // Try to get initial session
        await getSession();
        
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
        });
        
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
