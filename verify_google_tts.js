/**
 * Google Cloud ADC & TTS Verification and Diagnostic Tool
 * Run: node verify_google_tts.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  getGoogleCloudStatus,
  synthesizeSpeechGoogleCloud,
  resolveCredentialsOptions,
  getGoogleAuth
} from './google_cloud_services.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runDiagnostics() {
  console.log('\n=============================================================');
  console.log('   GOOGLE CLOUD ADC & TEXT-TO-SPEECH (TTS) DIAGNOSTICS');
  console.log('=============================================================\n');

  // Step 1: Check Credential Sources
  console.log('--- 1. Credential Sources Check ---');
  const envKeyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const localKeyPath = path.join(__dirname, 'google_credentials.json');
  const winAdcPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json') : null;
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_TTS_API_KEY || process.env.GCP_API_KEY;

  console.log(`• GOOGLE_APPLICATION_CREDENTIALS: ${envKeyPath ? envKeyPath + (fs.existsSync(envKeyPath) ? ' (FOUND)' : ' (FILE NOT FOUND)') : 'Not set'}`);
  console.log(`• Local google_credentials.json:  ${fs.existsSync(localKeyPath) ? localKeyPath + ' (FOUND)' : 'Not found in project root'}`);
  console.log(`• Windows gcloud ADC file:        ${winAdcPath && fs.existsSync(winAdcPath) ? winAdcPath + ' (FOUND)' : 'Not found (%APPDATA%\\gcloud\\application_default_credentials.json)'}`);
  console.log(`• GCP Project ID:                 ${process.env.GCP_PROJECT_ID || 'Not set'}`);
  console.log(`• Google Cloud API Key:           ${apiKey ? apiKey.substring(0, 8) + '...' : 'Not set'}`);

  // Step 2: ADC Status
  console.log('\n--- 2. Checking Google Cloud Auth / ADC ---');
  const status = await getGoogleCloudStatus();
  console.log(`• ADC Detected:  ${status.hasADC ? 'YES' : 'NO'}`);
  console.log(`• Auth Type:     ${status.authType}`);
  console.log(`• Project ID:    ${status.projectId}`);
  console.log(`• Key / Source:  ${status.keyFile}`);

  if (status.authError) {
    console.log(`• Auth Note:     ${status.authError}`);
  }

  // Step 3: Test Text-to-Speech Synthesis
  console.log('\n--- 3. Testing Text-to-Speech Synthesis ---');
  const testPhrase = 'Hello! Google Cloud Text-to-Speech is verified and working properly.';
  
  try {
    console.log(`• Requesting speech synthesis for: "${testPhrase}"...`);
    const startTime = Date.now();
    const audioBuffer = await synthesizeSpeechGoogleCloud(testPhrase, { lang: 'en-IN' });
    const duration = Date.now() - startTime;

    const outputPath = path.join(__dirname, 'public', 'test_tts_sample.mp3');
    fs.writeFileSync(outputPath, audioBuffer);

    console.log(`\n SUCCESS: Google Cloud TTS synthesized ${audioBuffer.length} bytes of MP3 audio in ${duration}ms!`);
    console.log(`• Audio saved to: ${outputPath}`);
    console.log('=============================================================\n');
    return true;
  } catch (err) {
    console.error(`\n TTS SYNTHESIS FAILED: ${err.message}\n`);
    console.log('=============================================================');
    console.log('   HOW TO AUTHENTICATE GOOGLE CLOUD ADC');
    console.log('=============================================================');
    console.log('Choose ONE of the following 3 options:\n');
    console.log('OPTION 1: Service Account Key (Recommended for Node.js)');
    console.log('  1. Open Google Cloud Console: https://console.cloud.google.com/iam-admin/serviceaccounts');
    console.log('  2. Select your project and create a Service Account.');
    console.log('  3. Assign role: "Cloud Text-to-Speech User" (or "Cloud Speech-to-Text User").');
    console.log('  4. Under Keys tab > Add Key > Create new key > JSON.');
    console.log('  5. Save the downloaded JSON file as:');
    console.log(`     ${localKeyPath}`);
    console.log('     OR add to .env: GOOGLE_APPLICATION_CREDENTIALS="path/to/key.json"\n');
    console.log('OPTION 2: Google Cloud CLI (gcloud ADC)');
    console.log('  1. Install gcloud CLI: winget install Google.CloudSDK');
    console.log('  2. Open a new terminal and run: gcloud auth application-default login');
    console.log('  3. Sign in via your browser. ADC file is saved automatically.\n');
    console.log('OPTION 3: Google Cloud API Key');
    console.log('  1. In Cloud Console > APIs & Services > Credentials > Create API Key');
    console.log('  2. Add to your .env file:');
    console.log('     GOOGLE_CLOUD_API_KEY="AIzaSy..."\n');
    console.log('=============================================================\n');
    return false;
  }
}

runDiagnostics().catch(err => {
  console.error('Diagnostic error:', err);
});
