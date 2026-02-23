import { ChannelConfig } from './config';

export const buildConfigBlocks = (
  isConnected: boolean,
  config: ChannelConfig | null,
  body: { team_id: string; channel_id: string; user_id: string },
  appUrl: string,
  externalId?: string
) => {
  const installUrl = `${appUrl}/notion/install?workspaceId=${body.team_id}&channelId=${body.channel_id}&userId=${body.user_id}${externalId ? `&externalId=${externalId}` : ''}`;
  
  if (!isConnected) {
    return [
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
    return [
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
        hint: { type: 'plain_text', text: '個別の API キーを使用する場合は入力してください。' }
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
};
