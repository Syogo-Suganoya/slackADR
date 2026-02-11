import * as fs from 'fs';
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
    const logData = `[${new Date().toISOString()}] Received reaction: ${event.reaction} from ${event.user} in ${event.item.channel}\n`;
    fs.appendFileSync('debug.log', logData);
    logger.info(`Received reaction: ${event.reaction} from ${event.user} in ${event.item.channel}`);

    // 1. Check config
    const workspaceId = (body as any).team_id;
    const config = await configService.getChannelConfig(event.item.channel);
    const workspaceConfig = await configService.getWorkspaceConfig(workspaceId);
    
    const channelToken = config?.notionAccessToken;
    const workspaceToken = workspaceConfig?.notionAccessToken;
    const token = channelToken || workspaceToken;
    const triggerEmoji = config?.triggerEmoji || 'decision';

    const configLog = `[DEBUG] triggerEmoji=${triggerEmoji}, channelToken=${channelToken ? 'EXISTS' : 'MISSING'}, workspaceToken=${workspaceToken ? 'EXISTS' : 'MISSING'}, databaseId=${config?.notionDatabaseId}\n`;
    fs.appendFileSync('debug.log', configLog);

    if (event.reaction !== triggerEmoji) {
      fs.appendFileSync('debug.log', `[DEBUG] Reaction ${event.reaction} ignored (expected: ${triggerEmoji} in channel ${event.item.channel})\n`);
      return;
    }

    if (!token) {
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: ':warning: Notion 連携が完了していません。`/adr-config` から Notion と連携してください。'
      });
      return;
    }

    if (!config?.notionDatabaseId) {
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: ':warning: Notion データベースが設定されていません。`/adr-config` から設定を行ってください。'
      });
      return;
    }

    logger.info(`Received decision reaction on ${event.item.ts} in ${event.item.channel}`);

    try {
      const channelId = event.item.channel;
      const messageTs = event.item.ts;

      fs.appendFileSync('debug.log', `[DEBUG] Fetching root message for ${messageTs} in ${channelId}\n`);
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

      fs.appendFileSync('debug.log', `[DEBUG] Root TS: ${rootTs}, Fetching replies...\n`);

      // 3. Fetch thread replies
      const replies = await client.conversations.replies({
        channel: channelId,
        ts: rootTs
      });

      if (!replies.messages || replies.messages.length === 0) {
        fs.appendFileSync('debug.log', `[ERROR] No messages found in thread ${rootTs}\n`);
        throw new Error('No messages found in thread');
      }

      fs.appendFileSync('debug.log', `[DEBUG] Found ${replies.messages.length} messages in thread. Filtering...\n`);

      // Filter: Exclude bot messages and Notion creation notifications
      const botUserId = (await client.auth.test()).user_id;
      const filteredMessages = replies.messages.filter(msg => {
        // Exclude messages from THIS bot
        if (msg.user === botUserId) return false;
        // Exclude Notion interaction notifications (usually start with "Created Notion article")
        if (msg.text && msg.text.includes('Notion 記事を作成しました')) return false;
        if (msg.text && msg.text.includes('Notion 記事の作成に失敗しました')) return false;
        return true;
      });

      if (filteredMessages.length === 0) {
          await client.chat.postMessage({
              channel: channelId,
              thread_ts: messageTs,
              text: 'スレッド内に処理対象のメッセージ（Bot以外の発言）が見つかりませんでした。'
          });
          return;
      }

      // 4. Generate ADR with AI
      const threadText = filteredMessages.map(m => `<@${m.user}>: ${m.text}`).join('\n');
      const slackLink = `https://slack.com/archives/${channelId}/p${messageTs.replace('.', '')}`;
      fs.appendFileSync('debug.log', `[DEBUG] Generating ADR with AI. threadText length: ${threadText.length}\n`);
      const adrData = await aiService.generateADR(threadText, slackLink, {
        geminiApiKey: config?.geminiApiKey || undefined,
        notionDatabaseId: config?.notionDatabaseId || undefined,
        notionAccessToken: token || undefined
      });

      fs.appendFileSync('debug.log', `[DEBUG] ADR generated. Title: ${adrData.title}. Creating Notion page...\n`);

      // 5. Create Notion page using the specific token and databaseId
      // Create a temporary Notion instance for this request
      const notion = new NotionService(token, config.notionDatabaseId!);
      const notionPage = await notion.createADRPage(adrData, slackLink);

      fs.appendFileSync('debug.log', `[DEBUG] Notion page created: ${notionPage}\n`);

      // 6. Reply to Slack
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `✅ Notion 記事を作成しました！\n${notionPage}`
      });

    } catch (error: any) {
      fs.appendFileSync('debug.log', `[ERROR] reaction_added handler failed: ${error.message || error}\n`);
      if (error.data && error.data.response_metadata) {
        fs.appendFileSync('debug.log', `[ERROR] Slack error details: ${JSON.stringify(error.data.response_metadata.messages)}\n`);
      }
      logger.error(error);
      // Use the error message from AIService directly if it exists, as it now contains the Notion URL or a clean failure message.
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: error.message || '❌ AI generation failed (Unknown error).'
      });
    }
  });

  // Slash Command: /adr-config
  app.command('/adr-config', async ({ ack, body, client, logger }) => {
    await ack();
    const logData = `[${new Date().toISOString()}] Command /adr-config triggered by ${body.user_id} in channel ${body.channel_id}\n`;
    fs.appendFileSync('debug.log', logData);
    logger.info(`User ${body.user_id} triggered /adr-config in workspace ${body.team_id}`);

    try {
      const config = await configService.getChannelConfig(body.channel_id);
      const workspaceConfig = await configService.getWorkspaceConfig(body.team_id);
      const isConnected = !!(config?.notionAccessToken || workspaceConfig?.notionAccessToken);
      
      fs.appendFileSync('debug.log', `[DEBUG] /adr-config: isConnected=${isConnected}\n`);

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
        const installUrl = `${process.env.APP_URL}/notion/install?workspaceId=${body.team_id}&channelId=${body.channel_id}&userId=${body.user_id}`;
        blocks = [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `✅ *Notion 連携済み*\nADR 生成のためのチャンネル設定を行います。\n\n> 💡 *別のデータベースを使いたい場合や、アクセスできない場合は*\n> <${installUrl}|こちらをクリックして Notion の権限を追加してください>。` }
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
                  placeholder: { type: 'plain_text', text: 'https://www.notion.so/...' },
                  initial_value: config?.notionDatabaseId ? `https://www.notion.so/${config.notionDatabaseId.replace(/-/g, '')}` : ''
              },
              hint: { type: 'plain_text', text: '連携したい Notion データベースの URL を入力してください。' }
          },
          {
              type: 'input',
              block_id: 'gemini_api_key_block',
              optional: true,
              label: { type: 'plain_text', text: 'Gemini API Key (Optional)' },
              element: {
                  type: 'plain_text_input',
                  action_id: 'gemini_api_key_input',
                  placeholder: { type: 'plain_text', text: 'AIZA...' },
                  initial_value: config?.geminiApiKey || ''
              },
              hint: { type: 'plain_text', text: '個別の API キーを使用する場合は入力してください。空の場合は共通のキーを使用します。' }
          },
          {
              type: 'input',
              block_id: 'trigger_emoji_block',
              label: { type: 'plain_text', text: 'Trigger Emoji' },
              element: {
                  type: 'plain_text_input',
                  action_id: 'trigger_emoji_input',
                  placeholder: { type: 'plain_text', text: 'decision' },
                  initial_value: config?.triggerEmoji || 'decision'
              },
              hint: { type: 'plain_text', text: 'ADR 生成のトリガーとなる絵文字名を入力してください（例: decision）。コロンは不要です。' }
          }
        ];
      }

      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'adr_config_modal',
          private_metadata: JSON.stringify({ channel_id: body.channel_id }),
          title: { type: 'plain_text', text: 'ADR Bot Config' },
          blocks: blocks,
          submit: isConnected ? { type: 'plain_text', text: 'Save' } : undefined,
          close: { type: 'plain_text', text: 'Cancel' }
        }
      });

    } catch (error: any) {
      logger.error('Failed to open modal:', error);
      if (error.data && error.data.response_metadata) {
        logger.error('Slack error details:', JSON.stringify(error.data.response_metadata.messages));
      }
    }
  });

  // Modal Submission: adr_config_modal
  app.view('adr_config_modal', async ({ ack, body, view, logger }) => {
    await ack();
    const { channel_id } = JSON.parse(view.private_metadata);
    const notionUrl = view.state.values.notion_url_block.notion_url_input.value;
    const geminiApiKey = view.state.values.gemini_api_key_block.gemini_api_key_input.value;
    const triggerEmoji = view.state.values.trigger_emoji_block.trigger_emoji_input.value;

    const databaseId = configService.extractDatabaseId(notionUrl || '');

    if (!databaseId) {
      // Should ideally use ack with errors, but for simplicity:
      logger.error('Invalid Notion URL');
      return;
    }

    try {
      if (!body.team) {
        logger.error('Workspace information (team) is missing');
        return;
      }

      await configService.saveChannelConfig({
        workspaceId: body.team.id,
        channelId: channel_id,
        notionDatabaseId: databaseId,
        geminiApiKey: geminiApiKey,
        triggerEmoji: triggerEmoji || 'decision'
      });
      logger.info(`Config saved for channel ${channel_id}`);
    } catch (error) {
      logger.error(error);
    }
  });
};
