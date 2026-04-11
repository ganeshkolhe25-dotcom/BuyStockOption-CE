const puppeteer = require('puppeteer');
const { TOTP } = require('totp-generator');

const CLIENT_ID = "FN140579_U";
const USER_ID = "FN140579";
const PASSWORD = "Vkolhe77@3";
const TOTP_SECRET = "AMA4F3VI326675U7354U35N322YK54G3";
const SECRET_CODE = "Gg2Liz24IyD3qIN1Q63oa5anQa61aN611GI2IXF5KxEQLRRebxAzzidYGd2bbzga";
const LOGIN_URL = `https://trade.shoonya.com/OAuthlogin/investor-entry-level/login?api_key=${CLIENT_ID}&route_to=${USER_ID}`;

async function runAuth() {
    console.log("Preparing Headless Browser Engine (Node.js/Puppeteer)...");
    // Launch standard visual browser so you can watch what happens
    const browser = await puppeteer.launch({ 
        headless: false,
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800']
    });
    
    let authCodeFound = null;

    try {
        const page = await browser.newPage();
        
        // Listen to all network requests to intercept the Auth Code
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            try {
                // If the URL has 'code=' and it's from shoonya, grab the code
                if (url.includes('code=') && url.toLowerCase().includes('shoonya')) {
                    const parsedUrl = new URL(url);
                    const code = parsedUrl.searchParams.get('code');
                    if (code) {
                        authCodeFound = code;
                    }
                }
            } catch (e) { }
            request.continue(); // Always let request pass
        });

        console.log("Navigating to Shoonya OAuth Login...");
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

        // Wait for the password input field to render
        await page.waitForSelector('input[type="password"]', { timeout: 30000 });
        
        // We now know the EXACT element IDs used by Shoonya!
        console.log("Locating exact field IDs...");
        
        await page.waitForSelector('#lgnusrid', { timeout: 30000 });
        
        // Generate TOTP safely
        let otpValue = "";
        try {
            const resultPromise = TOTP.generate ? TOTP.generate(TOTP_SECRET) : (typeof TOTP === 'function' ? TOTP(TOTP_SECRET) : require('totp-generator')(TOTP_SECRET));
            // Await the promise since newer versions of totp-generator are asynchronous!
            const otpRes = await Promise.resolve(resultPromise);
            otpValue = String(otpRes.otp || otpRes || "").trim();
        } catch (e) {
            console.log("Error generating TOTP:", e);
            otpValue = "000000";
        }

        console.log("Injecting values natively by ID...");

        // Inject cleanly by explicit ID
        await page.$eval('#lgnusrid', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, String(USER_ID));
        await new Promise(r => setTimeout(r, 200));
        
        await page.$eval('#lgnpwd', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, String(PASSWORD));
        await new Promise(r => setTimeout(r, 200));
        
        await page.$eval('#lgnotp', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, otpValue);
        await new Promise(r => setTimeout(r, 200));

        console.log("Credentials injected natively, submitting Login...");
        
        // Helpful delay to simulate human reading time before clicking
        await new Promise(r => setTimeout(r, 1000));
        
        // Click the exact Login button class identified
        await page.evaluate(() => {
            const btn = document.querySelector('.lgnBtnClss');
            if (btn) btn.click();
        });

            console.log("Waiting for network intercept of Auth Code...");
            
            // Polling loop to wait for authCodeFound to be set by the network listener
            for (let i = 0; i < 60; i++) { // wait up to 30 seconds
                if (authCodeFound) {
                    console.log("\n==================================");
                    console.log(`✅ AUTH CODE CAPTURED: ${authCodeFound}`);
                    console.log("==================================\n");
                    console.log("🚀 Please copy the code above and place it in your .env or session configuration!\n");
                    break;
                }
                await new Promise(r => setTimeout(r, 500));
            }

            if (!authCodeFound) {
                console.log("❌ Timeout: Did not capture Auth Code. Taking a snapshot to see why...");
                try {
                    await page.screenshot({ path: 'shoonya-error-debug.png', fullPage: true });
                    console.log("📸 Saved a screenshot to 'backend/shoonya-error-debug.png'. Please check this image to see the Shoonya login error on the screen!");
                } catch (e) {
                    console.log("Could not save screenshot.");
                }
            }


    } catch (error) {
        console.error("❌ Browser Automation Error:", error.message);
    } finally {
        await browser.close();
    }
}

runAuth();
