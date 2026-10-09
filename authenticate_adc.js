/**
 * Google Cloud Application Default Credentials (ADC) Authenticator
 * Replicates `gcloud auth application-default login` directly in Node.js
 * Run: node authenticate_adc.js
 */
import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standard Google Cloud SDK OAuth Client credentials
const CLIENT_ID = '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com';
const CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty';
const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}/`;
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
].join(' ');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('\n=============================================================');
console.log('   GOOGLE CLOUD APPLICATION DEFAULT CREDENTIALS (ADC) LOGIN');
console.log('=============================================================\n');
console.log('Starting local authentication callback listener on port ' + PORT + '...');

const server = http.createServer(async (req, res) => {
  const reqUrl = url.parse(req.url, true);
  
  if (reqUrl.pathname === '/') {
    const code = reqUrl.query.code;
    const error = reqUrl.query.error;

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h2>Authentication Failed</h2><p>Google returned error: ${error}</p>`);
      console.error(`\n Authentication Error: ${error}`);
      server.close();
      return;
    }

    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html>
          <body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
            <div style="background: #1e293b; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
              <h1 style="color: #10b981; margin-bottom: 12px;">Authentication Successful!</h1>
              <p style="color: #94a3b8; font-size: 16px;">Google Cloud ADC credentials have been generated and saved.</p>
              <p style="color: #cbd5e1; font-size: 14px;">You can now close this tab and return to the application.</p>
            </div>
          </body>
        </html>
      `);

      console.log('\n Authorization code received! Exchanging for ADC refresh token...');

      try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code'
          }).toString()
        });

        const tokenData = await tokenResponse.json();

        if (tokenData.error) {
          throw new Error(tokenData.error_description || tokenData.error);
        }

        // Fetch user account email
        let accountEmail = '';
        try {
          const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const userData = await userRes.json();
          accountEmail = userData.email || '';
        } catch (_) {}

        const adcCredentials = {
          account: accountEmail,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: tokenData.refresh_token,
          type: 'authorized_user'
        };

        // 1. Save to standard Windows ADC location (%APPDATA%\gcloud\application_default_credentials.json)
        if (process.env.APPDATA) {
          const gcloudDir = path.join(process.env.APPDATA, 'gcloud');
          if (!fs.existsSync(gcloudDir)) {
            fs.mkdirSync(gcloudDir, { recursive: true });
          }
          const winAdcPath = path.join(gcloudDir, 'application_default_credentials.json');
          fs.writeFileSync(winAdcPath, JSON.stringify(adcCredentials, null, 2), 'utf-8');
          console.log(` Saved ADC to standard path: ${winAdcPath}`);
        }

        // 2. Also save to project root (google_credentials.json) for guaranteed discovery
        const localKeyPath = path.join(__dirname, 'google_credentials.json');
        fs.writeFileSync(localKeyPath, JSON.stringify(adcCredentials, null, 2), 'utf-8');
        console.log(` Saved ADC backup to project: ${localKeyPath}`);

        console.log('\n=============================================================');
        console.log(` SUCCESS! Logged in as: ${accountEmail || 'Authorized User'}`);
        console.log(' Application Default Credentials (ADC) are now active.');
        console.log('=============================================================\n');

        // Test speech synthesis immediately
        import('./verify_google_tts.js').then(() => {
          setTimeout(() => process.exit(0), 1000);
        });

      } catch (tokenErr) {
        console.error(' Failed to exchange authorization code for token:', tokenErr.message);
        setTimeout(() => process.exit(1), 1000);
      } finally {
        server.close();
      }
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n Opening browser for Google Cloud Sign-In...`);
  console.log(` If your browser does not open automatically, copy and paste this URL:\n`);
  console.log(authUrl + '\n');

  // Open URL in default browser on Windows
  exec(`start "" "${authUrl}"`);
});
