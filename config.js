const CONFIG = {
  SPOTIFY_CLIENT_ID: '5d4d363835504385b85a92430243eb8c',
  SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3000/callback',

  SPOTIFY_SCOPES: [
    'user-read-private',
    'user-read-email',
    'streaming',
    'user-modify-playback-state',
    'user-read-playback-state',
    'user-library-read',
    'user-library-modify',
    'user-top-read',
  ].join(' '),

  SUPABASE_URL: 'https://gtrrtvvmoknujqfuvrgo.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_AN916JxO4dRKp5EcA0Ibog_0lM6Vrjo',
};