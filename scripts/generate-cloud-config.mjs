import { writeFile } from 'node:fs/promises';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  console.error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required.');
  process.exit(1);
}

const runtimeConfig = `window.REGULA_RUSTICA_CLOUD=${JSON.stringify({ url, publishableKey })};\n`;
await writeFile(new URL('../cloud-runtime-config.js', import.meta.url), runtimeConfig, { mode: 0o600 });
console.log('Generated cloud-runtime-config.js from environment variables.');
