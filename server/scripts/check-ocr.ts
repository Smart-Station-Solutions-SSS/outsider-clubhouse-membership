import fs from 'fs';
import path from 'path';
import { config } from '../src/config';
import { gatesOcrReader } from '../src/lib/ocr';

// Usage: npm run ocr:check -- <path/to/id-card-photo.jpg>
// Sends one photo to the gates OCR server with the configured key and prints the outcome.
// The key is never printed; the read number is masked.

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run ocr:check -- <path/to/id-card-photo.jpg>');
    process.exit(1);
  }
  const mimeType = MIME[path.extname(file).toLowerCase()];
  if (!mimeType) {
    console.error('Use a JPG, PNG or WebP photo');
    process.exit(1);
  }
  console.log(`OCR server: ${config.GATES_OCR_URL || '(GATES_OCR_URL not set)'}`);
  console.log(`API key:    ${config.GATES_OCR_API_KEY.trim() ? 'set' : '(GATES_OCR_API_KEY not set)'}`);

  const result = await gatesOcrReader.read(fs.readFileSync(file), mimeType);
  if (result.kind === 'ok') {
    console.log(`OK — national ID ${result.nationalId.slice(0, 7)}*******, name ${result.fullName ? 'read' : 'not read'}`);
  } else if (result.kind === 'unreadable') {
    console.log('Reached the OCR server, but it found no readable ID card in this photo.');
  } else {
    console.log('OCR unavailable — see the [ocr] warning above (403 = this server is not IP-allowlisted).');
    process.exit(2);
  }
}

void main();
