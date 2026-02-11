import express from 'express';
import dotenv from 'dotenv';
import { NotionService } from './services/notion';
import { ConfigService } from './services/config';

dotenv.config();

const app = express();
const notionService = new NotionService();
const configService = new ConfigService();

// Recovery Endpoint
app.post('/recovery', async (req, res) => {
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

// Health Check
app.get('/', (req, res) => {
  res.status(200).send('Recovery API is running! 🚀');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`⚡️ Recovery API is running on port ${PORT}!`);
});
