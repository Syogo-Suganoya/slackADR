import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Client as NotionClient } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

export interface ChannelConfig {
  workspaceId: string;
  channelId: string;
  notionDatabaseId: string;
  notionDataSourceId?: string | null;
  geminiApiKey?: string | null;
  triggerEmoji?: string;
}

export class ConfigService {
  private prisma: PrismaClient;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    this.prisma = new PrismaClient({ adapter });
  }

  public async getChannelConfig(channelId: string): Promise<ChannelConfig | null> {
    try {
      const config = await this.prisma.channelConfig.findUnique({
        where: { channelId }
      });
      return config ? {
        workspaceId: config.workspaceId,
        channelId: config.channelId,
        notionDatabaseId: config.notionDatabaseId,
        notionDataSourceId: config.notionDataSourceId,
        geminiApiKey: config.geminiApiKey,
        triggerEmoji: config.triggerEmoji
      } : null;
    } catch (error) {
      console.error('Failed to read config from database:', error);
      return null;
    }
  }

  public async saveChannelConfig(config: ChannelConfig) {
    try {
      // Notion API から Data Source ID を取得
      let dataSourceId = config.notionDataSourceId;
      if (!dataSourceId && config.notionDatabaseId) {
        dataSourceId = await this.fetchDataSourceId(config.notionDatabaseId);
      }

      await this.prisma.channelConfig.upsert({
        where: { channelId: config.channelId },
        update: {
          workspaceId: config.workspaceId,
          notionDatabaseId: config.notionDatabaseId,
          notionDataSourceId: dataSourceId,
          geminiApiKey: config.geminiApiKey || null,
          triggerEmoji: config.triggerEmoji || 'decision'
        },
        create: {
          workspaceId: config.workspaceId,
          channelId: config.channelId,
          notionDatabaseId: config.notionDatabaseId,
          notionDataSourceId: dataSourceId,
          geminiApiKey: config.geminiApiKey || null,
          triggerEmoji: config.triggerEmoji || 'decision'
        }
      });
    } catch (error) {
      console.error('Failed to save config to database:', error);
    }
  }

  /**
   * Notion API から Data Source ID を取得
   */
  private async fetchDataSourceId(databaseId: string): Promise<string | null> {
    try {
      const notionApiKey = process.env.NOTION_API_KEY;
      if (!notionApiKey) {
        console.warn('NOTION_API_KEY is not set, cannot fetch data source ID');
        return null;
      }

      const notion = new NotionClient({ auth: notionApiKey });
      const database = await notion.databases.retrieve({ database_id: databaseId }) as any;
      
      if (database.data_sources && database.data_sources.length > 0) {
        const dataSourceId = database.data_sources[0].id;
        console.log(`Fetched Data Source ID: ${dataSourceId} for Database: ${databaseId}`);
        return dataSourceId;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to fetch data source ID from Notion:', error);
      return null;
    }
  }

  /**
   * Notion Database URLからIDを抽出する
   */
  public extractDatabaseId(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      
      const idMatch = lastPart.match(/[a-f0-9]{32}/);
      return idMatch ? idMatch[0] : lastPart;
    } catch (error) {
      return null;
    }
  }
}
