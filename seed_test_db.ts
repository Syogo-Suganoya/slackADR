import { ConfigService } from './src/services/config';

const config = new ConfigService();
async function seed() {
  const workspaceId = 'T_TEST_WORKSPACE';
  const channelId = 'C_TEST_CHANNEL';
  const notionAccessToken = process.env.NOTION_API_KEY || '';
  const notionDatabaseId = process.env.NOTION_DATABASE_ID || '';

  if (!notionAccessToken || !notionDatabaseId) {
    console.error('NOTION_API_KEY or NOTION_DATABASE_ID is missing in .env');
    return;
  }

  await config.saveWorkspaceConfig({
    workspaceId,
    notionAccessToken
  });

  await config.saveChannelConfig({
    workspaceId,
    channelId,
    notionDatabaseId
  });

  console.log('Seed completed with Workspace:', workspaceId, 'and Database:', notionDatabaseId);
}
seed();
