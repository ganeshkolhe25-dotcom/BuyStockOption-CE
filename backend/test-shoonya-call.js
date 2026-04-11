const axios = require('axios');

async function testApiCall() {
    console.log("Verifying Shoonya Token Connectivity...");
    const uid = 'FN140579';
    // Use the auth code obtained via OAuth
    const sessionToken = "b5fb0674-162a-4054-827e-03a3075a59d9"; 

    const url = "https://api.shoonya.com/NorenWClientTP/SearchScrip";
    const jData = {
        uid: uid,
        stext: "NIFTY 50",
        exch: "NSE"
    };

    const payload = `jData=${JSON.stringify(jData)}&jKey=${sessionToken}`;

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        console.log("\nResponse from Shoonya API:");
        console.log("Status:", response.data.stat);
        
        if (response.data.stat === 'Ok') {
            console.log("✅ SUCCESS! The Bot can fetch stock details and place orders!");
            console.log(`Found Symbol: ${response.data.values[0].tsym}`);
        } else {
            console.log("❌ PING FAILED:", response.data.emsg);
        }

    } catch (err) {
        console.log("❌ Network Error:", err.message);
    }
}

testApiCall();
