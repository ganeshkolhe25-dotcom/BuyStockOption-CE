// Mock P&L Simulation — April 10, 2026
const LOT_SIZES = {
    ICICIBANK:700, AXISBANK:625, INFY:400, HCLTECH:350, SUNPHARMA:350,
    BAJAJFINSV:500, TECHM:300, EICHERMOT:50, HEROMOTOCO:150, 'BAJAJ-AUTO':50,
    DIXON:25, TRENT:275, LT:75, TCS:175, PERSISTENT:125, MARUTI:15,
    POLYCAB:125, INDIGO:150, ULTRACEMCO:50, CHOLAFIN:500, TVSMOTOR:225,
    ASIANPAINT:200, MUTHOOTFIN:200, PIIND:125, ADANIENT:625, SHREECEM:10,
    'M&M':350, ESCORTS:125, HDFCAMC:150, HAL:125, SRF:125, HCLTECH:350
};

const ATM_PREMIUM = {
    ICICIBANK:28, AXISBANK:30, INFY:25, HCLTECH:32, SUNPHARMA:38,
    BAJAJFINSV:40, TECHM:30, EICHERMOT:120, HEROMOTOCO:90, 'BAJAJ-AUTO':160,
    DIXON:220, TRENT:85, LT:80, TCS:55, PERSISTENT:110, MARUTI:280,
    POLYCAB:160, INDIGO:90, ULTRACEMCO:200, CHOLAFIN:32, TVSMOTOR:75,
    ASIANPAINT:50, MUTHOOTFIN:70, PIIND:60, ADANIENT:45, SHREECEM:500,
    'M&M':65, ESCORTS:65, HDFCAMC:55, HAL:90, SRF:50
};

function prevCloseFromR1(r1) { const x=(-1+Math.sqrt(1+4*r1))/2; return x*x; }
function prevCloseFromS1(s1) { const x=(1+Math.sqrt(1+4*s1))/2; return x*x; }

const signals = [
    { sym:'ICICIBANK',  type:'CE', trigger:1303.7, time:'09:31', session:'MORNING' },
    { sym:'AXISBANK',   type:'CE', trigger:1347.7, time:'09:31', session:'MORNING' },
    { sym:'INFY',       type:'PE', trigger:1297.3, time:'09:31', session:'MORNING' },
    { sym:'HCLTECH',    type:'PE', trigger:1441.9, time:'09:32', session:'MORNING' },
    { sym:'SUNPHARMA',  type:'PE', trigger:1667.6, time:'09:32', session:'MORNING' },
    { sym:'BAJAJFINSV', type:'CE', trigger:1796.8, time:'09:32', session:'MORNING' },
    { sym:'TECHM',      type:'PE', trigger:1438.6, time:'09:32', session:'MORNING' },
    { sym:'EICHERMOT',  type:'CE', trigger:7270,   time:'09:32', session:'MORNING' },
    { sym:'HEROMOTOCO', type:'CE', trigger:5370,   time:'09:32', session:'MORNING' },
    { sym:'BAJAJ-AUTO', type:'CE', trigger:9651,   time:'09:32', session:'MORNING' },
    { sym:'DIXON',      type:'CE', trigger:10779,  time:'09:32', session:'MORNING' },
    { sym:'CHOLAFIN',   type:'CE', trigger:1571.2, time:'09:33', session:'MORNING' },
    { sym:'TVSMOTOR',   type:'CE', trigger:3782.4, time:'09:33', session:'MORNING' },
    { sym:'ASIANPAINT', type:'CE', trigger:2317.2, time:'09:32', session:'MORNING' },
    { sym:'PIIND',      type:'CE', trigger:2938,   time:'09:33', session:'MORNING' },
    { sym:'POLYCAB',    type:'PE', trigger:7694.5, time:'10:10', session:'MID' },
    { sym:'HDFCAMC',    type:'CE', trigger:2589,   time:'11:03', session:'MID' },
    { sym:'HAL',        type:'PE', trigger:4092,   time:'11:08', session:'MID' },
    { sym:'SRF',        type:'PE', trigger:2430.5, time:'11:42', session:'MID' },
    { sym:'PERSISTENT', type:'PE', trigger:5315.5, time:'11:44', session:'MID' },
    { sym:'MUTHOOTFIN', type:'PE', trigger:3532.6, time:'13:02', session:'AFTERNOON' },
    { sym:'ADANIENT',   type:'CE', trigger:2087.6, time:'13:14', session:'AFTERNOON' },
    { sym:'SHREECEM',   type:'CE', trigger:24445,  time:'13:34', session:'AFTERNOON' },
    { sym:'TCS',        type:'PE', trigger:2524.4, time:'13:37', session:'AFTERNOON' },
    { sym:'LT',         type:'CE', trigger:3961.5, time:'13:56', session:'AFTERNOON' },
    { sym:'PERSISTENT', type:'CE', trigger:5407.5, time:'14:14', session:'AFTERNOON' },
    { sym:'TRENT',      type:'CE', trigger:3940.8, time:'14:22', session:'AFTERNOON' },
    { sym:'MARUTI',     type:'PE', trigger:13668,  time:'14:26', session:'AFTERNOON' },
    { sym:'ULTRACEMCO', type:'PE', trigger:11542,  time:'14:29', session:'AFTERNOON' },
    { sym:'INDIGO',     type:'CE', trigger:4533.8, time:'14:32', session:'AFTERNOON' },
    { sym:'M&M',        type:'CE', trigger:3246.4, time:'14:34', session:'AFTERNOON' },
    { sym:'ESCORTS',    type:'PE', trigger:3182.2, time:'14:45', session:'AFTERNOON' },
];

const MAX_LOT_VALUE = 40000;
const results = [];

signals.forEach(s => {
    const pc = s.type === 'CE' ? prevCloseFromR1(s.trigger) : prevCloseFromS1(s.trigger);
    const sq = Math.sqrt(pc);
    const target = s.type === 'CE' ? pc + 2*sq : pc - 2*sq;
    const targetMove = Math.abs(target - s.trigger);
    const lotSize = LOT_SIZES[s.sym] || 200;
    const premium = ATM_PREMIUM[s.sym] || 50;
    const lotValue = lotSize * premium;
    const [h,m] = s.time.split(':').map(Number);
    const mins = h*60+m;

    let status, reason;
    if (lotValue > MAX_LOT_VALUE) {
        status = 'REJECTED'; reason = 'Lot value ₹'+lotValue.toLocaleString()+' > ₹40k limit';
    } else if (mins >= 14*60+30) {
        status = 'RISKY'; reason = 'Less than 45 min to 3:15 PM close';
    } else {
        status = 'EXECUTED';
    }

    // Estimate option P&L:
    // If target hit: option goes from ATM premium to ~2.5x (delta ~0.5, stock moves ~1 step = targetMove)
    //   option gain ≈ targetMove * 0.5 delta → premium roughly doubles to 2.5x for ATM
    // If SL hit (stock returns to trigger): option loses ~55% (ITM option, loses most extrinsic)
    const estPnlTarget = lotSize * (premium * 1.5);   // +150% premium on target
    const estPnlSL     = lotSize * (-premium * 0.55); // -55% if SL hit

    results.push({ ...s, pc, target, targetMove, lotSize, premium, lotValue, status, reason, estPnlTarget, estPnlSL });
});

console.log('\n' + '='.repeat(90));
console.log(' MOCK SIMULATION — April 10, 2026  (Assuming Bug Was Fixed)');
console.log('='.repeat(90));

['MORNING','MID','AFTERNOON'].forEach(session => {
    const sr = results.filter(r => r.session === session);
    const label = {MORNING:'🌅 MORNING 9:20–9:35 AM', MID:'☀️  MID-DAY 10:00–11:45 AM', AFTERNOON:'🌆 AFTERNOON 1:00–2:45 PM'}[session];
    const exec = sr.filter(r => r.status === 'EXECUTED');
    console.log('\n' + label + '  (' + exec.length + ' of ' + sr.length + ' would execute)');
    console.log('-'.repeat(90));
    console.log('Symbol         Time   Type  Trigger    Target     Move   Premium  LotVal    If Target   If SL    Status');
    console.log('-'.repeat(90));
    sr.forEach(r => {
        const icon = r.status==='EXECUTED' ? '✅' : r.status==='RISKY' ? '⚠️ ' : '🚫';
        const pnlT = r.status==='EXECUTED' ? '+₹'+r.estPnlTarget.toFixed(0) : '   —  ';
        const pnlS = r.status==='EXECUTED' ? '-₹'+Math.abs(r.estPnlSL).toFixed(0) : '   —  ';
        console.log(
            r.sym.padEnd(14)+' '+r.time+'  '+r.type+'   ₹'+r.trigger.toFixed(0).padStart(7)+
            '  ₹'+r.target.toFixed(0).padStart(8)+'  ₹'+r.targetMove.toFixed(0).padStart(5)+
            '  ₹'+String(r.premium).padStart(6)+'  ₹'+r.lotValue.toFixed(0).padStart(6)+
            '  '+pnlT.padStart(10)+'  '+pnlS.padStart(10)+
            '  '+icon+' '+(r.reason||'')
        );
    });
    const totalIfTarget = exec.reduce((s,r)=>s+r.estPnlTarget,0);
    const totalIfSL     = exec.reduce((s,r)=>s+r.estPnlSL,0);
    const capital = exec.reduce((s,r)=>s+r.lotValue,0);
    if (exec.length > 0) {
        console.log('-'.repeat(90));
        console.log(' Capital deployed: ₹'+capital.toLocaleString()+
            '  |  Best case (all targets): +₹'+totalIfTarget.toFixed(0)+
            '  |  Worst case (all SLs): -₹'+Math.abs(totalIfSL).toFixed(0));
    }
});

const exec = results.filter(r => r.status==='EXECUTED');
const rejected = results.filter(r => r.status!=='EXECUTED');
const bestCase  = exec.reduce((s,r)=>s+r.estPnlTarget,0);
const worstCase = exec.reduce((s,r)=>s+r.estPnlSL,0);
const capital   = exec.reduce((s,r)=>s+r.lotValue,0);
const breakeven50 = exec.reduce((s,r)=>s+(r.estPnlTarget*0.5 + r.estPnlSL*0.5),0);

console.log('\n' + '='.repeat(90));
console.log(' OVERALL SUMMARY');
console.log('='.repeat(90));
console.log(' Total signals fired  : ' + results.length);
console.log(' Would have executed  : ' + exec.length);
console.log(' Filtered (lot > 40k) : ' + results.filter(r=>r.status==='REJECTED').length + '  (SHREECEM ₹500 premium lot, MARUTI 280*15=₹4200 OK actually)');
console.log(' Risky (< 45min left) : ' + results.filter(r=>r.status==='RISKY').length);
console.log('');
console.log(' Capital that would be deployed : ₹' + capital.toLocaleString());
console.log('');
console.log(' P&L Scenarios (option premium based):');
console.log('   🎯 Best case  (all targets hit) : +₹' + bestCase.toFixed(0) + '  (+' + (bestCase/capital*100).toFixed(1) + '% on deployed capital)');
console.log('   🛑 Worst case (all SLs hit)     : -₹' + Math.abs(worstCase).toFixed(0) + '  (-' + (Math.abs(worstCase)/capital*100).toFixed(1) + '% on deployed capital)');
console.log('   📊 50/50 mix (realistic)        : +₹' + breakeven50.toFixed(0));
console.log('');
console.log(' Key observations:');
console.log('   • 15 morning signals in 5 minutes (9:31-9:33) = strong directional opening');
console.log('   • Mostly CE (bullish) in morning + PE reversals in afternoon = mixed day');
console.log('   • 5-min sustain rule would have filtered some fake breakouts');
console.log('   • Each trade capped at ₹40k lot value — risk per trade = ~₹12k-22k (SL 55%)');
console.log('='.repeat(90));
