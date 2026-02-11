import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import dotenv from 'dotenv';
import express from 'express';
import * as fs from 'fs';
import { registerSlackHandlers } from './handlers/slack';
import { NotionService } from './services/notion';
import { handleNotionAuthStart, handleNotionCallback } from './routes/notion-auth';
import { ConfigService } from './services/config';
import { SlackInstallationStore } from './services/slack-installation';

dotenv.config();

const notionService = new NotionService();
const installationStore = new SlackInstallationStore();
const configService = new ConfigService();

// Initialize Express separately to add middleware before Bolt
const expressApp = express();

// Simple Access Log
expressApp.use((req, res, next) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logEntry = `[${new Date().toISOString()}] ${req.method} ${req.path} - Status: ${res.statusCode} (${duration}ms)\n`;
    fs.appendFileSync('access.log', logEntry);
  });
  next();
});

// Initialize the ExpressReceiver
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  redirectUri: process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/slack/oauth_redirect` : undefined,
  installationStore,
  app: expressApp,
  scopes: ['channels:history', 'groups:history', 'chat:write', 'commands', 'reactions:read'],
  installerOptions: {
    stateVerification: false,
    redirectUriPath: '/slack/oauth_redirect',
  },
  processBeforeResponse: false,
});

// Trust proxy for Render (required for secure cookies)
receiver.app.set('trust proxy', 1);

// Initialize the App
const app = new App({
  receiver,
  installationStore,
  logLevel: LogLevel.DEBUG,
});

// Register Handlers
registerSlackHandlers(app);

// Recovery Endpoint (Triggered by GitHub Actions)
receiver.app.post('/recovery', async (req, res) => {
  const token = req.headers['x-recovery-token'];
  const expectedToken = process.env.RECOVERY_TOKEN;

  if (!expectedToken || token !== expectedToken) {
    console.warn('Unauthorized recovery attempt');
    return res.status(401).send('Unauthorized');
  }

  console.log('🚀 Recovery trigger received. Processing Ready logs...');
  try {
    await notionService.processReadyLogs(configService);
    res.status(200).send('Recovery process completed');
  } catch (error) {
    console.error('Recovery process failed:', error);
    res.status(500).send('Recovery process failed');
  }
});

// Notion OAuth Endpoints
receiver.app.get('/notion/install', handleNotionAuthStart);
receiver.app.get('/notion/callback', handleNotionCallback);

// Custom Health Check
receiver.app.get('/', (req, res) => {
  res.status(200).send('Slack ADR Bot is running! 🚀');
});

const PORT = process.env.PORT || 3000;

(async () => {
  await app.start(parseInt(String(PORT), 10));
  console.log(`⚡️ Slack ADR Bot is running on port ${PORT}!`);
})();
