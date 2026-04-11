# 5 EMA Strategy & Mobile Responsiveness Additions

## 📈 1. The 5 EMA (15-Minute) Trading Strategy
The system now includes an entirely separate automated execution engine dedicated to trading the **5 Exponential Moving Average (EMA)** breakout patterns on a **15-minute timeframe**.

### Overview & Trading Rules
*   **Universe**: NIFTY 100 constituents exclusively.
*   **Scan Interval**: Triggers seamlessly in the background every 15 minutes to align with the close of a candle.
*   **Entry Trigger**:
    *   **Call Options (CE)**: Stock closes above the 5 EMA line AND the 14-period RSI validates strong momentum (RSI > 55) alongside a volume surge relative to its 10-period moving average.
    *   **Put Options (PE)**: Stock closes below the 5 EMA line AND RSI validates downside weakness (RSI < 45) with volume expansion.
*   **Execution**: Finds the Nearest Option Strike (ATM/NTM) instantly bypassing Shoonya and executes a paper trade (or live trade depending on the config mode).
*   **Default Take Profit & Stop Loss**: Hardcoded fallback values are 20% Target, 12% Stop Loss, but practically they are driven dynamically by backend limits.

---

## 🛑 2. Strategy Risk Guardrails & Max Target Profit
The `paper.service.ts` Risk Management backend previously monitored the global portfolio P&L to exit at heavy losses. It has been extensively scaled up to operate **independently separated per strategy** utilizing new `shoonyaConfig` models.

The exact UI configuration dynamically persists these elements across your Supabase DB:

*   **Strategy Daily Trade Limit**: Cap the number of trades the bot is allowed to execute on specific strategies (e.g. Stop trading Gann9 after 5 executions).
*   **Max Floating Strategy Loss (₹)**: Ensures one strategy doesn't drag the other strategies down. If a strategy's floating aggregate loss exceeds this limit (e.g. `-10,000`), the Risk Engine triggers an isolated Universal Exit, halting only that specific strategy from further ops for the day.
*   **Max Config Target Profit (₹)**: Intelligent Profit Locking! If a strategy hits its goal for the day (e.g. `+10,000`), the engine immediately squares off the strategy to prevent giving back the profits during messy intraday volatility.

---

## 📱 3. UI/UX Modernization & Mobile Responsiveness
The Frontend Next.js Desktop Dashboard has been rewritten to beautifully handle Mobile layouts dynamically without bloating the UI on Desktops.

*   **Mobile Top/Bottom Navigation**: The vertical sidebar hides natively on devices with shorter widths and spawns an elegant **Floating Apple-style Bottom Navigation Bar**.
*   **Interactive Tabs**: Navigating Dashboard, Gann 9, Gann Angle, Setup, and the newly injected 5 EMA strategy view operates flawlessly with single-handed thumb support. 
*   **Unified Active Trade Layout**: The `DashboardTab.tsx` native grid breaks apart gracefully into columns mapping specific metrics to touch-friendly interfaces.
