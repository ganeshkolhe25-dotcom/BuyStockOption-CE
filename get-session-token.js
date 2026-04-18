/**
 * Run this on your LOCAL machine (not GCP) to get a Shoonya session token.
 *
 * Steps:
 *  1. Open this URL in your browser and log in:
 *     https://trade.shoonya.com/OAuthlogin/investor-entry-level/login?api_key=FN140579_U&route_to=FN140579
 *
 *  2. After login, the browser redirects to:
 *     https://trade.shoonya.com/OAuthlogin/authorize/oauth?code=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 *     Copy the `code` value from the URL.
 *
 *  3. Paste it below as AUTH_CODE and run:
 *     node get-session-token.js
 *
 *  4. Copy the printed SESSION_TOKEN and POST it to the backend:
 *     curl -X POST http://35.200.239.116:3001/shoonya-set-session -H "Content-Type: application/json" -d "{\"sessionToken\":\"PASTE_TOKEN_HERE\"}"
 */

const crypto = require('crypto');
const https = require('https');

const AUTH_CODE   = 'PASTE_AUTH_CODE_HERE';   // <-- paste the code from the redirect URL
const UID         = 'FN140579';
const SECRET_CODE = 'Gg2Liz24IyD3qIN1Q63oa5anQa61aN611GI2IXF5KxEQLRRebxAzzidYGd2bbzga';
const APPKEY      = '978735eeca80f28216b2911aedb5aafc';

if (AUTH_CODE === 'PASTE_AUTH_CODE_HERE') {
  console.error('ERROR: Please paste your auth code into AUTH_CODE before running.');
  process.exit(1);
}

// Try checksum variants in order — one of these will match Shoonya's expected format
const hashedAppkey = crypto.createHash('sha256').update(`${UID}|${APPKEY}`).digest('hex');
const variants = [
  [crypto.createHash('sha256').update(`${SECRET_CODE}${AUTH_CODE}`).digest('hex'),        'secret_code+code'],
  [crypto.createHash('sha256').update(`${SECRET_CODE}|${AUTH_CODE}`).digest('hex'),       'secret_code|code'],
  [crypto.createHash('sha256').update(`${hashedAppkey}${AUTH_CODE}`).digest('hex'),       'sha256(uid|appkey)+code'],
  [crypto.createHash('sha256').update(`${hashedAppkey}|${AUTH_CODE}`).digest('hex'),      'sha256(uid|appkey)|code'],
  [crypto.createHash('sha256').update(`${APPKEY}${AUTH_CODE}`).digest('hex'),             'appkey+code'],
  [crypto.createHash('sha256').update(`${UID}|${APPKEY}|${AUTH_CODE}`).digest('hex'),     'uid|appkey|code'],
  [crypto.createHash('sha256').update(`${AUTH_CODE}|${APPKEY}`).digest('hex'),            'code|appkey'],
];

function postGenAcsTok(checksum, label) {
  return new Promise((resolve) => {
    const jData = JSON.stringify({ uid: UID, code: AUTH_CODE, checksum });
    const body = `jData=${jData}`;
    const req = https.request({
      hostname: 'trade.shoonya.com',
      path: '/NorenWClientAPI/GenAcsTok',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`[${label}] => ${json.stat} | ${json.susertoken ? 'TOKEN: ' + json.susertoken : json.emsg}`);
          resolve(json.stat === 'Ok' ? json.susertoken : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log(`\nTrying ${variants.length} checksum variants for auth code: ${AUTH_CODE.slice(0, 8)}...\n`);
  for (const [checksum, label] of variants) {
    const token = await postGenAcsTok(checksum, label);
    if (token) {
      console.log(`\n✅ SUCCESS with [${label}]`);
      console.log(`\nSESSION_TOKEN: ${token}`);
      console.log(`\nNow run this command to inject it into the backend:`);
      console.log(`curl -X POST http://35.200.239.116:3001/shoonya-set-session -H "Content-Type: application/json" -d "{\\"sessionToken\\":\\"${token}\\"}"`);
      process.exit(0);
    }
  }
  console.log('\n❌ All variants failed. IP may not be whitelisted on your machine either.');
  console.log('Contact Shoonya support to whitelist IP or wait for propagation.');
})();
