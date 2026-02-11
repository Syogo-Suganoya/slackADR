import * as fs from 'fs';
import { Request, Response } from 'express';
import { NotionService } from '../services/notion';
import { ConfigService } from '../services/config';

const notionService = new NotionService();
const configService = new ConfigService();

export const handleNotionAuthStart = async (req: Request, res: Response) => {
  const { workspaceId, channelId, userId } = req.query;

  if (!workspaceId || !channelId || !userId) {
    return res.status(400).send('Missing required parameters: workspaceId, channelId, userId');
  }

  // Encode state
  const state = JSON.stringify({ workspaceId, channelId, userId });
  const authUrl = notionService.getAuthorizationUrl(Buffer.from(state).toString('base64'));

  res.redirect(authUrl);
};

export const handleNotionCallback = async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`Notion Authorization Failed: ${error}`);
  }

  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }

  try {
    const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString());
    const { workspaceId, channelId } = decodedState;

    fs.appendFileSync('debug.log', `[Notion OAuth] Callback received. workspaceId: ${workspaceId}, channelId: ${channelId}\n`);
    console.log(`[Notion OAuth] Exchanging code for token for workspace: ${workspaceId}, channel: ${channelId}`);
    
    // Exchange code for token
    const tokenData = await notionService.exchangeAuthCode(code as string);
    const accessToken = tokenData.access_token;
    const botId = tokenData.bot_id;
    const owner = tokenData.owner;
    
    // Save to channel config (Priority)
    if (channelId) {
      const existingConfig = await configService.getChannelConfig(channelId);
      await configService.saveChannelConfig({
        workspaceId: workspaceId,
        channelId: channelId,
        notionDatabaseId: existingConfig?.notionDatabaseId ?? null,
        notionAccessToken: accessToken,
        notionBotId: botId,
        geminiApiKey: existingConfig?.geminiApiKey ?? null,
        triggerEmoji: existingConfig?.triggerEmoji ?? 'decision'
      });
      fs.appendFileSync('debug.log', `[Notion OAuth] Token saved for channel: ${channelId}\n`);
      console.log(`[Notion OAuth] Token saved for channel: ${channelId}`);
    }

    // Save to workspace config (Legacy/Global fallback)
    await configService.saveWorkspaceConfig({
      workspaceId: workspaceId,
      notionAccessToken: accessToken,
      notionBotId: botId,
      notionOwner: owner
    });

    fs.appendFileSync('debug.log', `[Notion OAuth] Token saved for workspace: ${workspaceId}\n`);
    console.log(`[Notion OAuth] Token saved for workspace: ${workspaceId}`);

    // Render success page
    res.send(`
      <html>
        <head>
          <title>Notion Connection Successful</title>
          <style>
            body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #f4f6f8; }
            .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
            h1 { color: #2e7d32; }
            p { color: #555; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ Connection Successful!</h1>
            <p>Slack ADR Bot has been successfully connected to your Notion workspace.</p>
            <p>You can close this window and return to Slack.</p>
          </div>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('[Notion OAuth] Error:', err);
    res.status(500).send('Internal Server Error during Notion Authorization');
  }
};
