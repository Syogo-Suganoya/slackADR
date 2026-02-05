import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { AIService } from '../services/ai';
import { NotionService } from '../services/notion';
import { ConfigService } from '../services/config';

const aiService = new AIService();
const notionService = new NotionService();
const configService = new ConfigService();

export const registerSlackHandlers = (app: App) => {
  app.event('reaction_added', async ({ event, client, logger, body }) => {
    logger.info(`Received reaction: ${event.reaction} from ${event.user} in ${event.item.channel}`);

    // 1. Check config
    const workspaceId = (body as any).team_id;
    const config = await configService.getChannelConfig(event.item.channel);
    const workspaceConfig = await configService.getWorkspaceConfig(workspaceId);
    
    const token = workspaceConfig?.notionAccessToken;
    const triggerEmoji = config?.triggerEmoji || 'decision';

    if (event.reaction !== triggerEmoji) {
      return;
    }

    if (!token && !process.env.NOTION_API_KEY) {
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: ':warning: Notion 連携が完了していません。`/adr-config` から Notion と連携してください。'
      });
      return;
    }

    logger.info(`Received decision reaction on ${event.item.ts} in ${event.item.channel}`);

    try {
      const channelId = event.item.channel;
      const messageTs = event.item.ts;

      // 2. Identify the root of the thread
      let rootTs = messageTs;
      
      const history = await client.conversations.history({
        channel: channelId,
        latest: messageTs,
        inclusive: true,
        limit: 1
      });

      if (history.messages && history.messages.length > 0) {
        const msg = history.messages[0];
        if (msg.thread_ts) {
          rootTs = msg.thread_ts;
        }
      }

      // 3. Fetch full thread
      const thread = await client.conversations.replies({
        channel: channelId,
        ts: rootTs
      });

      if (!thread.messages) return;

      // Combine text (User: Message)
      const threadText = (thread.messages as any[])
        .filter(m => !m.bot_id && m.subtype !== 'bot_message')
        .map(m => {
            const user = m.user || 'Unknown';
            const text = m.text || '';
            return `${user}: ${text}`;
        })
        .join('\n');

      // 4. Get Permalink first to pass to AI Service in case of error
      const permalink = await client.chat.getPermalink({
          channel: channelId,
          message_ts: rootTs
      });
      const slackLink = permalink.permalink || '';

      // 5. Generate ADR with AI
      const adrData = await aiService.generateADR(threadText, slackLink, {
        geminiApiKey: config?.geminiApiKey || undefined,
        notionDatabaseId: config?.notionDatabaseId,
        notionAccessToken: token || undefined
      });
      // 6. Create Notion Page
      const notionUrl = await notionService.createADRPage(adrData, slackLink, config?.notionDatabaseId, token || undefined);

      // 6. Post Summary to Slack
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: rootTs,
        text: `Documentation Created! :memo:\n*Title:* ${adrData.title}\n*Decision:* ${adrData.decision}\n*Notion:* <${notionUrl}|Link to ADR>`
      });

    } catch (error) {
      logger.error(error);
      if (aiService.lastErrorNotionUrl) {
        await client.chat.postMessage({
          channel: event.item.channel,
          thread_ts: event.item.ts,
          text: `AI generation failed, but error log was saved to Notion. You can manual edit it and change tag to "Ready" for recovery:\n${aiService.lastErrorNotionUrl}`
        });
      }
    }
  });

  // Slash Command: /adr-config
  app.command('/adr-config', async ({ ack, body, client, logger }) => {
    await ack();
    logger.info(`User ${body.user_id} triggered /adr-config in workspace ${body.team_id}`);

    try {
      const config = await configService.getChannelConfig(body.channel_id);
      const workspaceConfig = await configService.getWorkspaceConfig(body.team_id);
      const isConnected = !!workspaceConfig?.notionAccessToken;

      let blocks: any[] = [];

      if (!isConnected) {
        const installUrl = `${process.env.APP_URL}/notion/install?workspaceId=${body.team_id}&channelId=${body.channel_id}&userId=${body.user_id}`;
        blocks = [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '👋 こんにちは！ADR Bot を利用するには、まず Notion との連携が必要です。' }
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '以下のボタンをクリックして、Notion のワークスペースへのアクセスを許可してください（OAuth 認証）。' }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Connect to Notion 🔗' },
                url: installUrl,
                style: 'primary'
              }
            ]
          }
        ];
      } else {
        blocks = [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '✅ *Notion 連携済み*\nADR 生成のためのチャンネル設定を行います。' }
          },
          {
            type: 'divider'
          },
          {
              type: 'input',
              block_id: 'notion_url_block',
              label: { type: 'plain_text', text: 'Notion Database URL' },
              element: {
                type: 'plain_text_input',
                action_id: 'notion_url_input',
                initial_value: config?.notionDatabaseId ? `https://www.notion.so/${config.notionDatabaseId}` : '',
                placeholder: { type: 'plain_text', text: 'https://www.notion.so/...' }
              }
          },
          {
              type: 'input',
              block_id: 'gemini_key_block',
              label: { type: 'plain_text', text: 'Gemini API Key (Optional)' },
              element: {
                type: 'plain_text_input',
                action_id: 'gemini_key_input',
                initial_value: config?.geminiApiKey || '',
                placeholder: { type: 'plain_text', text: 'AI-...' }
              },
              optional: true
          },
          {
              type: 'input',
              block_id: 'emoji_block',
              label: { type: 'plain_text', text: 'Trigger Emoji' },
              element: {
                type: 'plain_text_input',
                action_id: 'emoji_input',
                initial_value: config?.triggerEmoji || 'decision',
                placeholder: { type: 'plain_text', text: 'decision' }
              }
          }
        ];
      }
      
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'config_modal_submit',
          private_metadata: JSON.stringify({ 
            channelId: body.channel_id,
            workspaceId: body.team_id 
          }), 
          title: { type: 'plain_text', text: 'ADR Bot 設定' },
          blocks: blocks,
          submit: isConnected ? { type: 'plain_text', text: '保存' } : undefined
        }
      });
    } catch (error) {
      logger.error('Failed to open modal', error);
    }
  });

  // Modal Submission: config_modal_submit
  app.view('config_modal_submit', async ({ ack, body, view, logger }) => {
    logger.info('Modal submitted, parsing metadata...');
    try {
      const { channelId, workspaceId } = JSON.parse(view.private_metadata);
      logger.info(`Channel: ${channelId}, Workspace: ${workspaceId}`);
      const values = view.state.values;
      
      const notionUrl = values.notion_url_block.notion_url_input.value;
      const notionDatabaseId = configService.extractDatabaseId(notionUrl || '');

      logger.info(`Validating database access for ID: ${notionDatabaseId}`);

      if (!notionDatabaseId) {
        await ack({
          response_action: 'errors',
          errors: { notion_url_block: '有効な Notion Database URL を入力してください。' }
        });
        return;
      }

      // Validate access
      const workspaceConfig = await configService.getWorkspaceConfig(workspaceId);
      const token = workspaceConfig?.notionAccessToken || process.env.NOTION_API_KEY;
      const isValid = await notionService.validateDatabase(notionDatabaseId, token || undefined);

      if (!isValid) {
        logger.warn(`Database validation failed for ID: ${notionDatabaseId}`);
        await ack({
          response_action: 'errors',
          errors: { notion_url_block: 'データベースにアクセスできません。Notion の「接続先」からこのアプリを追加しているか確認してください。' }
        });
        return;
      }

      await ack(); // Success
      logger.info('Modal submission acknowledged.');

      const geminiKey = values.gemini_key_block.gemini_key_input.value;
      const emoji = values.emoji_block.emoji_input.value;
      
      await configService.saveChannelConfig({
        workspaceId,
        channelId,
        notionDatabaseId,
        geminiApiKey: geminiKey || undefined,
        triggerEmoji: emoji || undefined
      });
      logger.info(`Config saved for channel ${channelId} in workspace ${workspaceId}:`, { notionDatabaseId, emoji });
    } catch (error) {
      logger.error('Error during modal submission processing:', error);
      // ack() cannot be called here if it was already called or if it timed out.
    }
  });
};
