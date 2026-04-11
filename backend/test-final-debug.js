const axios = require('axios');
const crypto = require('crypto');
const { TOTP } = require('totp-generator');
require('dotenv').config();

async function debugConnection() {
    console.log('--- Shoonya Final Network Debug ---');
    
    // 1. Resolve External IP
    try {
        const ipRes = await axios.get('https://api4.ipify.org');
        console.log(`📡 Your Outbound IP: ${ipRes.data}`);
    } catch (e) {
        console.log('⚠️ Could not resolve outbound IP.');
    }

    const uid = (process.env.SHOONYA_UID || '').trim();
    const pwd = (process.env.SHOONYA_PWD || '').trim();
    const factor2 = (process.env.SHOONYA_FACTOR2 || '').trim();
    const vc = (process.env.SHOONYA_VC || '').trim();
    const appkey = (process.env.SHOONYA_APPKEY || '').trim();
    
    const endpoint = 'https://api.shoonya.com/NorenWClient';

    const appkeyHash = crypto.createHash('sha256').update(`${uid}|${appkey}`).digest('hex');
    let generatedFactor2 = factor2;
    try {
        const otpResult = TOTP.generate(factor2);
        if (otpResult && otpResult.otp) generatedFactor2 = otpResult.otp;
    } catch (e) {}

    const jData = {
        apkversion: '1.0.0', uid, pwd, 
        factor2: generatedFactor2, vc, 
        appkey: appkeyHash, imei: 'abc1234', source: 'API'
    };
    const payload = `jData=${JSON.stringify(jData)}`;

    console.log(`Connecting to: ${endpoint}...`);

    try {
        const response = await axios.post(`${endpoint}/QuickAuth`, payload, {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                // Use a standard browser User-Agent
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 20000,
            family: 4 // Force IPv4
        });

        console.log(`Status: ${response.status}`);
        console.log(`Stat: ${response.data.stat}`);
        if (response.data.stat === 'Ok') {
            console.log('✅ SUCCESS! Connection established.');
        } else {
            console.log(`❌ API Error: ${response.data.emsg}`);
        }
    } catch (error) {
        if (error.response) {
            console.log(`❌ ERROR 502: The Shoonya Gateway rejected the request.`);
            console.log('This usually means your IP is blocked or the Shoonya server is down.');
        } else {
            console.log(`❌ Network Error: ${error.message}`);
        }
    }
}

debugConnection();
