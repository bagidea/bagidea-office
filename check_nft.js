const d = require('./nft.json');
const flat = JSON.stringify(d);
const a = Array.isArray(d) ? d : (d.assets || d.data || d.result || d.rows || []);
console.log('top keys:', Object.keys(d).slice(0,10));
console.log('count:', Array.isArray(a) ? a.length : 'n/a');
const urls = [...flat.matchAll(/https?:\/\/[^"\\]+/g)].map(m => m[0]).filter(u => /ipfs|atomichub|resizer/.test(u));
console.log('media urls:');
[...new Set(urls)].slice(0, 8).forEach(u => console.log('  ', u));
// detect garbage: control chars in url-ish strings
console.log('has 0x12 control byte in payload:', //.test(flat));
console.log('Qm CIDs found:', (flat.match(/Qm[1-9A-HJ-NP-Za-km-z]{44}/g) || []).length);
