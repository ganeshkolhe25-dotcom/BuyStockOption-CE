"""
Shoonya Auto-Connect Script
Runs headless Chrome, logs into Shoonya, captures auth code, exchanges for session token.

Output contract (one of these on stdout):
  SESSION_TOKEN:<token>        -> success
  AUTH_CODE_ONLY:<code>        -> got code but exchange failed (NestJS will retry)
  EXCHANGE_ERROR:<message>     -> exchange error detail
  ERROR:<message>              -> login/browser error
"""
import os, sys, time, json, hashlib
import requests
import pyotp
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import InvalidSessionIdException, WebDriverException
from urllib.parse import urlparse, parse_qs

# ── Credentials from env vars (injected by NestJS autoConnect) ────────────────
UID         = os.environ.get('SHOONYA_UID', '').strip()
PASSWORD    = os.environ.get('SHOONYA_WEB_PWD', '').strip()
TOTP_KEY    = os.environ.get('SHOONYA_TOTP', '').strip()
APPKEY      = os.environ.get('SHOONYA_APPKEY', '').strip()
SECRET_CODE = os.environ.get('SHOONYA_SECRET_CODE', '').strip()

CLIENT_ID = f"{UID}_U"
LOGIN_URL = f"https://trade.shoonya.com/OAuthlogin/investor-entry-level/login?api_key={CLIENT_ID}&route_to={UID}"
TOKEN_URL = "https://api.shoonya.com/NorenWClientAPI/GenAcsTok"

def sha256(s):
    return hashlib.sha256(s.encode()).hexdigest()

def scan_network_for_code(driver):
    """Capture OAuth auth code from browser network logs."""
    try:
        logs = driver.get_log("performance")
        for entry in logs:
            try:
                msg = json.loads(entry["message"])["message"]
                if msg.get("method") == "Network.requestWillBeSent":
                    url = msg.get("params", {}).get("request", {}).get("url", "")
                    if "code=" in url and "shoonya" in url.lower():
                        parsed = urlparse(url)
                        code = parse_qs(parsed.query).get("code", [None])[0]
                        if code:
                            return code
            except Exception:
                continue
    except Exception:
        pass
    return None

def exchange_auth_code(auth_code):
    """Exchange OAuth auth code for session token using official checksum formula.
    Official formula (NorenRestApiOAuth SDK): SHA256(client_id + Secret_Code + auth_code)
    """
    CLIENT_ID = f"{UID}_U"
    checksum_variants = [
        # ✅ Official formula: SHA256(client_id + Secret_Code + auth_code)
        (sha256(f"{CLIENT_ID}{SECRET_CODE}{auth_code}"), "clientId+secret+code [OFFICIAL]"),
        # Fallback variants
        (sha256(f"{SECRET_CODE}{auth_code}"),        "secret_code+code"),
        (sha256(f"{SECRET_CODE}|{auth_code}"),       "secret_code|code"),
        (sha256(f"{APPKEY}{auth_code}"),             "appkey+code"),
    ]
    last_err = "No attempts made"
    for checksum, label in checksum_variants:
        try:
            jdata_str = json.dumps({"uid": UID, "code": auth_code, "checksum": checksum})
            payload = f"jData={jdata_str}"
            r = requests.post(TOKEN_URL, data=payload,
                              headers={"Content-Type": "application/x-www-form-urlencoded"},
                              timeout=15)
            print(f"[DEBUG] GenAcsTok [{label}] => HTTP {r.status_code} | {r.text[:300]}", flush=True)
            d = r.json()
            # OAuth SDK returns access_token + susertoken; QuickAuth returns stat:Ok + susertoken
            token = d.get("susertoken")
            if token:
                return token, None
            last_err = d.get("emsg", r.text[:200])
            if "no data" in last_err.lower() or "expir" in last_err.lower():
                return None, f"Auth code expired: {last_err}"
        except Exception as e:
            last_err = str(e)
    return None, last_err

def fast_fill(element, value):
    element.click()
    time.sleep(0.1)
    element.clear()
    element.send_keys(value)
    time.sleep(0.1)

# ── Chrome setup ───────────────────────────────────────────────────────────────
options = webdriver.ChromeOptions()
options.add_argument("--headless=new")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--disable-gpu")
options.add_argument("--window-size=1920,1080")
options.add_argument("--disable-setuid-sandbox")
options.set_capability("goog:loggingPrefs", {"performance": "ALL"})

for p in ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']:
    if os.path.exists(p):
        options.binary_location = p
        print(f"[DEBUG] Using Chrome binary: {p}", flush=True)
        break

auth_code = None

try:
    driver = webdriver.Chrome(options=options)
    wait = WebDriverWait(driver, 30)

    print(f"[DEBUG] Navigating to: {LOGIN_URL}", flush=True)
    driver.get(LOGIN_URL)

    wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "input[type='password']")))
    time.sleep(1)

    all_inputs = driver.find_elements(By.CSS_SELECTOR, "input:not([type='hidden']):not([type='checkbox']):not([type='radio'])")
    visible_inputs = [i for i in all_inputs if i.is_displayed()]
    print(f"[DEBUG] Found {len(visible_inputs)} visible inputs", flush=True)

    fast_fill(visible_inputs[0], UID)
    fast_fill(visible_inputs[1], PASSWORD)

    otp = pyotp.TOTP(TOTP_KEY).now()
    fast_fill(visible_inputs[2], otp)
    print(f"[DEBUG] Filled UID={UID}, PWD=***, OTP={otp}", flush=True)

    wait.until(EC.element_to_be_clickable((By.XPATH, "//button[normalize-space()='LOGIN']"))).click()
    print("[DEBUG] Login button clicked, scanning for auth code...", flush=True)

    start = time.time()
    while True:
        auth_code = scan_network_for_code(driver)
        if auth_code:
            print(f"[DEBUG] Auth code captured: {auth_code[:20]}...", flush=True)
            break
        if time.time() - start > 60:
            new_otp = pyotp.TOTP(TOTP_KEY).now()
            if new_otp != otp:
                fast_fill(visible_inputs[2], new_otp)
                wait.until(EC.element_to_be_clickable((By.XPATH, "//button[normalize-space()='LOGIN']"))).click()
                start = time.time()
                otp = new_otp
                continue
            print("[DEBUG] Timeout: could not capture auth code.", flush=True)
            break
        time.sleep(0.5)

    print(f"[DEBUG] Current URL: {driver.current_url[:120]}", flush=True)

except (InvalidSessionIdException, WebDriverException) as e:
    print(f"ERROR:Browser error: {e}", flush=True)
    sys.exit(1)
except Exception as e:
    print(f"ERROR:{e}", flush=True)
    sys.exit(1)
finally:
    try:
        driver.quit()
    except Exception:
        pass

# ── Exchange auth code for session token ───────────────────────────────────────
if not auth_code:
    print("ERROR:Could not capture auth code. Check UID, Web Password, and TOTP Secret.", flush=True)
    sys.exit(1)

token, err = exchange_auth_code(auth_code)
if token:
    print(f"SESSION_TOKEN:{token}", flush=True)
    sys.exit(0)
else:
    print(f"AUTH_CODE_ONLY:{auth_code}", flush=True)
    print(f"EXCHANGE_ERROR:{err}", flush=True)
    sys.exit(1)
