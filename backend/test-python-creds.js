const axios = require('axios');
const crypto = require('crypto');
const { TOTP } = require('totp-generator');

async function testPythonCredsWithAllEndpoints() {
    console.log('--- Shoonya API Connection Test (All Known Endpoints) ---');

    const uid = 'FN140579';
    const plainPassword = 'Vkolhe77@3';
    const factor2 = '43525VO5K65574E7S32M62T42W32RA7Q';
    const vc = 'FN140579_U';
    const apiSecret = 'Gg2Liz24IyD3qIN1Q63oa5anQa61aN611GI2IXF5KxEQLRRebxAzzidYGd2bbzga';
    const imei = 'abc1234';

    // Shoonya requires SHA-256 hash for password and appkey (uid|api_secret)
    const pwdHash = crypto.createHash('sha256').update(plainPassword).digest('hex');
    const appkeyHash = crypto.createHash('sha256').update(`${uid}|${apiSecret}`).digest('hex');

    let generatedTOTP = factor2;
    try {
        const otpResult = TOTP.generate(factor2.replace(/\s+/g, '').toUpperCase());
        if (otpResult && otpResult.otp) generatedTOTP = otpResult.otp;
    } catch (e) { }

    const jData = {
        apkversion: '1.0.0',
        uid: uid,
        pwd: pwdHash,
        factor2: generatedTOTP,
        vc: vc,
        appkey: appkeyHash,
        imei: imei,
        source: 'API'
    };

    const payload = `jData=${JSON.stringify(jData)}`;

    // Known Shoonya API endpoints (including older stable ones that don't block IPs as much)
    const endpoints = [
        'https://shoonyatrade.finvasia.com/NorenWClientTP', // Standard legacy URL
        'https://shoonyatrade.finvasia.com/NorenWClient',
        'https://api.shoonya.com/NorenWClientTP',          // Modern URL
        'https://api.shoonya.com/NorenWClient'
    ];

    let successEndpoint = null;

    for (const endpoint of endpoints) {
        console.log(`\nAttempting login via: ${endpoint}...`);
        try {
            const response = await axios.post(`${endpoint}/QuickAuth`, payload, {
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 10000,
                family: 4 // IPv4 enforce
            });

            if (response.data.stat === 'Ok') {
                console.log(`✅ SUCCESS on ${endpoint}!!`);
                successEndpoint = endpoint;
                break; // Stop testing if we find the correct one
            } else {
                console.log(`❌ Login rejected: ${response.data.emsg}`);
            }
        } catch (error) {
            if (error.response) {
                console.log(`❌ Gateway/Server Error (${error.response.status}) on ${endpoint}`);
            } else {
                console.log(`❌ Network/Timeout Error on ${endpoint}: ${error.message}`);
            }
        }
    }

    if (successEndpoint) {
        console.log(`\n🚀 ACTION REQUIRED: Update your backend/.env with the working Base URL!`);
        console.log(`SHOONYA_BASE_URL=${successEndpoint}`);
        console.log(`SHOONYA_PWD=${pwdHash}`);
    } else {
        console.log('\n❌ None of the endpoints succeeded. The gateway is rejecting connections completely.');
    }
}

testPythonCredsWithAllEndpoints();
