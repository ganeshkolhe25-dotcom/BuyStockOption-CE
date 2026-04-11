const axios = require('axios');
const crypto = require('crypto');
const { TOTP } = require('totp-generator');
require('dotenv').config();

async function testShoonyaEndpoints() {
    console.log('--- Shoonya API Connection Test (Multiple Endpoints) ---');
    
    const uid = (process.env.SHOONYA_UID || '').trim();
    const pwd = (process.env.SHOONYA_PWD || '').trim();
    const factor2 = (process.env.SHOONYA_FACTOR2 || '').trim();
    const vc = (process.env.SHOONYA_VC || '').trim();
    const appkey = (process.env.SHOONYA_APPKEY || '').trim();
    
    // Test both endpoints
    const endpoints = [
        'https://api.shoonya.com/NorenWClientTP', // Third-party Partner
        'https://api.shoonya.com/NorenWClient'    // Standard Portal
    ];

    if (!uid || !pwd || !factor2 || !vc || !appkey) {
        console.error('❌ Missing credentials in .env file.');
        return;
    }

    // 1. Generate AppKey Hash (Always needed for REST API)
    const appkeyHash = crypto.createHash('sha256').update(`${uid}|${appkey}`).digest('hex');
    
    // 2. Generate TOTP
    let generatedFactor2 = factor2;
    try {
        const otpResult = TOTP.generate(factor2);
        if (otpResult && otpResult.otp) {
            generatedFactor2 = otpResult.otp;
        }
    } catch (e) {
        // use token as is
    }

    const jData = {
        apkversion: '1.0.0',
        uid: uid,
        pwd: pwd,
        factor2: generatedFactor2,
        vc: vc,
        appkey: appkeyHash,
        imei: 'abc1234',
        source: 'API'
    };
    const payload = `jData=${JSON.stringify(jData)}`;

    for (const endpoint of endpoints) {
        console.log(`\nTesting Endpoint: ${endpoint}...`);
        try {
            const response = await axios.post(`${endpoint}/QuickAuth`, payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000,
                family: 4 // Force IPv4 (Crucial for Shoonya 502 fix)
            });

            console.log(`Response Status: ${response.status}`);
            if (response.data.stat === 'Ok') {
                console.log(`✅ Success with ${endpoint}! Session Token: ${response.data.susertoken.substring(0, 10)}...`);
                return; // Stop after first success
            } else {
                console.log(`❌ Failed with ${endpoint}: ${response.data.emsg || 'Unknown error'}`);
                console.log(`Full Body: ${JSON.stringify(response.data)}`);
            }
        } catch (error) {
            console.error(`❌ Connection Error for ${endpoint}: ${error.message}`);
            if (error.response) {
                console.error(`HTTP Status: ${error.response.status}`);
                if (error.response.status === 502) {
                    console.error('⚠️ 502 Bad Gateway usually means service timeout or IPv6 incompatibility from your side.');
                }
            } else {
                console.error('No response received (Timeout or DNS error).');
            }
        }
    }
}

testShoonyaEndpoints();
