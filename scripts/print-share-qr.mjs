import QRCode from 'qrcode';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/print-share-qr.mjs <url>');
  process.exit(1);
}

const qr = await QRCode.toString(url, { type: 'terminal', small: true });
console.log('');
console.log('Open this on your phone:');
console.log(url);
console.log(qr);
