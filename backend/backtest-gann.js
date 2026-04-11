const axios = require('axios');

class LocalGannAngleService {
    calculateAngles(previousClose) {
        const root = Math.sqrt(previousClose);
        const step = 0.25;
        const calc = (factor) => parseFloat(Math.pow(root + factor, 2).toFixed(2));

        return {
            previousClose: previousClose,
            angle1x2_Up: calc(step * 2),
            angle1x1_Up: calc(step * 1),
            angle2x1_Up: calc(step * 0.5),
            angle2x1_Dn: calc(-step * 0.5),
            angle1x1_Dn: calc(-step * 1),
            angle1x2_Dn: calc(-step * 2),
        };
    }

    evaluateTrend(ltp, levels) {
        if (ltp > levels.angle1x1_Up) return 'BULLISH';
        if (ltp < levels.angle1x1_Dn) return 'BEARISH';
        return 'NEUTRAL';
    }
}

async function runBacktest() {
    console.log("=========================================");
    console.log("   📈 GANN ANGLE ALGORITHM BACKTEST 📉   ");
    console.log("=========================================");
    
    const symbol = 'RELIANCE.NS';
    console.log(`\nFetching 30 days historical data for ${symbol}...`);

    try {
        const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        
        const result = res.data.chart.result[0];
        const timestamps = result.timestamp;
        const closes = result.indicators.quote[0].close;
        const highs = result.indicators.quote[0].high;
        const lows = result.indicators.quote[0].low;
        const opens = result.indicators.quote[0].open;

        let totalPnlPoints = 0;
        let wins = 0;
        let losses = 0;
        
        const gann = new LocalGannAngleService();

        for (let i = 1; i < closes.length; i++) {
            const prevClose = closes[i-1];
            if (!prevClose) continue;
            
            const currentClose = closes[i];
            const currentHigh = highs[i];
            const currentLow = lows[i];
            
            const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
            
            // Calculate Gann Angles based ONLY on previous close
            const levels = gann.calculateAngles(prevClose);
            
            // Backtest Intraday Simulation:
            // Did the stock break the 1x1 UP angle during the day?
            let tradeTaken = false;
            let tradeType = '';
            let entryPrice = 0;
            let exitPrice = 0;
            
            // Check CE (Bullish Breakout)
            if (currentHigh >= levels.angle1x1_Up && currentLow <= levels.angle1x1_Up) {
                tradeTaken = true;
                tradeType = 'CE Buy';
                entryPrice = levels.angle1x1_Up;
                
                // Did it hit Target (1x2 Up) or SL (2x1 Up) or close?
                if (currentHigh >= levels.angle1x2_Up) {
                    exitPrice = levels.angle1x2_Up; // Winner
                } else if (currentLow <= levels.angle2x1_Up) {
                    exitPrice = levels.angle2x1_Up; // SL Hit
                } else {
                    exitPrice = currentClose; // EOD Close
                }
            } 
            // Check PE (Bearish Breakdown)
            else if (currentLow <= levels.angle1x1_Dn && currentHigh >= levels.angle1x1_Dn) {
                tradeTaken = true;
                tradeType = 'PE Buy';
                entryPrice = levels.angle1x1_Dn;
                
                // For a PE, hitting target means going LOWER down to 1x2_Dn. SL is 2x1_Dn
                // Notice logic reversal since we make money when it drops
                if (currentLow <= levels.angle1x2_Dn) {
                    exitPrice = levels.angle1x2_Dn; // Winner (dropped further)
                } else if (currentHigh >= levels.angle2x1_Dn) {
                    exitPrice = levels.angle2x1_Dn; // SL Hit (bounced up)
                } else {
                    exitPrice = currentClose; // EOD Close
                }
            }

            if (tradeTaken) {
                // Point calculation based on Option equivalent (1 delta proxy)
                // For PE, point delta is Entry - Exit. For CE, Exit - Entry.
                const pnl = tradeType === 'CE Buy' ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
                totalPnlPoints += pnl;
                
                if (pnl > 0) wins++; else losses++;
                
                console.log(`[${dateStr}] Generated ${tradeType} at ₹${entryPrice.toFixed(2)} | Exited: ₹${exitPrice.toFixed(2)} | PNL = ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)} pts`);
            }
        }
        
        console.log("\n-----------------------------------------");
        console.log(`📊 BACKTEST RESULTS FOR ${symbol} (LAST 3 MONTHS)`);
        console.log(`Total Trades: ${wins + losses}`);
        console.log(`Wins: ${wins} | Losses: ${losses} | Win Rate: ${((wins/(wins+losses))*100).toFixed(1)}%`);
        console.log(`Net Point Capture: ${totalPnlPoints >= 0 ? '+' : ''}${totalPnlPoints.toFixed(2)} Points`);
        console.log(`Estimated ₹ PNL (1 Lot = 250 avg qty): ₹${(totalPnlPoints * 250).toFixed(2)}`);
        console.log("-----------------------------------------");

    } catch (e) {
        console.error("Backtest Error:", e.message);
    }
}

runBacktest();
