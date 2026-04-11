const axios = require('axios');
const crypto = require('crypto');
const { TOTP } = require('totp-generator');
require('dotenv').config();

async function testShoonyaConnection() {
    console.log('--- Shoonya API Connection Test ---');
    
    const uid = (process.env.SHOONYA_UID || '').trim();
    const pwd = (process.env.SHOONYA_PWD || '').trim();
    const factor2 = (process.env.SHOONYA_FACTOR2 || '').trim();
    const vc = (process.env.SHOONYA_VC || '').trim();
    const appkey = (process.env.SHOONYA_APPKEY || '').trim();
    const endpoint = process.env.SHOONYA_BASE_URL || 'https://trade.shoonya.com/NorenWClient';
    const authEndpoint = process.env.SHOONYA_AUTH_URL || 'https://trade.shoonya.com/NorenWClientAPI';

    if (!uid || !pwd || !factor2 || !vc || !appkey) {
        console.error('❌ Missing credentials in .env file.');
        console.log('Required: SHOONYA_UID, SHOONYA_PWD, SHOONYA_FACTOR2, SHOONYA_VC, SHOONYA_APPKEY');
        return;
    }

    console.log(`Using UID: ${uid}`);
    console.log(`Endpoint: ${endpoint}`);

    try {
        // 1. Generate AppKey Hash
        const appkeyHash = crypto.createHash('sha256').update(`${uid}|${appkey}`).digest('hex');
        
        // 2. Generate TOTP
        let generatedFactor2 = factor2;
        try {
            const otpResult = await TOTP.generate(factor2);
            if (otpResult && otpResult.otp) {
                generatedFactor2 = otpResult.otp;
                console.log('✅ Generated TOTP successfully.');
            }
        } catch (e) {
            console.log('⚠️ Could not generate TOTP, using factor2 as is.');
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

        console.log('Sending QuickAuth request...');
        const authResponse = await axios.post(`${authEndpoint}/QuickAuth`, payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });

        if (authResponse.data.stat === 'Ok') {
            const token = authResponse.data.susertoken;
            console.log('✅ Authentication Successful!');
            console.log(`Session Token: ${token.substring(0, 10)}...`);

            // 3. Test SearchScrip
            console.log('Testing SearchScrip (RELIANCE)...');
            const searchData = {
                uid: uid,
                stext: 'RELIANCE',
                exch: 'NSE'
            };
            const searchPayload = `jData=${JSON.stringify(searchData)}&jKey=${token}`;
            const searchResponse = await axios.post(`${endpoint}/SearchScrip`, searchPayload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            if (searchResponse.data.stat === 'Ok' && searchResponse.data.values) {
                console.log(`✅ Search Successful! Found ${searchResponse.data.values.length} results.`);
                console.log('First result:', searchResponse.data.values[0].tsym, 'Token:', searchResponse.data.values[0].token);
            } else {
                console.log('❌ Search Failed:', searchResponse.data.emsg || 'Unknown error');
            }

            // 4. Logout
            console.log('Logging out...');
            const logoutData = { uid: uid };
            const logoutPayload = `jData=${JSON.stringify(logoutData)}&jKey=${token}`;
            await axios.post(`${endpoint}/Logout`, logoutPayload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            console.log('✅ Logged out successfully.');

        } else {
            console.error('❌ Authentication Failed!');
            console.error('Error Message:', authResponse.data.emsg || 'Unknown error');
            console.error('Full Response:', JSON.stringify(authResponse.data));
        }

    } catch (error) {
        console.error('❌ Protocol Error:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', error.response.data);
        }
    }
}

testShoonyaConnection();
