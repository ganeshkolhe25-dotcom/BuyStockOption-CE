const axios = require('axios');

async function testAllEndpoints() {
    console.log("Locating available API Gateways...");

    const uid = 'FN140579';
    const sessionToken = "b5fb0674-162a-4054-827e-03a3075a59d9"; // Code from user

    const endpoints = [
        "https://api.shoonya.com/NorenWClientTP/SearchScrip",
        "https://trade.shoonya.com/NorenWClientTP/SearchScrip",
        "https://api.shoonya.com/NorenWClientAPI/SearchScrip",
        "https://trade.shoonya.com/NorenWClientAPI/SearchScrip"
    ];

    const jData = { uid: uid, stext: "NIFTY 50", exch: "NSE" };
    const payload = `jData=${JSON.stringify(jData)}&jKey=${sessionToken}`;

    let successCount = 0;

    for (const url of endpoints) {
        try {
            console.log(`\nTesting Gateway: ${url}`);
            const response = await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000,
                family: 4 // explicitly prefer IPv4 to avoid Cloudflare routing traps
            });

            if (response.data && response.data.stat) {
                console.log(`✅ RESPONDED! Status: ${response.data.stat}`);
                if (response.data.stat === 'Ok') {
                    console.log(`📡 Success fetching Nifty details!`);
                } else {
                    console.log(`⚠️ Error Message: ${response.data.emsg}`);
                }
                successCount++;
            }
        } catch (err) {
            console.log(`❌ Gateway Rejected (Code: ${err.response ? err.response.status : err.message})`);
        }
    }

    if (successCount === 0) {
        console.log("\n⚠️ ALL gateways returned 502/Network Error!");
    }
}

testAllEndpoints();
