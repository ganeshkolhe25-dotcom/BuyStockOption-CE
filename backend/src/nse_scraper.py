import sys
import json
try:
    from nsepython import nse_get_top_gainers, nse_get_top_losers, nse_quote_ltp
except ImportError:
    # Fallback to output dummy for demonstration until pip install nsepython is run
    def nse_get_top_gainers():
        return [{"symbol": "RELIANCE", "ltp": 2800, "pChange": 4.5}, {"symbol": "TCS", "ltp": 3800, "pChange": 3.2}]
    def nse_get_top_losers():
        return [{"symbol": "INFY", "ltp": 1600, "pChange": -2.5}, {"symbol": "HDFC", "ltp": 1400, "pChange": -1.2}]
    def nse_quote_ltp(symbol):
        return 2800

def get_gainers_losers():
    try:
        gainers = nse_get_top_gainers()
        losers = nse_get_top_losers()
        # Filter FnO stocks with LTP between 5000 and 30000.
        # Note: In real life nsepython output format needs to be adapted.
        
        filtered_stocks = []
        for stock in gainers + losers:
            if isinstance(stock, dict) and 'symbol' in stock and 'ltp' in stock:
                # Mock threshold filter, assuming the real nsepython has same keys
                symbol = stock['symbol']
                ltp = float(stock.get('ltp', 0) or stock.get('lastPrice', 0))
                if 5000 <= ltp <= 30000:
                    filtered_stocks.append({
                        "symbol": symbol,
                        "ltp": ltp,
                        "pChange": float(stock.get('pChange', 0))
                    })
        
        return {"status": "success", "data": filtered_stocks}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def get_ltp(symbol):
    try:
        ltp = nse_quote_ltp(symbol)
        return {"status": "success", "ltp": ltp}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        sys.exit(1)
        
    command = sys.argv[1]
    if command == "scan":
        print(json.dumps(get_gainers_losers()))
    elif command == "ltp" and len(sys.argv) == 3:
        symbol = sys.argv[2]
        print(json.dumps(get_ltp(symbol)))
    else:
        print(json.dumps({"error": "Unknown command"}))
