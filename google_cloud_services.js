import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
import { VertexAI } from '@google-cloud/vertexai';
import { GoogleAuth } from 'google-auth-library';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// 1. ADC Configuration & Credentials Resolution
// ---------------------------------------------------------------------------
let cachedProjectId = process.env.GCP_PROJECT_ID || '';
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Check if credentials path is specified, exists in root, or in gcloud default ADC
export function resolveCredentialsOptions() {
  const options = {};
  
  // 1. GOOGLE_APPLICATION_CREDENTIALS path
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      ? process.env.GOOGLE_APPLICATION_CREDENTIALS
      : path.resolve(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS);
    if (fs.existsSync(credPath)) {
      options.keyFilename = credPath;
      console.log(`[Google Cloud ADC] Using keyFilename: ${options.keyFilename}`);
    }
  }
  
  // 2. Local google_credentials.json in project root
  if (!options.keyFilename) {
    const localKey = path.join(__dirname, 'google_credentials.json');
    if (fs.existsSync(localKey)) {
      options.keyFilename = localKey;
      console.log(`[Google Cloud ADC] Found local key file: ${options.keyFilename}`);
    }
  }
  
  // 3. Raw Service Account JSON in env
  if (!options.keyFilename && process.env.GCP_SERVICE_ACCOUNT_KEY) {
    try {
      options.credentials = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
      console.log(`[Google Cloud ADC] Using credentials parsed from GCP_SERVICE_ACCOUNT_KEY`);
    } catch (err) {
      console.warn(`[Google Cloud ADC] Warning: Failed parsing GCP_SERVICE_ACCOUNT_KEY JSON:`, err.message);
    }
  }

  // 4. API Key fallback for Cloud TTS & Generative services
  const apiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_TTS_API_KEY || process.env.GCP_API_KEY;
  if (!options.keyFilename && !options.credentials && apiKey) {
    options.apiKey = apiKey;
    console.log(`[Google Cloud] Using API key authentication for services`);
  }

  // 5. Explicit Project ID and Quota Project
  const projectId = process.env.GCP_PROJECT_ID || 'hackfusion-prestige';
  options.projectId = projectId;
  options.quotaProjectId = projectId;
  
  return options;
}

export function hasValidCredentialsConfig() {
  const options = resolveCredentialsOptions();
  const standardAdc = process.env.APPDATA ? path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json') : '';
  return !!(options.keyFilename || options.credentials || options.apiKey || (standardAdc && fs.existsSync(standardAdc)));
}

let clientOptions = resolveCredentialsOptions();

// Initialize Google Cloud Clients with ADC Auth
let ttsClient = null;
let speechClient = null;
let vertexAI = null;
let googleAuth = null;
let genAI = null;

export function getTtsClient() {
  if (!ttsClient) {
    clientOptions = resolveCredentialsOptions();
    if (!hasValidCredentialsConfig()) {
      throw new Error('Google Cloud ADC credentials not found. Configure google_credentials.json, GOOGLE_APPLICATION_CREDENTIALS, or GOOGLE_CLOUD_API_KEY.');
    }
    ttsClient = new TextToSpeechClient(clientOptions);
  }
  return ttsClient;
}

export function getSpeechClient() {
  if (!speechClient) {
    clientOptions = resolveCredentialsOptions();
    if (!hasValidCredentialsConfig()) {
      throw new Error('Google Cloud ADC credentials not found. Configure google_credentials.json, GOOGLE_APPLICATION_CREDENTIALS, or GOOGLE_CLOUD_API_KEY.');
    }
    speechClient = new SpeechClient(clientOptions);
  }
  return speechClient;
}

export function getGoogleAuth() {
  if (!googleAuth && hasValidCredentialsConfig()) {
    clientOptions = resolveCredentialsOptions();
    googleAuth = new GoogleAuth({
      ...clientOptions,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
  }
  return googleAuth;
}

export function refreshGoogleClients() {
  clientOptions = resolveCredentialsOptions();
  ttsClient = null;
  speechClient = null;
  vertexAI = null;
  googleAuth = null;
  cachedProjectId = process.env.GCP_PROJECT_ID || '';
  if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  if (hasValidCredentialsConfig()) {
    try {
      ttsClient = new TextToSpeechClient(clientOptions);
      speechClient = new SpeechClient(clientOptions);
      googleAuth = new GoogleAuth({
        ...clientOptions,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      console.log('[Google Cloud] Clients initialized successfully.');
    } catch (e) {
      console.warn('[Google Cloud] Client refresh note:', e.message);
    }
  }
}

// Initial bootstrap only if credentials are present
if (hasValidCredentialsConfig()) {
  try {
    ttsClient = new TextToSpeechClient(clientOptions);
    speechClient = new SpeechClient(clientOptions);
    googleAuth = new GoogleAuth({
      ...clientOptions,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    console.log('[Google Cloud] TTS and Speech clients initialized with ADC.');
  } catch (initErr) {
    console.warn('[Google Cloud] Client initial bootstrap note:', initErr.message);
  }
} else {
  console.log('[Google Cloud] Running in standby mode (ADC credentials not yet configured).');
}

// Initialize Gemini Generative AI fallback if API key is provided
if (process.env.GEMINI_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('[Google Cloud] Google Generative AI client initialized with GEMINI_API_KEY.');
  } catch (genErr) {
    console.warn('[Google Cloud] Failed to initialize GoogleGenerativeAI:', genErr.message);
  }
}

// Helper: Get active GCP Project ID
export async function getProjectId() {
  if (cachedProjectId) return cachedProjectId;
  if (clientOptions.credentials && clientOptions.credentials.project_id) {
    cachedProjectId = clientOptions.credentials.project_id;
    return cachedProjectId;
  }
  try {
    const auth = getGoogleAuth();
    if (auth) {
      cachedProjectId = await auth.getProjectId();
      return cachedProjectId;
    }
  } catch (e) {
    // Auth not yet active
  }
  return cachedProjectId || process.env.GCP_PROJECT_ID || 'ai-interview-platform';
}

// ---------------------------------------------------------------------------
// 2. Google Cloud Text-to-Speech (TTS)
// ---------------------------------------------------------------------------
/**
 * Synthesize speech using Google Cloud Text-to-Speech with ADC
 * Supports English (en-IN / en-US), Hindi (hi-IN), and Hinglish with Neural2 & Wavenet voices
 */
export async function synthesizeSpeechGoogleCloud(text, options = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('Valid text string is required for speech synthesis.');
  }

  const cleanText = text.trim();
  const lang = (options.lang || options.language || 'en-IN').toLowerCase();
  const isHindiScript = /[\u0900-\u097F]/.test(cleanText);

  // Determine optimal language code and voice (Default: Google Chirp 3 HD flagship voice)
  let languageCode = 'en-IN';
  let voiceName = options.voice || options.voiceName || '';

  if (!voiceName) {
    if (lang.startsWith('hi') || isHindiScript) {
      languageCode = 'hi-IN';
      voiceName = 'hi-IN-Chirp3-HD-Aoede'; // Best: Google Chirp 3 HD Hindi
    } else if (lang === 'en-us') {
      languageCode = 'en-US';
      voiceName = 'en-US-Chirp3-HD-Aoede'; // Best: Google Chirp 3 HD US English
    } else {
      languageCode = 'en-IN';
      voiceName = 'en-IN-Chirp3-HD-Aoede'; // Best: Google Chirp 3 HD Indian English
    }
  } else if (voiceName.startsWith('hi-')) {
    languageCode = 'hi-IN';
  } else if (voiceName.toLowerCase().startsWith('en-us')) {
    languageCode = 'en-US';
  } else if (voiceName.toLowerCase().startsWith('en-in')) {
    languageCode = 'en-IN';
  }

  const isMale = voiceName.endsWith('-B') || voiceName.endsWith('-C') || voiceName.includes('Charon') || voiceName.includes('Achird');
  const ssmlGender = options.gender || options.ssmlGender || (isMale ? 'MALE' : 'FEMALE');

  console.log(`[Google Cloud TTS] Synthesizing (${languageCode}, best model voice: ${voiceName}) for: "${cleanText.substring(0, 40)}..."`);

  const request = {
    input: { text: cleanText },
    voice: {
      languageCode,
      name: voiceName,
      ssmlGender
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: options.speakingRate || 1.0,
      pitch: options.pitch || 0.0
    }
  };

  const client = getTtsClient();

  try {
    const [response] = await client.synthesizeSpeech(request);
    return Buffer.from(response.audioContent); // Buffer containing MP3 audio
  } catch (error) {
    console.error(`[Google Cloud TTS] Error with primary voice (${voiceName}): ${error.message}`);

    // If API key is configured, attempt REST API synthesis fallback
    const apiKey = process.env.GOOGLE_CLOUD_API_KEY || process.env.GOOGLE_TTS_API_KEY || process.env.GCP_API_KEY;
    if (apiKey) {
      try {
        console.log(`[Google Cloud TTS] Attempting REST synthesis with API key...`);
        const restRes = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        });
        if (restRes.ok) {
          const restData = await restRes.json();
          if (restData.audioContent) {
            console.log(`[Google Cloud TTS] REST synthesis succeeded.`);
            return Buffer.from(restData.audioContent, 'base64');
          }
        }
      } catch (restErr) {
        console.warn(`[Google Cloud TTS] REST fallback note: ${restErr.message}`);
      }
    }

    const isAuthErr = error.message.includes('Could not load the default credentials') || error.message.includes('UNAUTHENTICATED');
    
    // Tier 1 fallback: Try Neural2 voice if Chirp3 fails
    if (!isAuthErr && voiceName.includes('Chirp')) {
      try {
        const neuralVoice = languageCode === 'hi-IN' ? 'hi-IN-Neural2-A' : (languageCode === 'en-US' ? 'en-US-Neural2-F' : 'en-IN-Neural2-A');
        console.log(`[Google Cloud TTS] Retrying with Neural2 voice (${neuralVoice})...`);
        request.voice.name = neuralVoice;
        const [retryResponse] = await client.synthesizeSpeech(request);
        return Buffer.from(retryResponse.audioContent);
      } catch (neuralErr) {
        console.warn(`[Google Cloud TTS] Neural2 retry failed: ${neuralErr.message}`);
      }
    }

    // Tier 2 fallback: Try Wavenet voice
    if (!isAuthErr && !voiceName.includes('Wavenet')) {
      try {
        const wavenetVoice = languageCode === 'hi-IN' ? 'hi-IN-Wavenet-D' : 'en-IN-Wavenet-D';
        console.log(`[Google Cloud TTS] Retrying with Wavenet voice (${wavenetVoice})...`);
        request.voice.name = wavenetVoice;
        const [retryResponse] = await client.synthesizeSpeech(request);
        return Buffer.from(retryResponse.audioContent);
      } catch (retryErr) {
        console.error(`[Google Cloud TTS] Wavenet retry failed: ${retryErr.message}`);
      }
    }

    throw error;
  }
}

// ---------------------------------------------------------------------------
// 3. Google Cloud Speech-to-Text (STT)
// ---------------------------------------------------------------------------
/**
 * Transcribe candidate speech using Google Cloud Speech-to-Text with ADC
 * Uses best 'latest_long' model with multi-lingual Hinglish tolerance and automatic fallback
 */
export async function transcribeAudioGoogleCloud(audioData, options = {}) {
  let audioBytes = null;
  if (Buffer.isBuffer(audioData)) {
    audioBytes = audioData.toString('base64');
  } else if (typeof audioData === 'string') {
    // If base64 string with data URI prefix, remove header
    audioBytes = audioData.replace(/^data:audio\/\w+;base64,/, '');
  } else {
    throw new Error('Audio data must be a Buffer or base64 string.');
  }

  const targetLang = (options.lang || options.language || 'en-IN').toLowerCase();
  const primaryLang = targetLang.startsWith('hi') ? 'hi-IN' : 'en-IN';
  const encoding = options.encoding || 'WEBM_OPUS';
  const sampleRateHertz = options.sampleRateHertz || 48000;
  const preferredModel = options.model || 'latest_long';

  console.log(`[Google Cloud STT] Transcribing audio with primary language: ${primaryLang}, model: ${preferredModel}, encoding: ${encoding}`);

  const request = {
    audio: {
      content: audioBytes
    },
    config: {
      encoding,
      sampleRateHertz,
      languageCode: primaryLang,
      alternativeLanguageCodes: primaryLang === 'hi-IN' ? ['en-IN', 'en-US'] : ['hi-IN', 'en-US'],
      enableAutomaticPunctuation: true,
      model: preferredModel,
      useEnhanced: true
    }
  };

  const client = getSpeechClient();
  let response;

  try {
    [response] = await client.recognize(request);
  } catch (modelErr) {
    // If latest_long is not supported for this specific audio format, fallback to default model
    if (request.config.model !== 'default') {
      console.warn(`[Google Cloud STT] Model ${request.config.model} failed (${modelErr.message}). Retrying with default model...`);
      request.config.model = 'default';
      delete request.config.useEnhanced;
      [response] = await client.recognize(request);
    } else {
      throw modelErr;
    }
  }
  const transcription = response.results
    .map(result => result.alternatives[0]?.transcript)
    .filter(Boolean)
    .join('\n');

  const confidence = response.results[0]?.alternatives[0]?.confidence || 0.95;

  // Detect language profile
  const isHindi = /[\u0900-\u097F]/.test(transcription);
  const isHinglishKeywords = /\b(kya|kaise|kyun|hai|hain|hota|hoti|hote|mein|mai|me|aur|bhi|par|se|ko|ka|ki|ke|maine|humne|karna|karne|karta|karte|karti|raha|rahe|thi|tha|the|wala|wali|wale|samjha|samajh|use)\b/i.test(transcription);
  const detectedLang = isHindi ? 'hi' : (isHinglishKeywords ? 'hinglish' : 'en');

  return {
    transcript: transcription,
    confidence,
    detectedLanguage: detectedLang,
    isHinglish: isHinglishKeywords || (isHindi && /[a-zA-Z]/.test(transcription))
  };
}

// ---------------------------------------------------------------------------
// 4. Gemini 2.5 Flash Model via Vertex AI (ADC Auth) & Google GenAI
// ---------------------------------------------------------------------------
/**
 * Invoke Gemini 2.5 Flash model using Vertex AI with ADC Auth
 * Supports structured JSON responses and multi-turn conversations
 */
export async function callGemini25Flash(promptOrMessages, options = {}) {
  const projectId = await getProjectId();
  const modelName = options.model || GEMINI_MODEL;
  const customKey = options.clientApiKey || options.apiKey || process.env.GEMINI_API_KEY;

  console.log(`[Gemini 2.5 Flash] Calling model "${modelName}" (GCP Project: "${projectId}", Region: "${GCP_LOCATION}")`);

  // Transform messages or prompt into Gemini format
  let systemInstruction = options.systemPrompt || '';
  let contents = [];

  if (Array.isArray(promptOrMessages)) {
    promptOrMessages.forEach(msg => {
      if (msg.role === 'system') {
        systemInstruction += (systemInstruction ? '\n\n' : '') + msg.content;
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    });
  } else {
    if (options.systemPrompt) {
      systemInstruction = options.systemPrompt;
    }
    contents = [
      {
        role: 'user',
        parts: [{ text: promptOrMessages }]
      }
    ];
  }

  // Attempt 1: Vertex AI using ADC Auth
  try {
    if (!vertexAI) {
      vertexAI = new VertexAI({
        ...clientOptions,
        project: projectId,
        location: GCP_LOCATION
      });
    }

    const generativeModel = vertexAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: options.temperature !== undefined ? options.temperature : 0.7
      },
      systemInstruction: systemInstruction ? { role: 'system', parts: [{ text: systemInstruction }] } : undefined
    });

    const response = await generativeModel.generateContent({ contents });
    const responseCandidate = response.response?.candidates?.[0];
    const textOutput = responseCandidate?.content?.parts?.[0]?.text;

    if (!textOutput) {
      throw new Error('Gemini 2.5 Flash Vertex AI returned empty content.');
    }

    console.log(`[Gemini 2.5 Flash Vertex AI] Received response successfully.`);
    return JSON.parse(textOutput.trim());
  } catch (vertexErr) {
    console.warn(`[Gemini 2.5 Flash Vertex AI] Vertex AI ADC call failed: ${vertexErr.message}`);

    // Attempt 2: Direct Google Generative AI SDK fallback if GEMINI_API_KEY is available
    if (customKey || process.env.GEMINI_API_KEY) {
      try {
        console.log(`[Gemini 2.5 Flash] Falling back to Google Generative AI API Key...`);
        const activeGenAI = customKey ? new GoogleGenerativeAI(customKey) : genAI;
        const fallbackModel = activeGenAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7
          },
          systemInstruction: systemInstruction || undefined
        });

        // Convert contents format for GoogleGenAI
        const genAIContents = contents.map(c => ({
          role: c.role,
          parts: c.parts.map(p => ({ text: p.text }))
        }));

        const result = await fallbackModel.generateContent({ contents: genAIContents });
        const text = result.response.text();
        return JSON.parse(text.trim());
      } catch (genAIErr) {
        console.error(`[Gemini 2.5 Flash GenAI] Fallback failed: ${genAIErr.message}`);
        throw genAIErr;
      }
    }

    throw vertexErr;
  }
}

// ---------------------------------------------------------------------------
// 5. Google Cloud & ADC Status Check
// ---------------------------------------------------------------------------
export async function getGoogleCloudStatus() {
  const creds = resolveCredentialsOptions();
  let hasADC = false;
  let detectedProject = '';
  let authError = null;
  let authType = 'none';

  const standardAdcPath = process.env.APPDATA ? path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json') : '';
  const hasStandardAdc = standardAdcPath && fs.existsSync(standardAdcPath);

  if (creds.keyFilename && fs.existsSync(creds.keyFilename)) {
    hasADC = true;
    authType = 'service_account_file';
  } else if (creds.credentials) {
    hasADC = true;
    authType = 'service_account_json';
  } else if (hasStandardAdc) {
    hasADC = true;
    authType = 'gcloud_user_adc';
  } else if (creds.apiKey) {
    hasADC = true;
    authType = 'api_key';
  }

  try {
    const auth = getGoogleAuth();
    if (auth) {
      detectedProject = await auth.getProjectId();
      hasADC = true;
    }
  } catch (err) {
    if (authType === 'none') {
      authError = err.message;
    }
  }

  const hasGeminiKey = !!process.env.GEMINI_API_KEY;

  return {
    hasADC,
    authType,
    projectId: detectedProject || cachedProjectId || process.env.GCP_PROJECT_ID || 'Not configured',
    location: GCP_LOCATION,
    keyFile: creds.keyFilename || (hasStandardAdc ? standardAdcPath : 'None (Using default ADC)'),
    hasApiKey: !!(creds.apiKey),
    hasGeminiKey,
    geminiModel: GEMINI_MODEL,
    services: {
      tts: 'Google Cloud Text-to-Speech (Chirp 3 HD, Neural2, Wavenet & REST fallback)',
      stt: 'Google Cloud Speech-to-Text (latest_long Enhanced & Multi-lingual Hinglish)',
      llm: `${GEMINI_MODEL} (Vertex AI via ADC / Google GenAI)`
    },
    authError: authError ? authError.split('\n')[0] : null
  };
}
