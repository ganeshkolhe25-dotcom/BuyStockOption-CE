"""
Shoonya Auto-Connect Script
Runs headless Chrome, logs into Shoonya, and extracts the session token
directly from the browser network response — no OAuth checksum needed.

Output contract (one of these on stdout):
  SESSION_TOKEN:<token>        -> success
  ERROR:<message>              -> something went wrong
"""
import os, sys, time, json, hashlib
import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import InvalidSessionIdException, WebDriverException
from urllib.parse import urlparse, parse_qs
import pyotp

# ── Credentials from env vars (injected by NestJS) ────────────────────────────
UID        = os.environ.get('SHOONYA_UID', '').strip()
PASSWORD   = os.environ.get('SHOONYA_WEB_PWD', '').strip()
TOTP_KEY   = os.environ.get('SHOONYA_TOTP', '').strip()
APPKEY     = os.environ.get('SHOONYA_APPKEY', '').strip()

def sha256(s):
    return hashlib.sha256(s.encode()).hexdigest()

def scan_network_for_session_token(driver):
    """Look for susertoken in any network response body."""
    try:
        logs = driver.get_log("performance")
        for entry in logs:
            try:
                msg = json.loads(entry["message"])["message"]
                # Look in response bodies via Network.responseReceived
                if msg.get("method") == "Network.responseReceived":
                    url = msg.get("params", {}).get("response", {}).get("url", "")
                    if any(k in url for k in ["Login", "GenSess", "ValidateAuth", "login"]):
                        req_id = msg.get("params", {}).get("requestId")
                        if req_id:
                            try:
                                body = driver.execute_cdp_cmd("Network.getResponseBody", {"requestId": req_id})
                                body_text = body.get("body", "")
                                if "susertoken" in body_text:
                                    parsed = json.loads(body_text)
                                    token = parsed.get("susertoken")
                                    if token:
                                        print(f"[DEBUG] susertoken found in response for: {url[:100]}", flush=True)
                                        return token
                            except Exception:
                                pass
            except Exception:
                continue
    except Exception:
        pass
    return None

def scan_network_for_auth_code(driver):
    """Fallback: look for OAuth auth code in network request URLs."""
    try:
        logs = driver.get_log("performance")
        for entry in logs:
            try:
                msg = json.loads(entry["message"])["message"]
                if msg.get("method") == "Network.requestWillBeSent":
                    url = msg.get("params", {}).get("request", {}).get("url", "")
                    if "code=" in url:
                        parsed = urlparse(url)
                        code = parse_qs(parsed.query).get("code", [None])[0]
                        if code:
                            print(f"[DEBUG] Auth code found in URL: {url[:120]}", flush=True)
                            return code
            except Exception:
                continue
    except Exception:
        pass
    return None

def get_token_from_localStorage(driver):
    """Try to extract session token from browser localStorage/sessionStorage."""
    keys_to_try = [
        "susertoken", "jData", "suserjData", "token",
        "userToken", "accessToken", "sessionToken", "authToken"
    ]
    for key in keys_to_try:
        try:
            val = driver.execute_script(f"return localStorage.getItem('{key}')")
            if val and len(val) > 10:
                print(f"[DEBUG] localStorage['{key}'] = {val[:60]}", flush=True)
                # If it's JSON, extract susertoken from it
                try:
                    data = json.loads(val)
                    if isinstance(data, dict) and data.get("susertoken"):
                        return data["susertoken"]
                except Exception:
                    pass
                # If it looks like a raw token (long alphanumeric string)
                if len(val) > 20 and ' ' not in val and '{' not in val:
                    return val
        except Exception:
            pass
    return None

def exchange_token_pya3(auth_code):
    """Exchange OAuth auth code for session token — try all checksum variants."""
    url = "https://trade.shoonya.com/NorenWClientAPI/GenAcsTok"
    checksum_variants = [
        (sha256(f"{APPKEY}{auth_code}"),             "appkey+code (no sep)"),
        (sha256(f"{UID}|{APPKEY}|{auth_code}"),      "uid|appkey|code"),
        (sha256(f"{UID}|{auth_code}|{APPKEY}"),      "uid|code|appkey"),
        (sha256(f"{auth_code}|{APPKEY}"),            "code|appkey"),
        (sha256(f"{UID}|{auth_code}"),               "uid|code"),
        (sha256(f"{APPKEY}|{auth_code}"),            "appkey|code"),
    ]
    last_err = "No attempts made"
    for checksum, label in checksum_variants:
        try:
            payload = {"jData": json.dumps({"uid": UID, "code": auth_code, "checksum": checksum})}
            r = requests.post(url, data=payload, timeout=15)
            print(f"[DEBUG] GenAcsTok [{label}] => HTTP {r.status_code} | {r.text[:300]}", flush=True)
            d = r.json()
            if d.get("stat") == "Ok" and d.get("susertoken"):
                return d["susertoken"], None
            last_err = d.get("emsg", r.text[:200])
            if "no data" in last_err.lower() or "expired" in last_err.lower():
                return None, f"Auth code expired/invalid: {last_err}"
        except Exception as e:
            last_err = str(e)
    return None, last_err

def fast_fill(el, value):
    el.click(); time.sleep(0.1)
    el.clear(); el.send_keys(value); time.sleep(0.1)

# ── Chrome setup ───────────────────────────────────────────────────────────────
opts = webdriver.ChromeOptions()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--disable-gpu")
opts.add_argument("--window-size=1920,1080")
opts.add_argument("--disable-setuid-sandbox")
opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})

for p in ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']:
    if os.path.exists(p):
        opts.binary_location = p
        print(f"[DEBUG] Using Chrome binary: {p}", flush=True)
        break

session_token = None
auth_code = None

try:
    driver = webdriver.Chrome(options=opts)
    wait = WebDriverWait(driver, 30)

    # ── Strategy 1: Direct API login page (captures session token from response) ──
    # First try the standard QuickAuth-style web login which directly returns susertoken
    LOGIN_URL = f"https://trade.shoonya.com/OAuthlogin/investor-entry-level/login?api_key={UID}_U&route_to={UID}"
    print(f"[DEBUG] Navigating to: {LOGIN_URL}", flush=True)
    driver.get(LOGIN_URL)
    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "input[type='password']")))
    time.sleep(1)

    inputs = [i for i in driver.find_elements(By.CSS_SELECTOR, "input:not([type='hidden']):not([type='checkbox']):not([type='radio'])") if i.is_displayed()]
    print(f"[DEBUG] Found {len(inputs)} visible inputs", flush=True)

    fast_fill(inputs[0], UID)
    fast_fill(inputs[1], PASSWORD)

    otp = pyotp.TOTP(TOTP_KEY).now()
    fast_fill(inputs[2], otp)
    print(f"[DEBUG] Filled UID={UID}, PWD=***, OTP={otp}", flush=True)

    wait.until(EC.element_to_be_clickable((By.XPATH, "//button[normalize-space()='LOGIN']"))).click()
    print("[DEBUG] Login button clicked, scanning for session token...", flush=True)

    start = time.time()
    while time.time() - start < 60:
        # Check 1: session token in network response
        session_token = scan_network_for_session_token(driver)
        if session_token:
            print(f"[DEBUG] Session token found in network response!", flush=True)
            break

        # Check 2: auth code for OAuth exchange
        code = scan_network_for_auth_code(driver)
        if code:
            auth_code = code
            print(f"[DEBUG] Got auth code, will try exchange: {code[:20]}...", flush=True)
            break

        # Check 3: token in localStorage (after page settles)
        if time.time() - start > 5:
            ls_token = get_token_from_localStorage(driver)
            if ls_token:
                session_token = ls_token
                print(f"[DEBUG] Session token found in localStorage!", flush=True)
                break

        # Re-send OTP if it expired
        if time.time() - start > 60:
            new_otp = pyotp.TOTP(TOTP_KEY).now()
            if new_otp != otp:
                fast_fill(inputs[2], new_otp)
                wait.until(EC.element_to_be_clickable((By.XPATH, "//button[normalize-space()='LOGIN']"))).click()
                start = time.time(); otp = new_otp
            break

        time.sleep(0.5)

    # Check localStorage one final time if we haven't found anything
    if not session_token and not auth_code:
        ls_token = get_token_from_localStorage(driver)
        if ls_token:
            session_token = ls_token

    # Debug: dump current URL and page cookies
    print(f"[DEBUG] Current URL: {driver.current_url[:120]}", flush=True)
    try:
        cookies = driver.get_cookies()
        for c in cookies:
            print(f"[DEBUG] Cookie: {c.get('name')}={str(c.get('value',''))[:30]}", flush=True)
    except Exception:
        pass

except (InvalidSessionIdException, WebDriverException) as e:
    print(f"ERROR:Browser error: {e}", flush=True); sys.exit(1)
except Exception as e:
    print(f"ERROR:{e}", flush=True); sys.exit(1)
finally:
    try: driver.quit()
    except: pass

# ── Token obtained directly ────────────────────────────────────────────────────
if session_token:
    print(f"SESSION_TOKEN:{session_token}", flush=True)
    sys.exit(0)

# ── Fallback: exchange auth code ───────────────────────────────────────────────
if auth_code:
    print(f"[DEBUG] Auth code: {auth_code}", flush=True)
    token, err = exchange_token_pya3(auth_code)
    if token:
        print(f"SESSION_TOKEN:{token}", flush=True)
        sys.exit(0)
    else:
        print(f"AUTH_CODE_ONLY:{auth_code}", flush=True)
        print(f"EXCHANGE_ERROR:{err}", flush=True)
        sys.exit(1)

print("ERROR:Could not capture session token or auth code. Check credentials.", flush=True)
sys.exit(1)
