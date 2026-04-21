import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import * as crypto from 'crypto';
import { TOTP } from 'totp-generator';
import { PrismaService } from './prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import WebSocket from 'ws';
const execAsync = promisify(exec);

export interface OptionContract {
    strike: number;
    type: 'CE' | 'PE';
    symbol: string;
    token: string;
    ltp: number;
    delta: number;
    lotSize: number;
    tradingSymbol: string;
}

@Injectable()
export class ShoonyaService implements OnModuleInit {
    private readonly logger = new Logger(ShoonyaService.name);

    // Data/trading API endpoint (SearchScrip, GetQuotes, TPSeries, PlaceOrder, etc.)
    private readonly endpoint = process.env.SHOONYA_BASE_URL || 'https://trade.shoonya.com/NorenWClient';
    // Authentication-only endpoint (QuickAuth lives here, different from the data endpoint)
    private readonly authEndpoint = process.env.SHOONYA_AUTH_URL || 'https://trade.shoonya.com/NorenWClientAPI';
    private sessionToken: string | null = null;
    public lastAuthError: string | null = null;
    // Prevents multiple concurrent 401 handlers from each triggering a re-auth
    private sessionClearInProgress = false;
    // Timestamp of the last auto-connect attempt — prevents cascading 401 → autoConnect loops.
    // 401 handlers skip autoConnect if one ran within the last 3 minutes.
    private lastAutoConnectMs = 0;
    // Callback registered by NseService to trigger token refresh after daily re-auth
    private onSessionRefreshed: (() => Promise<void>) | null = null;

    /** NseService calls this once during its onModuleInit to hook into the daily refresh cycle */
    registerSessionRefreshHook(cb: () => Promise<void>) {
        this.onSessionRefreshed = cb;
    }

    // ── WebSocket tick feed ────────────────────────────────────────────────
    private ws: WebSocket | null = null;
    private readonly tickCache = new Map<string, number>(); // NSE token → latest LTP
    private wsShouldRun = false;
    private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private readonly subscribedKeys = new Set<string>(); // "NSE|token" keys

    constructor(private readonly prisma: PrismaService) {}

    async onModuleInit() {
        // Load persisted session token from DB synchronously before any other service's
        // onModuleInit runs (NestJS resolves in dependency order, so ShoonyaService loads
        // before NseService). This prevents the race condition where NseService called
        // authenticate() before the token promise resolved.
        try {
            const cfg = await this.prisma.shoonyaConfig.findFirst();
            if (cfg?.sessionToken && cfg.sessionToken.length > 10) {
                this.sessionToken = cfg.sessionToken;
                this.logger.log('Loaded persisted Shoonya session token from DB into memory.');
            }
        } catch { /* DB not ready — sessionToken stays null, authenticate() will handle it */ }
    }

    private configCache: { value: any; expiresAt: number } | null = null;

    async getConfig() {
        const now = Date.now();
        if (this.configCache && now < this.configCache.expiresAt) {
            return this.configCache.value;
        }
        try {
            const dbConfig = await this.prisma.shoonyaConfig.findFirst();
            const value = {
                uid: dbConfig?.uid || process.env.SHOONYA_UID || '',
                pwd: dbConfig?.pwd || process.env.SHOONYA_PWD || '',
                factor2: dbConfig?.factor2 || process.env.SHOONYA_FACTOR2 || '',
                vc: dbConfig?.vc || process.env.SHOONYA_VC || '',
                appkey: dbConfig?.appkey || process.env.SHOONYA_APPKEY || '',
                // @ts-ignore
                expiryMonth: dbConfig?.expiryMonth || 'AUTO'
            };
            this.configCache = { value, expiresAt: now + 30_000 };
            return value;
        } catch {
            return {
                uid: process.env.SHOONYA_UID || '',
                pwd: process.env.SHOONYA_PWD || '',
                factor2: process.env.SHOONYA_FACTOR2 || '',
                vc: process.env.SHOONYA_VC || '',
                appkey: process.env.SHOONYA_APPKEY || '',
                expiryMonth: 'AUTO'
            };
        }
    }

    /**
     * Directly inject a pre-obtained session token (e.g. from a local machine exchange).
     * Validates by making a test API call, then persists to memory + DB.
     */
    async injectSessionToken(token: string): Promise<{ success: boolean; message: string }> {
        try {
            // Quick validation — search for a known symbol to confirm token works
            const testRes = await axios.post(`${this.endpoint}/SearchScrip`,
                `jData=${JSON.stringify({ uid: (await this.getConfig()).uid, stext: 'NIFTY', exch: 'NSE' })}&jKey=${token}`,
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
            );
            if (testRes.data?.stat === 'Not_Ok') {
                return { success: false, message: `Token validation failed: ${testRes.data.emsg}` };
            }
            this.sessionToken = token;
            this.lastAuthError = null;
            const existing = await this.prisma.shoonyaConfig.findFirst();
            if (existing) {
                await this.prisma.shoonyaConfig.update({ where: { id: existing.id }, data: { sessionToken: token } });
            }
            this.logger.log('✅ Session token injected and validated successfully.');
            if (this.onSessionRefreshed) this.onSessionRefreshed();
            return { success: true, message: 'Session token injected and active.' };
        } catch (err: any) {
            return { success: false, message: err.message || 'Injection failed' };
        }
    }

    /**
     * Authenticate to Finvasia Shoonya via QuickAuth
     */
    /**
     * Exchange an OAuth auth code (obtained from getAuthCode.py) for a session token via GenAcsTok.
     * Stores the token in DB for subsequent API calls.
     */
    async exchangeAuthCode(authCode: string): Promise<{ success: boolean; message: string }> {
        this.logger.log('Exchanging OAuth auth code for Shoonya session token...');
        try {
            const config = await this.getConfig();
            const uid = (config.uid || '').trim();
            const appkey = (config.appkey || '').trim();
            // The QuickAuth appkey is SHA256(uid|raw_secret); GenAcsTok may use same hashed key
            const appkeyHash = crypto.createHash('sha256').update(`${uid}|${appkey}`).digest('hex');
            const clientId = `${uid}_U`; // Shoonya OAuth uses CLIENT_ID = UID_U format

            // Shoonya GenAcsTok checksum = SHA256(client_id + Secret_Code + auth_code)
            // Source: NorenRestApiOAuth SDK getAccessToken() method
            const dbConfig = await this.prisma.shoonyaConfig.findFirst();
            const secretCode = (dbConfig?.secretCode || '').trim();

            const checksumVariants: Array<{ checksum: string; uidVal: string; label: string }> = [
                // ✅ Official formula: SHA256(client_id + Secret_Code + auth_code), uid=UID in payload
                ...(secretCode ? [
                    { checksum: crypto.createHash('sha256').update(`${clientId}${secretCode}${authCode}`).digest('hex'), uidVal: uid, label: 'clientId+secret+code [OFFICIAL]' },
                ] : []),
                // Fallback variants (kept for safety)
                ...(secretCode ? [
                    { checksum: crypto.createHash('sha256').update(`${secretCode}${authCode}`).digest('hex'),   uidVal: uid,      label: 'secret+code' },
                    { checksum: crypto.createHash('sha256').update(`${secretCode}|${authCode}`).digest('hex'),  uidVal: uid,      label: 'secret|code' },
                ] : []),
                { checksum: crypto.createHash('sha256').update(`${appkeyHash}${authCode}`).digest('hex'),       uidVal: uid,      label: 'hash(uid|key)+code' },
                { checksum: crypto.createHash('sha256').update(`${appkey}${authCode}`).digest('hex'),           uidVal: uid,      label: 'key+code' },
                { checksum: crypto.createHash('sha256').update(`${clientId}|${appkey}|${authCode}`).digest('hex'), uidVal: clientId, label: 'clientId|key|code' },
            ];

            for (const { checksum, uidVal, label } of checksumVariants) {
                try {
                    const payload = `jData=${JSON.stringify({ uid: uidVal, code: authCode, checksum })}`;
                    const response = await axios.post('https://api.shoonya.com/NorenWClientAPI/GenAcsTok', payload, {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        timeout: 15000,
                    });

                    this.logger.log(`GenAcsTok [${label}] uid=${uidVal} => ${JSON.stringify(response.data).slice(0, 200)}`);

                    if (response.data.stat === 'Ok' && response.data.susertoken) {
                        const token = response.data.susertoken;
                        this.sessionToken = token;
                        this.lastAuthError = null;

                        const existing = await this.prisma.shoonyaConfig.findFirst();
                        if (existing) {
                            await this.prisma.shoonyaConfig.update({
                                where: { id: existing.id },
                                data: { sessionToken: token },
                            });
                        }

                        this.logger.log('✅ Session token obtained and persisted to DB.');
                        if (this.onSessionRefreshed) this.onSessionRefreshed();
                        return { success: true, message: 'Shoonya connected successfully.' };
                    }

                    const emsg = response.data.emsg || '';
                    if (emsg.toLowerCase().includes('no data') || emsg.toLowerCase().includes('expir')) {
                        return { success: false, message: `Auth code expired or not found: ${emsg}` };
                    }
                } catch (e) {
                    this.logger.warn(`GenAcsTok attempt failed: ${e.message}`);
                }
            }

            return { success: false, message: 'GenAcsTok: all checksum variants rejected. Check logs for Shoonya response details.' };
        } catch (error) {
            this.lastAuthError = error.message;
            this.logger.error(`Auth code exchange error: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * Fully automated connect: runs getAuthCode.py inside the container using
     * headless Chromium, captures the auth code, and exchanges it automatically.
     */
    async autoConnect(): Promise<{ success: boolean; message: string }> {
        this.lastAutoConnectMs = Date.now(); // record attempt time for cooldown
        this.logger.log('Auto-connect: launching headless Chrome to get Shoonya session token...');
        try {
            const dbConfig = await this.prisma.shoonyaConfig.findFirst();
            if (!dbConfig?.uid || !dbConfig?.webPwd || !dbConfig?.factor2) {
                return { success: false, message: 'Missing credentials. Fill in User ID, Web Login Password, and TOTP Secret then Save Config first.' };
            }

            const scriptPath = path.join(process.cwd(), 'getAuthCode.py');
            const env = {
                ...process.env,
                SHOONYA_UID:         dbConfig.uid.trim(),
                SHOONYA_WEB_PWD:     dbConfig.webPwd.trim(),
                SHOONYA_TOTP:        dbConfig.factor2.trim(),
                SHOONYA_APPKEY:      dbConfig.appkey.trim(),
                SHOONYA_SECRET_CODE: dbConfig.secretCode?.trim() || '',
            };

            this.logger.log(`Spawning: python3 ${scriptPath}`);
            let stdout = '', stderr = '';
            try {
                ({ stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, { env, timeout: 90000 }));
            } catch (execErr: any) {
                // execAsync throws on non-zero exit — stdout/stderr still populated
                stdout = execErr.stdout || '';
                stderr = execErr.stderr || '';
            }

            // Log all lines from Python so we can diagnose issues
            for (const line of stdout.split('\n').filter(l => l.trim())) {
                this.logger.log(`[PY] ${line}`);
            }
            if (stderr) this.logger.warn(`Python stderr: ${stderr}`);

            // Best case: Python exchanged the token itself
            const tokenMatch = stdout.match(/SESSION_TOKEN:([a-zA-Z0-9\-_]+)/);
            if (tokenMatch) {
                const token = tokenMatch[1];
                this.sessionToken = token;
                this.lastAuthError = null;
                if (dbConfig) {
                    await this.prisma.shoonyaConfig.update({ where: { id: dbConfig.id }, data: { sessionToken: token } });
                }
                this.logger.log('✅ Session token obtained and persisted via auto-connect.');
                // Notify registered hooks (e.g. NseService.refreshSecurityTokens) so the
                // token map is populated immediately — without waiting for the 9:10 AM cron.
                if (this.onSessionRefreshed) this.onSessionRefreshed();
                return { success: true, message: 'Shoonya connected successfully via auto-connect.' };
            }

            // Fallback: Python got the code but exchange failed — try from NestJS side
            const codeMatch = stdout.match(/AUTH_CODE_ONLY:([a-zA-Z0-9\-]+)/);
            const exchangeErr = stdout.match(/EXCHANGE_ERROR:(.*)/)?.[1] || 'Unknown exchange error';
            if (codeMatch) {
                this.logger.warn(`Python exchange failed (${exchangeErr}). Trying NestJS-side exchange...`);
                return await this.exchangeAuthCode(codeMatch[1]);
            }

            // Login/capture failed
            const errMatch = stdout.match(/ERROR:(.*)/);
            const reason = errMatch?.[1] || 'Could not capture auth code. Check UID, Web Password, and TOTP Secret.';
            this.logger.error(`Auto-connect failed. Full output:\n${stdout}`);
            return { success: false, message: reason, debug: stdout } as any;

        } catch (error) {
            this.logger.error(`Auto-connect error: ${error.message}`);
            if (error.message?.includes('python3')) {
                return { success: false, message: 'Python3 not found. Ensure the latest Docker image is deployed.' };
            }
            return { success: false, message: error.message };
        }
    }

    /**
     * Daily 9:00 AM token refresh — runs getAuthCode.py via headless Chrome
     * before the market opens, ensuring a valid session is ready by 9:20 AM scan.
     * Shoonya requires a fresh OAuth web login every morning.
     */
    @Cron('0 09 * * 1-5', { timeZone: 'Asia/Kolkata' })
    async dailyTokenRefresh() {
        this.logger.log('⏰ 9:00 AM Daily Token Refresh — running getAuthCode.py...');
        this.sessionToken = null; // Force fresh login, don't reuse yesterday's token
        const result = await this.autoConnect();
        if (result.success) {
            this.logger.log('✅ Daily token refresh succeeded. Triggering NSE token resolution...');
        } else {
            this.logger.warn(`⚠️ autoConnect failed (${result.message}). Falling back to QuickAuth...`);
            await this.authenticate(); // QuickAuth as last-resort fallback
        }
        // Fire the NseService token refresh immediately after getting a fresh session
        // (rather than waiting for the 9:10 AM cron, which is a safety-net fallback)
        if (this.onSessionRefreshed) {
            this.logger.log('🔄 Calling registered NSE token refresh hook...');
            await this.onSessionRefreshed();
        }
    }

    async forceReauth(): Promise<boolean> {
        this.sessionToken = null;
        return this.authenticate();
    }

    async authenticate() {
        this.logger.log('Initiating Shoonya Authentication...');

        // Primary: use in-memory session token (loaded from DB at startup by onModuleInit)
        if (this.sessionToken && this.sessionToken.length > 10) {
            this.lastAuthError = null;
            this.logger.log('✅ Using in-memory Shoonya session token.');
            return true;
        }

        // Secondary: try loading token from DB now (catches the startup race where Prisma
        // wasn't ready during onModuleInit, so the token was never loaded into memory).
        // Note: we trust a non-empty DB token here; if it's expired, the first API call
        // will catch the 401 and call clearExpiredSession() to force a fresh QuickAuth.
        try {
            const cfg = await this.prisma.shoonyaConfig.findFirst();
            if (cfg?.sessionToken && cfg.sessionToken.length > 10) {
                this.sessionToken = cfg.sessionToken;
                this.lastAuthError = null;
                this.logger.log('✅ Loaded Shoonya session token from DB on-demand (startup race recovery).');
                return true;
            }
        } catch { /* DB still not ready — fall through to QuickAuth */ }

        // Fallback: QuickAuth with credentials
        try {
            const config = await this.getConfig();
            const uid = (config.uid || '').trim();
            const pwd = (config.pwd || '').trim();
            const appkey = (config.appkey || '').trim();
            const vc = (config.vc || '').trim();
            const factor2 = (config.factor2 || '').trim();

            const appkeyHash = crypto.createHash('sha256').update(`${uid}|${appkey}`).digest('hex');

            let generatedFactor2 = factor2;
            if (factor2 && factor2.length > 10 && !factor2.includes('-')) {
                try {
                    const otpResult = await TOTP.generate(factor2);
                    if (otpResult && otpResult.otp) {
                        generatedFactor2 = otpResult.otp;
                        this.logger.log('Successfully generated live TOTP using provided secret key.');
                    }
                } catch (e) {
                    this.logger.debug('Factor2 provided is not a valid TOTP Secret, using it as direct value (e.g. PAN).');
                }
            }

            const jData = {
                apkversion: '1.0.0',
                uid: uid,
                pwd: pwd,
                factor2: generatedFactor2,
                vc: vc,
                appkey: appkeyHash,
                imei: 'server_mac_address',
                source: 'API'
            };

            const payload = `jData=${JSON.stringify(jData)}`;

            let response;
            try {
                response = await axios.post(`${this.authEndpoint}/QuickAuth`, payload, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 15000,
                    family: 4
                });
            } catch (err: any) {
                this.lastAuthError = err.response?.data?.emsg || err.message || 'QuickAuth request failed';
                this.logger.error(`QuickAuth failed: ${this.lastAuthError}`);
                return false;
            }

            if (response.data.stat === 'Ok') {
                this.sessionToken = response.data.susertoken;
                this.lastAuthError = null;
                this.logger.log('✅ Shoonya Session Token received via QuickAuth!');
                // Persist token to DB so it can be reused after restart (avoids excessive QuickAuth calls)
                try {
                    const existing = await this.prisma.shoonyaConfig.findFirst();
                    if (existing) {
                        await this.prisma.shoonyaConfig.update({
                            where: { id: existing.id },
                            data: { sessionToken: this.sessionToken! }
                        });
                    }
                } catch (e) {
                    this.logger.warn(`Could not persist session token to DB: ${e.message}`);
                }
                return true;
            } else {
                this.lastAuthError = response.data.emsg || 'Unknown Error';
                this.logger.error(`QuickAuth rejected: ${this.lastAuthError}`);
                return false;
            }

        } catch (error) {
            this.lastAuthError = error.message;
            this.logger.error(`Authentication Protocol Error: ${error.message}`);
            return false;
        }
    }

    /** Debug helper — returns raw SearchScrip values for NFO so we can see the exact tsym format */
    async debugSearchScrip(symbol: string, strike: string): Promise<any> {
        if (!this.sessionToken) await this.authenticate();
        const config = await this.getConfig();
        const jData = { uid: config.uid, stext: `${symbol} ${strike}`, exch: 'NFO' };
        const payload = `jData=${JSON.stringify(jData).replace(/&/g, '\\u0026')}&jKey=${this.sessionToken}`;
        const res = await axios.post(`${this.endpoint}/SearchScrip`, payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000
        });
        return { stat: res.data.stat, count: res.data.values?.length || 0, samples: res.data.values?.slice(0, 10) || [], raw: res.data.emsg };
    }

    /**
     * Find ATM Option Strike based on Action Trigger Price using real SearchScrip
     */
    async findAtmOption(symbol: string, triggerPrice: number, type: 'CE' | 'PE', preferITM: boolean = false): Promise<OptionContract | null> {
        this.logger.debug(`Fetching ${type} Option Chain for ${symbol} near ₹${triggerPrice}`);

        // Custom user configuration for expiry override
        const config = await this.getConfig();
        let targetMonth = config.expiryMonth;
        
        const date = new Date();
        const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

        if (!targetMonth || targetMonth === 'AUTO') {
            // Rollover Logic: If the date is near or past the end of the month (>= 24th), monthly expiry is likely over.
            if (date.getDate() >= 24) {
                date.setMonth(date.getMonth() + 1);
            }
            targetMonth = monthNames[date.getMonth()];
        }
        
        // Use current/forward rolled year for options logic


        // NIFTY 200 Stocks have varying step sizes (Strike Differences). 
        // We use an explicit dictionary for irregular high-volume stocks (like TITAN, LT, VOLTAS)
        // to prevent Shoonya's fuzzy search from returning distant OTM/ITM strikes.
        const NSE_STOCK_STEPS: Record<string, number> = {
            'TITAN': 20,
            'LT': 20,
            'VOLTAS': 20,
            'RELIANCE': 20,
            'INFY': 20,
            'TCS': 50,
            'ADANIENT': 20, // Fixed to 20 based on user confirmation
            'ADANIPORTS': 20,
            'M&M': 20,
            'HDFCBANK': 10,
            'ICICIBANK': 10,
            'SBIN': 5,
            'TATASTEEL': 2.5,
            'ITC': 2.5,
            'DIXON': 100,
            'MARUTI': 100,
            'BAJFINANCE': 100,
            'DRREDDY': 50,
            'ULTRACEMCO': 100,
            'INDIGO': 50,
            'HAL': 50,
            'BOSCHLTD': 500,
            'MRF': 500,
            'PAGEIND': 500,
            'ABB': 100,
            'SIEMENS': 50,
            'TRENT': 50,
            'BAJAJ-AUTO': 50,
            'EICHERMOT': 50,
            'APOLLOHOSP': 50,
            'HEROMOTOCO': 50,
            'DIVISLAB': 50,
            'ASIANPAINT': 20,
            'HINDALCO': 5,
            'JSWSTEEL': 10,
            'TMPV': 5,        // strike step — lot size fetched live from Shoonya match.ls
            'TMCV': 5,        // strike step — lot size fetched live from Shoonya match.ls
            'GMRAIRPORT': 5,  // strike step — lot size fetched live from Shoonya match.ls
            'SUNPHARMA': 10,
            'CIPLA': 10,
            'BHARTIARTL': 10,
            'BAJAJFINSV': 50,
            'KOTAKBANK': 20,
            'HCLTECH': 20,
            'WIPRO': 5,
            'ONGC': 5,
            'NTPC': 5,
            'COALINDIA': 5,
            'POWERGRID': 5,
            'ESCORTS': 50,
            'CUMMINSIND': 50,
            'PERSISTENT': 100,
            'COROMANDEL': 50,
            'COLPAL': 10,
            'GODREJCP': 10,
            'BRITANNIA': 50,
            'HDFCLIFE': 10
        };

        let step = NSE_STOCK_STEPS[symbol];
        if (!step) {
            // Dynamic Generic Fallback for unlisted stocks
            if (triggerPrice > 10000) step = 100;
            else if (triggerPrice > 5000) step = 50;
            else if (triggerPrice > 2000) step = 20;
            else if (triggerPrice > 500) step = 10;
            else if (triggerPrice > 200) step = 5;
            else step = 2.5;
        }

        // Default: OTM bias for breakout strategies (Gann)
        // preferITM: one strike deeper in-the-money for mean-reversion (EMA_5) — better Delta, lower decay
        let atmStrike = 0;
        if (type === 'CE') {
            atmStrike = Math.ceil(triggerPrice / step) * step;
            if (preferITM) atmStrike -= step; // One strike lower = ITM for CE
        } else {
            atmStrike = Math.floor(triggerPrice / step) * step;
            if (preferITM) atmStrike += step; // One strike higher = ITM for PE
        }

        // Search for Symbol + Strike to get that specific strike's options across all months
        const searchQuery = `${symbol} ${atmStrike}`;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                if (!this.sessionToken) await this.authenticate();

                const jData = {
                    uid: config.uid,
                    stext: searchQuery,
                    exch: 'NFO'
                };

                const payload = `jData=${JSON.stringify(jData).replace(/&/g, '\\u0026')}&jKey=${this.sessionToken}`;
                const response = await axios.post(`${this.endpoint}/SearchScrip`, payload, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 8000
                });

                if (response.data.stat === 'Ok' && response.data.values?.length > 0) {
                    const strikeStr = String(atmStrike);

                    // Shoonya NFO symbols can be either:
                    //   RELIANCE26APR261380CE  (strike then CE/PE suffix)
                    //   RELIANCE26APR26C1380   (C/P prefix before strike)
                    // We match both formats: contains targetMonth + contains strike + ends with CE/PE OR contains C/P+strike
                    const match = response.data.values.find((v: any) => {
                        const t = (v.tsym || '').toUpperCase();
                        const hasMonth  = t.includes(targetMonth.toUpperCase());
                        const hasStrike = t.includes(strikeStr);
                        const correctType = type === 'CE'
                            ? (t.endsWith('CE') || t.includes('C' + strikeStr))
                            : (t.endsWith('PE') || t.includes('P' + strikeStr));
                        return hasMonth && hasStrike && correctType;
                    });

                    if (match) {
                        const exchToken = match.token;
                        const tradSymbol = match.tsym;
                        const lotSize = parseInt(match.ls) || 500;

                        this.logger.log(`RESOLVED: ${tradSymbol} | Token: ${exchToken}`);

                        return {
                            strike: atmStrike,
                            type: type,
                            symbol: symbol,
                            token: exchToken,
                            tradingSymbol: tradSymbol,
                            ltp: 0,
                            delta: type === 'CE' ? 0.52 : -0.48,
                            lotSize: lotSize
                        };
                    }
                }
            } catch (error) {
                this.logger.error(`Shoonya Option Query Failed (Attempt ${attempt}/3): ${error.message}`);
                if (attempt < 3) await new Promise(res => setTimeout(res, 1000));
            }

            if (attempt === 3) {
                this.logger.warn(`Could not resolve Option Token for ${searchQuery} even with fuzzy filtering.`);
            }
        }

        return null;
    }

    /**
     * Fetch Live Option Premium (LTP) by Exchange Token from Shoonya
     */
    async getOptionQuote(token: string): Promise<{ ltp: number, askPrice: number, bidPrice: number } | null> {
        // If it's a Dummy Token, fallback mathematically
        if (token.includes('Dummy') || isNaN(Number(token))) return null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                if (!this.sessionToken) await this.authenticate();
                
                const config = await this.getConfig();

                const jData = {
                    uid: config.uid,
                    exch: 'NFO',
                    token: token
                };

                const payload = `jData=${JSON.stringify(jData)}&jKey=${this.sessionToken}`;
                const response = await axios.post(`${this.endpoint}/GetQuotes`, payload, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 8000
                });

                if (response.data.stat === 'Not_Ok' && response.data.emsg?.toLowerCase().includes('session')) {
                    this.logger.warn('Shoonya Session Expired. Clearing token and forcing re-auth...');
                    this.sessionToken = null;
                    continue; // Loop will re-auth on next attempt
                }

                if (response.data.stat === 'Ok' && response.data.lp) {
                    const bestSellPrice = response.data.sp1 ? parseFloat(response.data.sp1) : parseFloat(response.data.lp);
                    const bestBuyPrice = response.data.bp1 ? parseFloat(response.data.bp1) : parseFloat(response.data.lp);
                    return {
                        ltp: parseFloat(response.data.lp),
                        askPrice: bestSellPrice > 0 ? bestSellPrice : parseFloat(response.data.lp),
                        bidPrice: bestBuyPrice > 0 ? bestBuyPrice : parseFloat(response.data.lp)
                    };
                }

                if (attempt === 3) {
                    return null;
                }
            } catch (error) {
                this.logger.debug(`Failed to fetch Option Quote for Token ${token} (Attempt ${attempt}/3): ${error.message}`);
                if (attempt < 3) await new Promise(res => setTimeout(res, 1000));
            }
        }
        return null;
    }

    /**
     * Fetch Time Price Series (TPS) / Historical Candles from Shoonya
     * Interval: 1, 3, 5, 10, 15, 30, 60, 120, 240, D
     */
    async getTimePriceSeries(exchange: string, token: string, interval: string, daysLimit = 2, retry = true): Promise<any[]> {
        try {
            if (!this.sessionToken) await this.authenticate();
            const config = await this.getConfig();

            // End time is now, start time is X days ago
            const endTime = new Date();
            const startTime = new Date();
            startTime.setDate(startTime.getDate() - daysLimit);

            const jData = {
                uid: config.uid,
                exch: exchange,
                token: token,
                st: Math.floor(startTime.getTime() / 1000).toString(), // Unix timestamp in seconds
                et: Math.floor(endTime.getTime() / 1000).toString(),
                intrv: interval
            };

            const payload = `jData=${JSON.stringify(jData)}&jKey=${this.sessionToken}`;
            const response = await axios.post(`${this.endpoint}/TPSeries`, payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 8000
            });

            if (Array.isArray(response.data)) {
                return response.data; // Shoonya returns candles: {ssboe, time, into, inth, intl, intc, intv, ...}
            }

            // Shoonya may return 401 as JSON stat instead of HTTP 401
            const emsg = response.data?.emsg || '';
            const isSessionErr = response.data?.stat === 'Not_Ok' &&
                (emsg.toLowerCase().includes('session') || emsg.toLowerCase().includes('invalid'));

            if (isSessionErr && retry && !this.sessionClearInProgress) {
                this.sessionClearInProgress = true;
                this.logger.warn(`Session expired on TPSeries (JSON). Reloading token from DB...`);
                this.sessionToken = null;
                const reauthed = await this.authenticate(); // Loads from DB or QuickAuth
                this.sessionClearInProgress = false;
                if (reauthed) return this.getTimePriceSeries(exchange, token, interval, daysLimit, false);
                return [];
            }

            if (response.data.stat !== 'Ok') {
                this.logger.warn(`TPS Query returned non-Ok status for token ${token}: ${emsg || 'Unknown error'}`);
            }

            return [];
        } catch (error) {
            const responseData = error.response?.data;
            const isSessionExpired =
                error.response?.status === 401 ||
                (responseData?.emsg && responseData.emsg.toLowerCase().includes('session'));

            if (isSessionExpired && retry && !this.sessionClearInProgress) {
                this.sessionClearInProgress = true;
                this.logger.warn(`Session expired (401) on TPSeries. Reloading token from DB...`);
                this.sessionToken = null;
                const reauthed = await this.authenticate(); // Loads from DB or QuickAuth
                this.sessionClearInProgress = false;
                if (reauthed) return this.getTimePriceSeries(exchange, token, interval, daysLimit, false);
                return [];
            }

            if (isSessionExpired && retry && this.sessionClearInProgress) return [];

            this.logger.error(`Shoonya TPS Error: ${error.message}`);
            return [];
        }
    }

    /**
     * Resolve Symbol Name to Security Token Cache / Helper
     */
    async searchSecurityToken(symbol: string, exch = 'NSE', retry = true): Promise<string | null> {
        try {
            if (!this.sessionToken) await this.authenticate();
            const config = await this.getConfig();

            const jData = {
                uid: config.uid,
                stext: symbol,
                exch: exch
            };

            const payload = `jData=${JSON.stringify(jData).replace(/&/g, '\\u0026')}&jKey=${this.sessionToken}`;
            const response = await axios.post(`${this.endpoint}/SearchScrip`, payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 8000
            });

            if (response.data.stat === 'Ok' && response.data.values?.length > 0) {
                // Find exact match or first result
                const match = response.data.values.find((v: any) => v.tsym === symbol || v.tsym === `${symbol}-EQ`);
                return match ? match.token : response.data.values[0].token;
            }
            return null;
        } catch (error) {
            const responseData = error.response?.data;
            const isSessionExpired =
                error.response?.status === 401 ||
                (responseData?.emsg && responseData.emsg.toLowerCase().includes('session'));

            // Session expired — use OAuth auto-connect (not QuickAuth which may be broken).
            // Rate-limited: only one autoConnect attempt per 3 minutes to prevent cascading loops
            // when the whole token batch fails simultaneously.
            const nowMs = Date.now();
            const autoConnectCooldownMs = 3 * 60 * 1000; // 3 minutes
            if (isSessionExpired && retry && !this.sessionClearInProgress &&
                nowMs - this.lastAutoConnectMs > autoConnectCooldownMs) {
                this.sessionClearInProgress = true;
                this.lastAutoConnectMs = nowMs;
                this.logger.warn(`Session expired (401) on SearchScrip [${symbol}]. Attempting OAuth auto-connect...`);
                const savedToken = this.sessionToken;
                this.sessionToken = null; // force autoConnect to fetch fresh
                const result = await this.autoConnect();
                this.sessionClearInProgress = false;
                if (result.success) {
                    this.logger.log(`Re-auth via autoConnect succeeded. Retrying SearchScrip for ${symbol}...`);
                    return this.searchSecurityToken(symbol, exch, false);
                }
                // autoConnect also failed — restore the old token so other APIs aren't broken
                this.logger.error(`autoConnect re-auth failed: ${result.message}. Restoring previous token.`);
                this.sessionToken = savedToken;
                return null;
            }

            // Cooldown active or another concurrent call is handling re-auth — skip this symbol
            if (isSessionExpired && retry) return null;

            const body = JSON.stringify(responseData || error.response?.status || error.message);
            this.logger.error(`Symbol Resolution Error [${symbol}]: ${error.message} | Body: ${body}`);
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WebSocket Tick Feed
    //
    // Shoonya WS protocol summary:
    //   Connect → send {"t":"c", uid, actid, susertoken, source:"API"}
    //   Ack     ← {"t":"ck"}  → subscribe pending tokens
    //   Sub     → {"t":"t", "k":"NSE|token1#NSE|token2"}
    //   Tick    ← {"t":"tf"|"dk", "e":"NSE", "tk":"token", "lp":"price", ...}
    //   Disc    → close() + schedule reconnect
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Open a persistent WebSocket connection to the Shoonya tick feed.
     * Safe to call when already connected (no-op). Re-subscribes all known
     * tokens automatically on every reconnect.
     */
    async connectTickFeed(): Promise<void> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        if (!this.sessionToken) await this.authenticate();

        this.wsShouldRun = true;
        const config = await this.getConfig();
        const wsUrl = process.env.SHOONYA_WS_URL || 'wss://trade.shoonya.com/NorenWSTP/';
        this.logger.log(`[WS] Connecting to Shoonya tick feed: ${wsUrl}`);

        const socket = new WebSocket(wsUrl);
        this.ws = socket;

        socket.on('open', () => {
            this.logger.log('[WS] Connected. Sending handshake...');
            socket.send(JSON.stringify({
                t: 'c', uid: config.uid, actid: config.uid,
                susertoken: this.sessionToken, source: 'API'
            }));
            // Send a WS-level ping every 30s to keep the connection alive
            this.wsHeartbeatTimer = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) socket.ping();
            }, 30000);
        });

        socket.on('message', (data: WebSocket.RawData) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.t === 'ck') {
                    if (msg.s === 'Not_Ok') {
                        this.logger.error(`[WS] Handshake REJECTED: ${msg.emsg || JSON.stringify(msg)}`);
                        socket.close();
                        return;
                    }
                    // Handshake acknowledged — re-send all subscriptions
                    this.logger.log(`[WS] Handshake OK. Re-subscribing ${this.subscribedKeys.size} token(s).`);
                    if (this.subscribedKeys.size > 0) {
                        socket.send(JSON.stringify({ t: 't', k: Array.from(this.subscribedKeys).join('#') }));
                    }
                } else if (msg.t === 'tk' || msg.t === 'tf' || msg.t === 'dk') {
                    // tk = initial full tick on subscribe, tf = subsequent changed fields, dk = depth
                    if (msg.tk && msg.lp) {
                        this.tickCache.set(msg.tk, parseFloat(msg.lp));
                    }
                }
            } catch { /* ignore malformed frames */ }
        });

        socket.on('close', (code: number) => {
            this.logger.warn(`[WS] Disconnected (code ${code}). ${this.wsShouldRun ? 'Reconnecting in 5s…' : 'Closed permanently.'}`);
            if (this.wsHeartbeatTimer) { clearInterval(this.wsHeartbeatTimer); this.wsHeartbeatTimer = null; }
            this.ws = null;
            if (this.wsShouldRun) this.scheduleWsReconnect();
        });

        socket.on('error', () => {
            this.logger.error('[WS] Connection error — closing socket.');
            socket.close();
        });
    }

    private scheduleWsReconnect(): void {
        if (this.wsReconnectTimer) return;
        this.wsReconnectTimer = setTimeout(async () => {
            this.wsReconnectTimer = null;
            await this.connectTickFeed();
        }, 5000);
    }

    /**
     * Subscribe tokens to the live tick feed.
     * Keys are buffered in `subscribedKeys` so they are re-sent automatically
     * after every reconnect — safe to call before the connection is open.
     */
    subscribeTokens(exchange: string, tokens: string[]): void {
        tokens.forEach(t => this.subscribedKeys.add(`${exchange}|${t}`));
        if (this.ws?.readyState === WebSocket.OPEN) {
            const k = tokens.map(t => `${exchange}|${t}`).join('#');
            this.ws.send(JSON.stringify({ t: 't', k }));
            this.logger.log(`[WS] Subscribed ${tokens.length} token(s) (total subscribed: ${this.subscribedKeys.size}).`);
        }
    }

    /** Returns the latest WS tick LTP for a token, or null if not yet received */
    getTickPrice(token: string): number | null {
        return this.tickCache.get(token) ?? null;
    }

    /** Close WS, clear tick cache, and cancel pending reconnect (e.g. EOD) */
    disconnectTickFeed(): void {
        this.wsShouldRun = false;
        if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null; }
        if (this.wsHeartbeatTimer) { clearInterval(this.wsHeartbeatTimer); this.wsHeartbeatTimer = null; }
        this.ws?.close();
        this.ws = null;
        this.tickCache.clear();
        this.subscribedKeys.clear();
        this.logger.log('[WS] Tick feed disconnected and cache cleared.');
    }

    /** EOD cleanup: disconnect feed at 3:30 PM IST so tokens don't carry over to next day */
    @Cron('30 15 * * 1-5', { timeZone: 'Asia/Kolkata' })
    eodTickFeedCleanup(): void {
        this.disconnectTickFeed();
    }

    /**
     * Fetch Quotes for many tokens — calls GetQuotes individually in parallel batches.
     * The NorenWClient endpoint does not support comma-separated multi-token queries.
     */
    async getMultiQuotes(exchange: string, tokens: string[]): Promise<any[]> {
        if (!this.sessionToken) await this.authenticate();
        const config = await this.getConfig();
        const results: any[] = [];

        // Process in batches of 10 to stay within TPS limits
        for (let i = 0; i < tokens.length; i += 10) {
            const batch = tokens.slice(i, i + 10);
            const batchResults = await Promise.all(batch.map(async (token) => {
                try {
                    const jData = { uid: config.uid, exch: exchange, token };
                    const payload = `jData=${JSON.stringify(jData)}&jKey=${this.sessionToken}`;
                    const response = await axios.post(`${this.endpoint}/GetQuotes`, payload, {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        timeout: 5000
                    });
                    if (response.data.stat === 'Ok' && response.data.lp) {
                        return response.data;
                    }
                    // Session expired — re-authenticate and retry once
                    if (response.data.emsg?.includes('Session Expired') || response.data.stat === 'Not_Ok') {
                        this.logger.warn(`[GetQuotes] Session expired for token ${token}. Re-authenticating...`);
                        this.sessionToken = null;
                        await this.autoConnect();
                        if (!this.sessionToken) return null;
                        const retryPayload = `jData=${JSON.stringify({ uid: config.uid, exch: exchange, token })}&jKey=${this.sessionToken}`;
                        const retry = await axios.post(`${this.endpoint}/GetQuotes`, retryPayload, {
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            timeout: 5000
                        });
                        return (retry.data.stat === 'Ok' && retry.data.lp) ? retry.data : null;
                    }
                    return null;
                } catch (err: any) {
                    if (err.response?.status === 401) {
                        this.logger.warn(`[GetQuotes] 401 for token ${token}. Re-authenticating...`);
                        this.sessionToken = null;
                        await this.autoConnect();
                    }
                    return null;
                }
            }));
            results.push(...batchResults.filter(Boolean));
            if (i + 10 < tokens.length) await new Promise(res => setTimeout(res, 200));
        }

        return results;
    }

    /**
     * Execute Buy Order at Finvasia API
     */
    async placeOrder(token: string, quantity: number, price: number, type?: 'CE' | 'PE'): Promise<any> {
        if (!this.sessionToken) await this.authenticate();

        // ── Market-on-Limit: add 0.5% slippage allowance to guarantee fill ────
        // CE (buy call): bid up 0.5% above ask so we don't miss illiquid fills
        // PE (buy put) : bid down 0.5% below ask (puts invert momentum direction)
        // Unknown/no type: use raw ask price as before
        const limitPrice = price > 0 && type
            ? parseFloat((type === 'CE' ? price * 1.005 : price * 0.995).toFixed(2))
            : price;

        this.logger.log(
            `Placing Live BUY Order for Token [${token}] | Qty [${quantity}] | Ask=${price} → LimitPrice=${limitPrice} (type=${type ?? 'raw'})`
        );

        try {
            const config = await this.getConfig();
            const jData = {
                uid: config.uid,
                actid: config.uid,
                exch: 'NFO', // Options Exchange
                tsym: token,
                qty: quantity.toString(),
                prc: limitPrice > 0 ? limitPrice.toString() : '0',
                prd: 'M', // Margin (M) / Normal Product / MIS (I)
                trantype: 'B', // Buy
                prctyp: limitPrice > 0 ? 'LMT' : 'MKT', // Always Limit when price available
                ret: 'DAY'
            };

            const payload = `jData=${JSON.stringify(jData)}&jKey=${this.sessionToken}`;
            const response = await axios.post(`${this.endpoint}/PlaceOrder`, payload, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            if (response.data.stat === 'Not_Ok' && response.data.emsg?.toLowerCase().includes('session')) {
                this.sessionToken = null;
                await this.authenticate();
                return this.placeOrder(token, quantity, price, type); // Recurse once
            }

            if (response.data.stat === 'Ok') {
                this.logger.log(`✅ Order Successfully Placed in Live Market! Shoonya ID: ${response.data.norenordno}`);
                return {
                    orderId: response.data.norenordno,
                    status: 'OPEN',
                    message: response.data.request_time
                };
            } else {
                throw new Error(response.data.emsg);
            }

        } catch (error) {
            this.logger.error(`Shoonya PlaceOrder API Failed: ${error.message}`);
            throw error;
        }
    }
}
