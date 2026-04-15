
# OptionNagari Gann Square-of-9 Automated Trading Bot

## 📝 Overview
This is a full-stack automated Options trading system that uses the **Gann Square-of-9** mathematical model. The bot constantly tracks the Nifty 200 basket, calculating key pivot and resistance/support levels for the day. Once these levels are breached and sustained for a specific confirmation period, the bot autonomously fetches real-time options chain data, purchases the at-the-money (ATM) Call or Put options via the **Shoonya API**, and enforces precise Stop-Loss and Target limits dynamically.

## 🏗️ Technology Stack
*   **Backend Framework**: NestJS (TypeScript, Node.js)
*   **Frontend Dashboard**: Next.js 14, React, Tailwind CSS
*   **Database**: PostgreSQL hosted on Supabase (managed via Prisma ORM)
*   **Containerization & Deployment**: Docker, Google Cloud Run
*   **Broker API**: Shoonya (Finvasia) API for quotes and order execution
*   **Data Source**: NSE/Yahoo Finance for real-time `Underlying` stock tracking

---

## ⏰ Trading Schedule & Event Loop
The bot operates strictly during Indian Standard Time (IST) market hours (Monday - Friday).

*   **09:00 AM - Reset Protocol**: 
    * The daily portfolio PnL tracking and `isHalted` global locks are reset. Trade state is prepared for a fresh day.
*   **09:20 AM - Morning Master Scan**: 
    * Scans the Nifty 200 basket.
    * **Filters applied**: High liquidity stocks `LTP > ₹2,000` & `LTP < ₹30,000`.
    * **Momentum filters**: `ADX > 25` or `Percentage Change > 2%`.
    * Calculates and stores the Daily Gann Levels (R1, R2, R3, S1, S2, S3) based on the previous close price.
*   **09:20 AM to 02:45 PM - Active Option Entries**:
    * Runs every **20 seconds**. Continuously polls active Nifty 200 filtered stocks.
    * Evaluates live prices against Gann Levels to find new trade setups.
*   **03:15 PM - Intraday Universal Exit**:
    * Hard cutoff. Any running trades that have not hit their target or SL are automatically squared off to prevent overnight risks.

---

## 📈 Entry Logic & Strategies
The bot requires a **5-Minute Sustain Period** for all trade entries. If a stock crosses an entry trigger, it gets placed in a "Pending Watchlist". If the price successfully stays beyond the trigger line for a continuous 5 minutes, an Option trade is triggered.

There are 6 distinct automated setups:

1.  **Standard Breakout (CE Buy)**: Stock opens normally. Crosses R1 upwards. *Target: R2. Stop-Loss: R1.*
2.  **Standard Breakdown (PE Buy)**: Stock opens normally. Crosses S1 downwards. *Target: S2. Stop-Loss: S1.*
3.  **Gap Up Reversal (PE Buy)**: Stock opens highly gapped up (Above R1). Falls back and crosses R1 downwards. *Target: Prev Close. Stop-Loss: R1.*
4.  **Gap Down Reversal (CE Buy)**: Stock opens highly gapped down (Below S1). Bounces back and crosses S1 upwards. *Target: Prev Close. Stop-Loss: S1.*
5.  **R2 Continuation (CE Buy)**: Stock opened Gap Up between R1 & R2. Surges higher crossing R2 upwards. *Target: R3. Stop-Loss: R2.*
6.  **S2 Continuation (PE Buy)**: Stock opened Gap Down between S1 & S2. Falls deeper crossing S2 downwards. *Target: S3. Stop-Loss: S2.*

*(Note: Threshold for detecting a trigger crossing is `0.50%` to capture high-volatility IT/Bank stocks).*

---

## 🛑 Dynamic Stop-Loss & Exit Logic
Unlike the Option Premium (which decays), **Targets and Stop-Loss limits are evaluated strictly via the Underlying Stock's LTP** to respect the Gann mathematical levels.

### The 5-Minute SL Sustain Rule
To prevent being prematurely stopped out by volatile price spikes or "wicks", the bot has a unique SL logic:
*   When the underlying stock breaches the marked Stop-Loss level, a **5-Minute Countdown Timer** begins.
*   If the exact price stays breached for 5 uninterrupted minutes, the Option is automatically Squared Off. 
*   If the price recovers (climbs back to safety) within those 5 minutes, the timer is cancelled and the trade stays open.

### Daily Risk Guard (-10k PnL Halt)
*   The bot tracks the aggregate "Live Unrealized + Realized" PnL. 
*   If total daily loss hits **-₹10,000**, the **Universal Exit Protocol** triggers instantly.
*   All active positions are squared off at market price, and the bot completely halts entering new trades for the remaining day.

---

## 🛒 Option Execution (Shoonya)
Once the 5-Minute entry timer matures, the bot executes real-time orders:
1.  Searches the Shoonya Broker API for the nearest At-The-Money (ATM) Option Chain token for the specific underlying stock.
2.  Fetches live Market Depth (Bid/Ask Prices) for that exact Token.
3.  Automatically executes an `Ask Price` (Limit/Market equivalent) Paper or Real execution based on strict margin requirements vs. your virtual Capital pool.

---

## 💻 Dashboard Modules (Frontend)
The Web UI (`next.js 14`) provides real-time access to the bot's state without needing page refreshes:
1.  **Scanner Engine View**: Overview of all eligible Nifty 200 stocks and their Gann status today.
2.  **Pending Watchlist**: Live countdown trackers showing stocks currently in the 5-minute sustain validation buffer.
3.  **Active Positions**: The primary terminal for monitoring live running positions (Option LTP, Stock LTP, Max Run-Up, Live PnL, and Countdown SL Timers). Also provides an emergency "Manual Square Off" button for each trade.
4.  **Trade Ledger**: Permanent historical record of all closed/rejected trades for auditing performance.
5.  **Shoonya Setup**: Dynamic form directly hooked to the Database allowing users to update their API connection parameters securely (`UID`, `PWD`, `TOTP/FA2`, `VC`, `AppKey`) and "Test Connection".
