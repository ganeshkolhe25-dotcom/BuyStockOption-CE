"""
Shoonya Auto-Connect Script
Runs headless Chrome, logs into Shoonya, captures session token.

Strategy (in priority order):
  1. Capture susertoken from browser network responses (GenAcsTok / QuickAuth calls the web app makes)
  2. Capture susertoken from browser localStorage after redirect
  3. Capture auth code from redirect URL → exchange via GenAcsTok

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
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import InvalidSessionIdException, WebDriverException, StaleElementReferenceException
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

def scan_network_for_susertoken(driver):
    """Scan ALL network traffic for any susertoken value (highest priority)."""
    try:
        logs = driver.get_log("performance")
        for entry in logs:
            try:
                msg = json.loads(entry["message"])["message"]

                # --- Check response bodies (GenAcsTok / QuickAuth / any auth endpoint) ---
                if msg.get("method") == "Network.responseReceived":
                    response_url = msg.get("params", {}).get("response", {}).get("url", "")
                    content_type = msg.get("params", {}).get("response", {}).get("mimeType", "")
                    request_id = msg.get("params", {}).get("requestId", "")

                    if request_id and (
                        "susertoken" in response_url.lower() or
                        "GenAcsTok" in response_url or
                        "QuickAuth" in response_url or
                        "NorenWClient" in response_url
                    ):
                        try:
                            resp = driver.execute_cdp_cmd("Network.getResponseBody", {"requestId": request_id})
                            body = resp.get("body", "")
                            if body:
                                try:
                                    data = json.loads(body)
                                    token = data.get("susertoken")
                                    if token and len(token) > 10:
                                        print(f"[DEBUG] Found susertoken in response from {response_url[:80]}", flush=True)
                                        return token
                                except json.JSONDecodeError:
                                    # Some responses may not be JSON
                                    pass
                        except Exception:
                            pass

                # --- Check POST request bodies containing jKey ---
                if msg.get("method") == "Network.requestWillBeSent":
                    post_data = msg.get("params", {}).get("request", {}).get("postData", "")
                    if post_data and "jKey=" in post_data:
                        for part in post_data.split("&"):
                            if part.startswith("jKey="):
                                token = part[5:].strip()
                                if token and len(token) > 20:
                                    req_url = msg.get("params", {}).get("request", {}).get("url", "")
                                    print(f"[DEBUG] Found jKey in POST to {req_url[:80]}", flush=True)
                                    return token

            except Exception:
                continue
    except Exception:
        pass
    return None


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


def get_token_from_localstorage(driver):
    """Try to extract susertoken from browser localStorage/sessionStorage/cookies after login."""
    try:
        keys_to_try = ["susertoken", "jKey", "sessionToken", "access_token", "token", "stoken", "authToken", "userToken"]
        for key in keys_to_try:
            token = driver.execute_script(f"return localStorage.getItem('{key}');")
            if token and len(str(token)) > 20:
                print(f"[DEBUG] Found token in localStorage['{key}']", flush=True)
                return str(token)

        for key in keys_to_try:
            token = driver.execute_script(f"return sessionStorage.getItem('{key}');")
            if token and len(str(token)) > 20:
                print(f"[DEBUG] Found token in sessionStorage['{key}']", flush=True)
                return str(token)

        # Check cookies
        cookies = driver.get_cookies()
        for c in cookies:
            if c['name'].lower() in [k.lower() for k in keys_to_try]:
                if len(c.get('value', '')) > 20:
                    print(f"[DEBUG] Found token in cookie['{c['name']}']", flush=True)
                    return c['value']
        if cookies:
            readable = [(c['name'], c['value'][:40]) for c in cookies if len(c.get('value', '')) > 5]
            print(f"[DEBUG] Cookies: {readable}", flush=True)

        # Dump all localStorage keys for debugging
        all_keys = driver.execute_script("return Object.keys(localStorage);")
        if all_keys:
            print(f"[DEBUG] localStorage keys: {all_keys}", flush=True)
            for k in all_keys:
                v = driver.execute_script(f"return localStorage.getItem('{k}');")
                if v and len(str(v)) > 20 and len(str(v)) < 200:
                    print(f"[DEBUG]   localStorage['{k}'] = {str(v)[:60]}...", flush=True)

    except Exception as e:
        print(f"[DEBUG] localStorage check error: {e}", flush=True)
    return None


def exchange_auth_code(auth_code):
    """Exchange OAuth auth code for session token using official checksum formula."""
    CLIENT_ID = f"{UID}_U"
    checksum_variants = [
        (sha256(f"{CLIENT_ID}{SECRET_CODE}{auth_code}"), "clientId+secret+code [OFFICIAL]"),
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
# Use legacy --headless (not --headless=new) — the new mode crashes in Docker
# due to GPU/shared-memory constraints even with --disable-dev-shm-usage.
options.add_argument("--headless")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--disable-gpu")
options.add_argument("--disable-software-rasterizer")
options.add_argument("--disable-extensions")
options.add_argument("--no-first-run")
options.add_argument("--window-size=1920,1080")
options.add_argument("--disable-setuid-sandbox")
options.set_capability("goog:loggingPrefs", {"performance": "ALL"})

CHROME_BINARIES = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
CHROMEDRIVER_PATHS = ['/usr/bin/chromedriver', '/usr/lib/chromium/chromedriver',
                      '/usr/lib/chromium-browser/chromedriver', '/usr/local/bin/chromedriver']

for p in CHROME_BINARIES:
    if os.path.exists(p):
        options.binary_location = p
        print(f"[DEBUG] Using Chrome binary: {p}", flush=True)
        break

chromedriver_path = None
for p in CHROMEDRIVER_PATHS:
    if os.path.exists(p):
        chromedriver_path = p
        print(f"[DEBUG] Using chromedriver: {p}", flush=True)
        break

if not chromedriver_path:
    print("[DEBUG] chromedriver not found at known paths — letting Selenium locate it", flush=True)

auth_code = None
direct_token = None  # susertoken captured directly from network/localStorage

try:
    service = Service(chromedriver_path) if chromedriver_path else Service()
    driver = webdriver.Chrome(service=service, options=options)
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
    print("[DEBUG] Login button clicked, scanning for token/code...", flush=True)

    # Wait briefly and print page state so we can diagnose login success/failure
    time.sleep(3)
    try:
        post_click_url = driver.current_url
        post_click_title = driver.title
        print(f"[DEBUG] Post-login URL: {post_click_url[:120]}", flush=True)
        print(f"[DEBUG] Post-login title: {post_click_title}", flush=True)
        # Look for error messages on the page
        err_els = driver.find_elements(By.CSS_SELECTOR,
            "[class*='error' i], [class*='alert' i], [class*='invalid' i], [id*='error' i]")
        for el in err_els[:3]:
            txt = el.text.strip()
            if txt:
                print(f"[DEBUG] Page error element: {txt[:120]}", flush=True)
    except Exception as diag_err:
        print(f"[DEBUG] Post-login diagnostic error: {diag_err}", flush=True)

    start = time.time()
    last_ls_check = 0.0  # absolute time of last localStorage check
    while True:
        # Priority 1: direct susertoken from network traffic
        direct_token = scan_network_for_susertoken(driver)
        if direct_token:
            print(f"[DEBUG] Direct susertoken captured from network!", flush=True)
            break

        # Priority 2: auth code for later exchange
        auth_code = scan_network_for_code(driver)
        if auth_code:
            print(f"[DEBUG] Auth code captured: {auth_code[:20]}...", flush=True)
            # Keep scanning a bit more to see if a direct token also appears
            time.sleep(3)
            direct_token = scan_network_for_susertoken(driver)
            if direct_token:
                print(f"[DEBUG] Found direct token after auth code!", flush=True)
            break

        # Check localStorage/cookies every 10 seconds (use absolute timer, not modulo)
        if time.time() - last_ls_check >= 10:
            last_ls_check = time.time()
            ls_token = get_token_from_localstorage(driver)
            if ls_token:
                direct_token = ls_token
                break

        if time.time() - start > 60:
            new_otp = pyotp.TOTP(TOTP_KEY).now()
            if new_otp != otp:
                # Only re-fill if still on the login page (URL unchanged)
                try:
                    current_url = driver.current_url
                    print(f"[DEBUG] 60s timeout — URL: {current_url[:120]}", flush=True)
                    if "investor-entry-level/login" in current_url:
                        all_inp = driver.find_elements(By.CSS_SELECTOR, "input:not([type='hidden']):not([type='checkbox']):not([type='radio'])")
                        vis_inp = [i for i in all_inp if i.is_displayed()]
                        if len(vis_inp) >= 3:
                            fast_fill(vis_inp[2], new_otp)
                            wait.until(EC.element_to_be_clickable((By.XPATH, "//button[normalize-space()='LOGIN']"))).click()
                            start = time.time()
                            otp = new_otp
                            continue
                        else:
                            print("[DEBUG] Timeout: page navigated, inputs gone — checking localStorage once more.", flush=True)
                    else:
                        print(f"[DEBUG] Timeout: page navigated to {current_url[:80]} — checking localStorage.", flush=True)
                except Exception as nav_err:
                    print(f"[DEBUG] Timeout: error re-filling OTP ({nav_err}) — checking localStorage.", flush=True)
                # Page navigated — one more localStorage attempt before giving up
                ls_token = get_token_from_localstorage(driver)
                if ls_token:
                    direct_token = ls_token
                    break
            print("[DEBUG] Timeout: could not capture token or auth code.", flush=True)
            break
        time.sleep(0.5)

    print(f"[DEBUG] Current URL: {driver.current_url[:120]}", flush=True)

    # Try localStorage as final fallback before quitting browser
    if not direct_token:
        direct_token = get_token_from_localstorage(driver)

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

# ── Use best available credential ─────────────────────────────────────────────
if direct_token:
    # Best case: got the actual trading session token from the browser
    print(f"SESSION_TOKEN:{direct_token}", flush=True)
    sys.exit(0)

if not auth_code:
    print("ERROR:Could not capture auth code or session token. Check UID, Web Password, and TOTP Secret.", flush=True)
    sys.exit(1)

# Fallback: exchange auth code for session token via GenAcsTok
token, err = exchange_auth_code(auth_code)
if token:
    print(f"SESSION_TOKEN:{token}", flush=True)
    sys.exit(0)
else:
    print(f"AUTH_CODE_ONLY:{auth_code}", flush=True)
    print(f"EXCHANGE_ERROR:{err}", flush=True)
    sys.exit(1)
