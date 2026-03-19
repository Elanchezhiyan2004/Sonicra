const CONFIG = {
  // Add as many YouTube API keys as you want
  // Create new projects at: console.cloud.google.com
  // Each key gives 10,000 units/day (~100 searches)
  YT_API_KEYS: [
    'AIzaSyBr92dCPVfwmBGQ_qMq5zfLBrSFm4czC0o',  // Key 1 — your existing key
    'AIzaSyAntugmvaAMEUJB-sRzqgLH4xjXecJ2q3s',                    // Key 2 — create new project
    'AIzaSyAU9Zu8YICfeQE3yATGz8RLPXgMvAmdPdo',                     // Key 3 — optional
  ].filter(k => !k.includes('YOUR_')),             // auto-removes unfilled keys

  SUPABASE_URL: 'https://gtrrtvvmoknujqfuvrgo.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_AN916JxO4dRKp5EcA0Ibog_0lM6Vrjo',
};