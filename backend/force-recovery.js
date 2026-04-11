import axios from 'axios';

async function forceRecovery() {
  const BACKEND_URL = "https://stock-bot-backend-519487054619.us-central1.run.app";
  
  // List of stocks that gave signal but failed token resolution earlier today
  const targets = [
    { symbol: "TRENT", type: "CE", ltp: 3484, target: 3543, sl: 3425 },
    { symbol: "POLYCAB", type: "CE", ltp: 7081, target: 7165, sl: 6997 },
    { symbol: "ESCORTS", type: "PE", ltp: 2898, target: 2790, sl: 3006 },
    { symbol: "LT", type: "PE", ltp: 3570, target: 3510, sl: 3630 }
  ];

  console.log("🌀 Starting Force Entry Recovery (APR Contracts)...");

  for (const t of targets) {
    try {
      console.log(`\n➡️ Processing ${t.symbol} ${t.type}...`);
      const res = await axios.post(`${BACKEND_URL}/force-entry`, t);
      
      if (res.data.status === 'success') {
        console.log(`✅ SUCCESS: ${res.data.message}`);
      } else {
        console.log(`⚠️ FAILED: ${res.data.message}`);
      }
    } catch (e) {
      console.error(`❌ ERROR for ${t.symbol}: ${e.response?.data?.message || e.message}`);
    }
  }
}

forceRecovery();
