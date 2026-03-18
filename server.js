// =============================================
//  WAVELY — HTTPS Local Server
//  Run: node server.js
// =============================================

const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

// mkcert certificates — already generated in your project folder
const options = {
  cert: fs.readFileSync(path.join(__dirname, 'localhost.pem')),
  key:  fs.readFileSync(path.join(__dirname, 'localhost-key.pem')),
};

const server = https.createServer(options, (req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fullPath = path.join(__dirname, filePath);
  const ext = path.extname(fullPath);
  const contentType = MIME[ext] || 'text/plain';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); }
        else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(data2); }
      });
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log('\n🎵 Wavely is running on HTTPS!');
  console.log(`👉 Open: https://localhost:${PORT}\n`);
});