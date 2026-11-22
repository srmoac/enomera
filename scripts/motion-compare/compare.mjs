import fs from 'node:fs';
const load = (vp, n) => JSON.parse(fs.readFileSync(`vid/${vp}-${n}/meta.json`));
function cmp(c, r) { const res = {};
  // log time base: log t0 ≈ first mark; use marks relative to first mark, per-segment re-zero
  const segs = m => m.marks.map(([n, at], i) => [n, at - m.marks[0][1], (m.marks[i + 1]?.[1] ?? Infinity) - m.marks[0][1]]);
  const cs = segs(c), rs = segs(r);
  cs.forEach(([n, a, bEnd], i) => { const [, ra, rb] = rs[i]; const C = c.log.filter(s => s[0] >= a && s[0] < bEnd), R = r.log.filter(s => s[0] >= ra && s[0] < rb); let j = 0, mx = 0, mxS = 0;
    for (const s of C) { const t = s[0] - a; while (j < R.length - 1 && Math.abs(R[j + 1][0] - ra - t) <= Math.abs(R[j][0] - ra - t)) j++; const q = R[j]; if (!q) continue; let d = 0; for (let k = 2; k < s.length; k++) d = Math.max(d, Math.abs(s[k] - q[k])); mx = Math.max(mx, d); mxS = Math.max(mxS, Math.abs(s[1] - q[1])); }
    res[n] = [mx, mxS]; }); return res; }
for (const vp of ['d1440', 'm390']) { const a = cmp(load(vp, 'cur'), load(vp, 'ref')), b = cmp(load(vp, 'ref2'), load(vp, 'ref')); console.log(vp, '[max petal px, max scroll px]  preview-vs-ref | ref-vs-ref (ruído)'); for (const k of Object.keys(a)) console.log('  ', k.padEnd(26), JSON.stringify(a[k]).padEnd(12), JSON.stringify(b[k])); }
