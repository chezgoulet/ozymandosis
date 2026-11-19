// Does Chromium still hide local IPs behind mDNS with the flag the harness passes?
// If the feature name changed, `--disable-features=...` is silently ignored, the ICE
// candidates come out as .local hostnames, and loopback peer setup on a bare runner has
// to wait for mDNS that nothing answers.
const { chromium } = require('playwright');

const probe = async (args, label) => {
  const b = await chromium.launch({ args });
  const p = await b.newPage();
  const out = await p.evaluate(async () => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('x');
    const got = [];
    pc.onicecandidate = e => { if (e.candidate) got.push(e.candidate.candidate); };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(r => setTimeout(r, 3000));
    pc.close();
    return got;
  });
  console.log(`\n[${label}] candidates=${out.length}`);
  out.slice(0, 6).forEach(c => console.log('  ' + c));
  console.log('  mDNS hosts:', out.filter(c => /\.local/.test(c)).length, '/ raw IPs:', out.filter(c => /typ host/.test(c) && !/\.local/.test(c)).length);
  await b.close();
};

(async () => {
  await probe([], 'no flags');
  await probe(['--disable-features=WebRtcHideLocalIpsWithMdns'], 'with the harness flag');
})().catch(e => { console.error(e); process.exit(1); });
