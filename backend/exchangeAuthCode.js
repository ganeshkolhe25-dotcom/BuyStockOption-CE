const axios = require('axios');
const crypto = require('crypto');

async function exchangeToken() {
    const authCode = "b5fb0674-162a-4054-827e-03a3075a59d9"; // Code from user

    const uid = 'FN140579';
    const apiKey = 'FN140579_U';
    const apiSecret = 'Gg2Liz24IyD3qIN1Q63oa5anQa61aN611GI2IXF5KxEQLRRebxAzzidYGd2bbzga';

    // Shoonya requires a hash of api_key|api_secret or uid|api_secret
    const appkeyHash = crypto.createHash('sha256').update(`${uid}|${apiSecret}`).digest('hex');

    // Standard payload for NorenWClientAPI/GenAcsTok or OAuth
    const payloadOpts = [
        `jData=${JSON.stringify({ uid: uid, auth_code: authCode, api_key: apiKey, appkey: appkeyHash, source: 'API' })}`,
        `jData=${JSON.stringify({ uid: uid, auth_code: authCode })}`,
        `auth_code=${authCode}&api_key=${apiKey}&api_secret=${apiSecret}`
    ];

    const tokenUrl = "https://trade.shoonya.com/NorenWClientAPI/GenAcsTok";

    console.log("Exchanging Auth Code for Daily Session Token...");

    for (const payload of payloadOpts) {
        try {
            const res = await axios.post(tokenUrl, payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            if (res.data && res.data.stat === 'Ok') {
                console.log("\n==================================");
                console.log(`✅ SESSION TOKEN OBTAINED!`);
                console.log(`Token: ${res.data.susertoken}`);
                console.log("==================================\n");
                return;
            } else {
                console.log("Payload variation rejected:", res.data.emsg);
            }
        } catch (e) {
            console.log("Network error on payload variation.");
        }
    }
    console.log("❌ Could not exchange token. Code might be expired (they expire in ~60 seconds usually!).");
}

exchangeToken();
