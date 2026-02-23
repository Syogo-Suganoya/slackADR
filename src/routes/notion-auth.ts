import { Request, Response } from 'express';
import { NotionService } from '../services/notion';
import { ConfigService } from '../services/config';
import { WebClient } from '@slack/web-api';
import { buildConfigBlocks } from '../services/slack-ui';

const notionService = new NotionService();
const configService = new ConfigService();

export const handleNotionAuthStart = async (req: Request, res: Response) => {
  const { workspaceId, channelId, userId, externalId } = req.query;

  if (!workspaceId || !channelId || !userId) {
    return res.status(400).send('Missing required parameters: workspaceId, channelId, userId');
  }

  // Encode state
  const state = JSON.stringify({ workspaceId, channelId, userId, externalId });
  const authUrl = notionService.getAuthorizationUrl(Buffer.from(state).toString('base64'));

  res.redirect(authUrl);
};

export const handleNotionCallback = (installationStore: any) => async (req: Request, res: Response) => {
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
      console.log(`[Notion OAuth] Token saved for channel: ${channelId}`);
    }

    // Save to workspace config (Legacy/Global fallback)
    await configService.saveWorkspaceConfig({
      workspaceId: workspaceId,
      notionAccessToken: accessToken,
      notionBotId: botId,
      notionOwner: owner
    });

    console.log(`[Notion OAuth] Token saved for workspace: ${workspaceId}`);

    // Automatically update Slack modal if externalId is present
    const { userId, externalId } = decodedState;
    if (externalId && installationStore) {
      try {
        const installData = await installationStore.fetchInstallation({ teamId: workspaceId });
        if (installData && installData.bot?.token) {
          const client = new WebClient(installData.bot.token);
          const channelConfig = await configService.getChannelConfig(channelId);
          
          const blocks = buildConfigBlocks(
            true, // isConnected is now true
            channelConfig,
            { team_id: workspaceId, channel_id: channelId, user_id: userId },
            process.env.APP_URL || '',
            externalId
          );

          await client.views.update({
            external_id: externalId,
            view: {
              type: 'modal',
              callback_id: 'adr_config_modal',
              external_id: externalId,
              private_metadata: JSON.stringify({ channel_id: channelId }),
              title: { type: 'plain_text', text: 'ADR Bot Config' },
              blocks: blocks,
              submit: { type: 'plain_text', text: 'Save' },
              close: { type: 'plain_text', text: 'Cancel' }
            }
          });
        }
      } catch (slackErr) {
        console.error('[Notion OAuth] Slack modal update error:', slackErr);
      }
    }

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
