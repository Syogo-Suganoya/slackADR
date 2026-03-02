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
        text: { type: 'mrkdwn', text: "👋 Hi! To use slackADR, you first need to connect with Notion." }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Please click the button below to authorize access to your Notion workspace (OAuth).' }
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
        text: { type: 'mrkdwn', text: `✅ *Notion Connected*\nConfigure the channel settings for ADR generation.\n\n> 💡 *If you want to use a different database or can't access it*\n> <${installUrl}|Click here to add Notion permissions>.` }
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
        hint: { type: 'plain_text', text: 'Enter the URL of the Notion database you want to link.' }
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
        hint: { type: 'plain_text', text: 'Enter your individual API key if you wish to use one.' }
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
        hint: { type: 'plain_text', text: 'Enter the emoji name that triggers ADR generation (e.g., decision). No colons needed.' }
      }
    ];
  }
};
