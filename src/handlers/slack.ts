import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { AIService } from '../services/ai';
import { NotionService } from '../services/notion';
import { ConfigService } from '../services/config';
import { buildConfigBlocks } from '../services/slack-ui';

const aiService = new AIService();
const notionService = new NotionService();
const configService = new ConfigService();
const CONFIG_COMMAND = `/adr-config${process.env.SLACK_COMMAND_SUFFIX || ''}`;

export const registerSlackHandlers = (app: App) => {
  app.event('reaction_added', async ({ event, client, logger, body }) => {
    logger.info(`Received reaction: ${event.reaction} from ${event.user} in ${event.item.channel}`);

    // 1. Check config
    const config = await configService.getChannelConfig(event.item.channel);
    
    const token = config?.notionAccessToken;
    const triggerEmoji = config?.triggerEmoji || 'decision';

    // Check for trigger emoji

    if (event.reaction !== triggerEmoji) {
      return;
    }

    if (!token) {
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: `:warning: Notion 連携が完了していません。\`${CONFIG_COMMAND}\` から Notion と連携してください。`
      });
      return;
    }

    if (!config?.notionDatabaseId) {
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: `:warning: Notion データベースが設定されていません。\`${CONFIG_COMMAND}\` から設定を行ってください。`
      });
      return;
    }

    logger.info(`Received decision reaction on ${event.item.ts} in ${event.item.channel}`);

    try {
      const channelId = event.item.channel;
      const messageTs = event.item.ts;

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

      // 3. Fetch thread replies
      const replies = await client.conversations.replies({
        channel: channelId,
        ts: rootTs
      });

      if (!replies.messages || replies.messages.length === 0) {
        throw new Error('No messages found in thread');
      }

      // Filter: Exclude bot messages and Notion creation notifications
      const auth = await client.auth.test();
      const botUserId = auth.user_id;
      const teamUrl = auth.url || 'https://slack.com/'; // e.g. "https://my-team.slack.com/"
      
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
      const slackLink = `${teamUrl.replace(/\/$/, '')}/archives/${channelId}/p${messageTs.replace('.', '')}`;
      const adrData = await aiService.generateADR(threadText, slackLink, {
        geminiApiKey: config?.geminiApiKey || undefined,
        notionDatabaseId: config?.notionDatabaseId || undefined,
        notionAccessToken: token || undefined
      });

      // 5. Create Notion page using the specific token and databaseId
      // Create a temporary Notion instance for this request
      const notion = new NotionService(token, config.notionDatabaseId!);
      const notionPage = await notion.createADRPage(adrData, slackLink);

      // 6. Reply to Slack
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `✅ I've created a Notion article!\n${notionPage}`
      });

    } catch (error: any) {
      logger.error(error);
      // Use the error message from AIService directly if it exists, as it now contains the Notion URL or a clean failure message.
      await client.chat.postMessage({
        channel: event.item.channel,
        thread_ts: event.item.ts,
        text: error.message || '❌ AI generation failed (Unknown error).'
      });
    }
  });

  app.command(CONFIG_COMMAND as any, async ({ ack, body, client, logger }) => {
    await ack();

    // Perform heavy lifting in an async block without awaiting to avoid Slack timeout
    (async () => {
      logger.info(`User ${body.user_id} triggered /adr-config in workspace ${body.team_id}`);

      try {
        // Check if bot is in channel
        let isMember = false;
        let isScopeError = false;
        try {
          const channelInfo = await client.conversations.info({
            channel: body.channel_id
          });
          isMember = !!channelInfo.channel?.is_member;
        } catch (error: any) {
          const errorCode = error.data?.error || error.message;
          if (errorCode === 'missing_scope') {
            isScopeError = true;
          } else if (errorCode === 'not_in_channel') {
            isMember = false;
          } else {
            // Log other errors and continue with isMember = false
            logger.error('Unexpected error in conversations.info:', error);
            isMember = false;
          }
        }
        
        if (isScopeError) {
          await client.chat.postEphemeral({
            channel: body.channel_id,
            user: body.user_id,
            text: `:warning: ADR Bot の権限が不足しています。アプリの設定で \`channels:read\` と \`groups:read\` スコープを追加し、ワークスペースにアプリを再インストール（許可）してください。`
          });
          return;
        }

        if (!isMember) {
          await client.chat.postEphemeral({
            channel: body.channel_id,
            user: body.user_id,
            text: `:warning: このチャンネルで初期設定を行うには、まず ADR Bot をチャンネルに追加（招待）してください。\n右上の「詳細」>「アプリ」から、または \`/invite @ADR Bot\` で追加してください。`
          });
          return;
        }

        const config = await configService.getChannelConfig(body.channel_id);
        const isConnected = !!config?.notionAccessToken;
        const externalId = `adr_config_${body.channel_id}_${body.user_id}`;

        const blocks = buildConfigBlocks(
          isConnected,
          config,
          { team_id: body.team_id, channel_id: body.channel_id, user_id: body.user_id },
          process.env.APP_URL || '',
          externalId
        );

        await client.views.open({
          trigger_id: body.trigger_id,
          view: {
            type: 'modal',
            callback_id: 'adr_config_modal',
            external_id: externalId,
            private_metadata: JSON.stringify({ channel_id: body.channel_id }),
            title: { type: 'plain_text', text: 'slackADR Config' },
            blocks: blocks,
            submit: isConnected ? { type: 'plain_text', text: 'Save' } : undefined,
            close: { type: 'plain_text', text: 'Cancel' }
          }
        });
      } catch (error: any) {
        logger.error('Failed to handle /adr-config in background:', error);
      }
    })().catch(err => logger.error('Error in /adr-config background IIFE:', err));
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
