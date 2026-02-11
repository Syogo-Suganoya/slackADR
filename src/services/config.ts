import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Client as NotionClient } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

export interface ChannelConfig {
  workspaceId: string;
  channelId: string;
  notionDatabaseId?: string | null;
  notionDataSourceId?: string | null;
  geminiApiKey?: string | null;
  triggerEmoji?: string;
  notionAccessToken?: string | null;
  notionBotId?: string | null;
}

export interface WorkspaceConfig {
  workspaceId: string;
  notionAccessToken?: string | null;
  notionBotId?: string | null;
  notionOwner?: any;
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
        triggerEmoji: config.triggerEmoji,
        notionAccessToken: config.notionAccessToken,
        notionBotId: config.notionBotId
      } : null;
    } catch (error) {
      console.error('Failed to read config from database:', error);
      return null;
    }
  }

  public async getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig | null> {
    try {
      const config = await this.prisma.workspaceConfig.findUnique({
        where: { workspaceId }
      });
      return config ? {
        workspaceId: config.workspaceId,
        notionAccessToken: config.notionAccessToken,
        notionBotId: config.notionBotId,
        notionOwner: config.notionOwner
      } : null;
    } catch (error) {
      console.error('Failed to read workspace config from database:', error);
      return null;
    }
  }

  public async getAllChannelConfigs(): Promise<ChannelConfig[]> {
    try {
      const configs = await this.prisma.channelConfig.findMany();
      return configs.map(config => ({
        workspaceId: config.workspaceId,
        channelId: config.channelId,
        notionDatabaseId: config.notionDatabaseId,
        notionDataSourceId: config.notionDataSourceId,
        geminiApiKey: config.geminiApiKey,
        triggerEmoji: config.triggerEmoji,
        notionAccessToken: config.notionAccessToken,
        notionBotId: config.notionBotId
      }));
    } catch (error) {
      console.error('Failed to read all channel configs:', error);
      return [];
    }
  }

  public async saveChannelConfig(config: ChannelConfig) {
    try {
      // Notion API から Data Source ID を取得
      let dataSourceId = config.notionDataSourceId;
      if (!dataSourceId && config.notionDatabaseId) {
        // トークンが必要なため、WorkspaceConfig も取得する
        const workspaceConfig = await this.getWorkspaceConfig(config.workspaceId);
        const token = workspaceConfig?.notionAccessToken || process.env.NOTION_API_KEY;
        
        if (token) {
           dataSourceId = await this.fetchDataSourceId(config.notionDatabaseId, token);
        }
      }

      await this.prisma.channelConfig.upsert({
        where: { channelId: config.channelId },
        update: {
          workspaceId: config.workspaceId,
          notionDatabaseId: config.notionDatabaseId ?? null,
          notionDataSourceId: dataSourceId,
          geminiApiKey: config.geminiApiKey ?? null,
          triggerEmoji: config.triggerEmoji || 'decision',
          notionAccessToken: config.notionAccessToken ?? null,
          notionBotId: config.notionBotId ?? null
        } as any,
        create: {
          workspaceId: config.workspaceId,
          channelId: config.channelId,
          notionDatabaseId: config.notionDatabaseId ?? null,
          notionDataSourceId: dataSourceId,
          geminiApiKey: config.geminiApiKey ?? null,
          triggerEmoji: config.triggerEmoji || 'decision',
          notionAccessToken: config.notionAccessToken ?? null,
          notionBotId: config.notionBotId ?? null
        } as any
      });
    } catch (error) {
      console.error('Failed to save config to database:', error);
    }
  }

  public async saveWorkspaceConfig(config: WorkspaceConfig) {
    try {
      await this.prisma.workspaceConfig.upsert({
        where: { workspaceId: config.workspaceId },
        update: {
          notionAccessToken: config.notionAccessToken,
          notionBotId: config.notionBotId,
          notionOwner: config.notionOwner as any
        },
        create: {
          workspaceId: config.workspaceId,
          notionAccessToken: config.notionAccessToken,
          notionBotId: config.notionBotId,
          notionOwner: config.notionOwner as any
        }
      });
    } catch (error) {
      console.error('Failed to save workspace config to database:', error);
    }
  }

  /**
   * Notion API から Data Source ID を取得
   */
  private async fetchDataSourceId(databaseId: string, token: string): Promise<string | null> {
    try {
      const notion = new NotionClient({ auth: token });
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
