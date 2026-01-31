import { App, ExpressReceiver } from '@slack/bolt';
import dotenv from 'dotenv';
import { registerSlackHandlers } from './handlers/slack';
import { NotionService } from './services/notion';

dotenv.config();

const notionService = new NotionService();

// Initialize the ExpressReceiver
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || '',
  processBeforeResponse: true, // Required for some environments
});

// Initialize the App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Register Handlers
registerSlackHandlers(app);

// Debug: Log all incoming requests
receiver.app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.path}`);
  next();
});

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
    await notionService.processReadyLogs();
    res.status(200).send('Recovery process completed');
  } catch (error) {
    console.error('Recovery process failed:', error);
    res.status(500).send('Recovery process failed');
  }
});

// Custom Health Check
receiver.app.get('/', (req, res) => {
  res.status(200).send('Slack ADR Bot is running! 🚀');
});

const PORT = process.env.PORT || 3000;

(async () => {
  await app.start(parseInt(String(PORT), 10));
  console.log(`⚡️ Slack ADR Bot is running on port ${PORT}!`);
})();
