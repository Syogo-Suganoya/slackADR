import { App } from '@slack/bolt';
import { AIService } from '../services/ai';
import { NotionService } from '../services/notion';
import { WebClient } from '@slack/web-api';

const aiService = new AIService();
const notionService = new NotionService();

export const registerSlackHandlers = (app: App) => {
  app.event('reaction_added', async ({ event, client, logger }) => {
    // 1. Check for specific emoji
    if (event.reaction !== 'decision') {
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
      const threadText = thread.messages
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
      const adrData = await aiService.generateADR(threadText, slackLink);

      // 6. Create Notion Page
      const notionUrl = await notionService.createADRPage(adrData, slackLink);

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
    logger.info(`User ${body.user_id} triggered /adr-config`);

    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'config_modal_submit',
          title: { type: 'plain_text', text: 'ADR Bot 設定' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'ADR 生成のための基本設定を行います。' }
            },
            {
              type: 'input',
              block_id: 'notion_url_block',
              label: { type: 'plain_text', text: 'Notion Database URL' },
              element: {
                type: 'plain_text_input',
                action_id: 'notion_url_input',
                placeholder: { type: 'plain_text', text: 'https://www.notion.so/...' }
              }
            },
            {
              type: 'input',
              block_id: 'gemini_key_block',
              label: { type: 'plain_text', text: 'Gemini API Key' },
              element: {
                type: 'plain_text_input',
                action_id: 'gemini_key_input',
                initial_value: process.env.GEMINI_API_KEY || '',
                placeholder: { type: 'plain_text', text: 'AI-...' }
              }
            },
            {
              type: 'input',
              block_id: 'emoji_block',
              label: { type: 'plain_text', text: 'Trigger Emoji' },
              element: {
                type: 'plain_text_input',
                action_id: 'emoji_input',
                initial_value: 'decision',
                placeholder: { type: 'plain_text', text: 'decision' }
              }
            }
          ],
          submit: { type: 'plain_text', text: '保存' }
        }
      });
    } catch (error) {
      logger.error('Failed to open modal', error);
    }
  });

  // Modal Submission: config_modal_submit
  app.view('config_modal_submit', async ({ ack, body, view, logger }) => {
    await ack();
    const values = view.state.values;
    const notionUrl = values.notion_url_block.notion_url_input.value;
    const geminiKey = values.gemini_key_block.gemini_key_input.value;
    const emoji = values.emoji_block.emoji_input.value;

    logger.info('Config submitted:', { notionUrl, geminiKey, emoji });

    // TODO: 将来的にはここで入力された値をワークスペースIDごとにDBへ保存する
    // 目前はログ表示のみで動作確認とする
  });
};
