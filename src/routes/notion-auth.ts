import { Request, Response } from 'express';
import axios from 'axios';
import { ConfigService } from '../services/config';

const configService = new ConfigService();

/**
 * 1. Notion 連携開始 (Slack からのリダイレクト先)
 * GET /auth/notion?workspace_id=...
 */
export const handleNotionAuthStart = async (req: Request, res: Response) => {
  const workspaceId = req.query.workspace_id as string;
  if (!workspaceId) {
    return res.status(400).send('workspace_id is required');
  }

  const clientId = process.env.NOTION_CLIENT_ID;
  const redirectUri = process.env.NOTION_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).send('OAuth configuration missing');
  }

  // state に workspace_id を含めて Notion に送る
  const state = encodeURIComponent(JSON.stringify({ workspaceId }));
  const authUrl = `https://api.notion.com/v1/oauth/authorize?owner=user&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;

  res.redirect(authUrl);
};

/**
 * 2. Notion からのリダイレクト受け取り
 * GET /notion/callback?code=...&state=...
 */
export const handleNotionCallback = async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const stateStr = req.query.state as string;

  if (!code || !stateStr) {
    return res.status(400).send('Missing code or state');
  }

  try {
    const { workspaceId } = JSON.parse(decodeURIComponent(stateStr));
    
    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    const redirectUri = process.env.NOTION_REDIRECT_URI;

    // Notion トークン交換
    const response = await axios.post('https://api.notion.com/v1/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    });

    const { access_token, bot_id, owner } = response.data;

    // DB に保存
    await configService.saveWorkspaceConfig({
      workspaceId,
      notionAccessToken: access_token,
      notionBotId: bot_id,
      notionOwner: owner
    });

    res.send('Notion 連携が完了しました！この画面を閉じて Slack に戻ってください。');
  } catch (error: any) {
    console.error('Notion OAuth Error:', error.response?.data || error.message);
    res.status(500).send('Notion 連携に失敗しました。');
  }
};
