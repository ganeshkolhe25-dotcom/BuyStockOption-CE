const axios = require('axios');
const { TOTP } = require('totp-generator');
const crypto = require('crypto');

async function test() {
    try {
        const u = "FA210606";
        const p = crypto.createHash('sha256').update('AntiGravity@123').digest('hex');
        const f2 = TOTP.generate('6P4K37OKDYZJ7EYG47L4J4LYB4E3K22D').otp;

        const payload = `jData=${JSON.stringify({
            uid: u,
            pwd: p,
            factor2: f2,
            vc: "FA210606_U",
            appkey: "e2b4cb1c33a25ef1eb9d846c483a90da",
            imei: "abc1234"
        })}`;

        const auth = await axios.post('https://api.shoonya.com/NorenWClientTP/QuickAuth', payload);
        const token = auth.data.susertoken;

        const sq = "TITAN MAR CE";
        const sp = `jData=${JSON.stringify({ uid: u, stext: sq, exch: 'NFO' })}&jKey=${token}`;
        const search = await axios.post('https://api.shoonya.com/NorenWClientTP/SearchScrip', sp);

        console.log(search.data.values.map(v => v.tsym).slice(0, 30));
    } catch (e) {
        console.error(e.message);
    }
}
test();
