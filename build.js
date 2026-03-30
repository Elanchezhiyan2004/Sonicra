const fs = require('fs');

const config = `const CONFIG = {
  YT_API_KEYS: [
    '${process.env.YT_API_KEY_1}',
    '${process.env.YT_API_KEY_2}',
    '${process.env.YT_API_KEY_3}',
  ].filter(k => k && !k.includes('undefined')),

  SUPABASE_URL: '${process.env.SUPABASE_URL}',
  SUPABASE_ANON_KEY: '${process.env.SUPABASE_ANON_KEY}',
};`;

fs.writeFileSync('config.js', config);
console.log('✅ config.js generated from env vars');