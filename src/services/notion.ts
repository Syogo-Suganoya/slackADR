import { Client } from '@notionhq/client';
import { WebClient } from '@slack/web-api';
import dotenv from 'dotenv';
import { ADRData } from './ai';
import { ConfigService } from './config';
import { logger } from './logger';

dotenv.config();

export class NotionService {
  private notion: Client;
  private databaseId: string;
  private dataSourceId: string;

  constructor(token?: string, customDatabaseId?: string) {
    this.notion = new Client({ auth: token || process.env.NOTION_API_KEY || '' });
    this.databaseId = customDatabaseId || process.env.NOTION_DATABASE_ID || '';
    this.dataSourceId = process.env.NOTION_DATASOURCE_ID || '';
    
    if (!this.databaseId) {
        logger.error('NOTION_DATABASE_ID is not set!');
    }
    if (!this.dataSourceId) {
        console.warn('NOTION_DATASOURCE_ID is not set!');
    }
  }

  private cleanText(text: any): string {
    if (typeof text !== 'string') {
      return String(text || '');
    }
    // Remove Markdown bold/italic markers
    return text.replace(/\*\*|_/g, '');
  }

  private formatKey(key: string): string {
    // Replace underscores with spaces and insert space before capital letters (for snake_case/camelCase)
    const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    // Capitalize first letter and everything else to lowercase (except maybe acronyms, but simple for now)
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  }

  private buildBlocksRecursive(data: any, level: number = 2): any[] {
    const blocks: any[] = [];
    const maxLevel = 3; // Notion supports h1, h2, h3. Usage above h3 will fall back to paragraph or bulleted list.

    if (Array.isArray(data)) {
        data.forEach(item => {
            if (typeof item === 'object' && item !== null) {
                blocks.push(...this.buildBlocksRecursive(item, level));
            } else {
                blocks.push({
                    bulleted_list_item: {
                        rich_text: [{ text: { content: this.cleanText(item) } }]
                    }
                });
            }
        });
    } else if (typeof data === 'object' && data !== null) {
        Object.entries(data).forEach(([key, value]) => {
            // Skip title and tags as they are handled as page properties
            if (level === 2 && (key === 'title' || key === 'tags' || key === 'status' || key === 'manualPrompt')) return;

            // Heading for the key
            const headingType = `heading_${Math.min(level, maxLevel)}` as any;
            blocks.push({
                [headingType]: {
                    rich_text: [{ text: { content: this.formatKey(key) } }]
                }
            });

            // Content for the value
            if (typeof value === 'object' && value !== null) {
                blocks.push(...this.buildBlocksRecursive(value, level + 1));
            } else {
                blocks.push({
                    paragraph: {
                        rich_text: [{ text: { content: this.cleanText(value) } }]
                    }
                });
            }
        });
    }
    return blocks;
  }

  public async createADRPage(adr: ADRData, slackLink: string, overrideDatabaseId?: string, overrideToken?: string): Promise<string> {
    if (overrideToken) {
        this.notion = new Client({ auth: overrideToken });
    }
    const targetDatabaseId = overrideDatabaseId || this.databaseId;
    if (!targetDatabaseId) {
        throw new Error('Notion Database ID is missing.');
    }

    // Construct blocks
    const children: any[] = [];

    // Status (Callout) - Keep as a special header item
    if (adr.status) {
        children.push({
            callout: {
                rich_text: [{ text: { content: `Status: ${adr.status}` } }],
                icon: { emoji: '📌' },
                color: 'blue_background'
            }
        });
    }

    // Dynamic content from other fields
    children.push(...this.buildBlocksRecursive(adr, 2));

    children.push({ divider: {} });

    children.push({ divider: {} });

    // Footer
    children.push({
        paragraph: {
            rich_text: [
                { text: { content: 'Original Slack Thread: ' } },
                { text: { content: slackLink, link: { url: slackLink } } }
            ],
        },
    });

    if (adr.manualPrompt) {
        children.push(
            { heading_3: { rich_text: [{ text: { content: '⚠️ AI Generation Fallback' }}] } },
            {
                code: {
                    rich_text: [{ text: { content: adr.manualPrompt } }],
                    language: 'markdown'
                }
            }
        )
    }

    try {
        const response = await this.notion.pages.create({
            parent: { database_id: targetDatabaseId },
            properties: {
                Name: {
                    title: [{ text: { content: adr.title } }],
                },
                Tags: {
                    multi_select: adr.tags.map(tag => ({ name: tag })),
                },
                "SlackLink": {
                    url: slackLink || null
                }
            } as any,
            children: children,
        });
        
        return (response as any).url;
    } catch(error) {
        logger.error("Failed to create Notion page:", error);
        throw error;
    }
  }

  public async createErrorLogPage(prompt: string, slackLink: string, overrideDatabaseId?: string, overrideToken?: string): Promise<string> {
    if (overrideToken) {
        this.notion = new Client({ auth: overrideToken });
    }
    const targetDatabaseId = overrideDatabaseId || this.databaseId;
    if (!targetDatabaseId) {
        throw new Error('Notion Database ID is missing.');
    }

    const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
    
    const children: any[] = [
        {
            heading_2: {
                rich_text: [{ text: { content: 'Prompt at Error' } }],
            },
        },
        {
            code: {
                rich_text: [{ text: { content: prompt } }],
                language: 'markdown'
            }
        },
        {
            divider: {}
        },
        {
            heading_2: {
                rich_text: [{ text: { content: 'JSON Summary Input' } }]
            }
        },
        {
            paragraph: {
                rich_text: [{ text: { content: 'Please paste the AI-generated JSON here from your browser, then change the Tag to "Ready".' } }]
            }
        },
        {
            code: {
                rich_text: [{ text: { content: '{\n  "title": "",\n  "status": "Accepted",\n  "context": "",\n  "decision": "",\n  "consequences": [],\n  "tags": []\n}' } }],
                language: 'json'
            }
        }
    ];

    let targetDbId = targetDatabaseId;
    const findExistingPage = async (client: Client, dbId: string): Promise<string | null> => {
        try {
            const response = await (client as any).databases.query({
                database_id: dbId,
                filter: {
                    property: 'SlackLink',
                    url: {
                        equals: slackLink
                    }
                },
                page_size: 1
            });
            return response.results.length > 0 ? response.results[0].id : null;
        } catch {
            return null;
        }
    };

    const updatePage = async (client: Client, pageId: string) => {
        // Update properties
        await client.pages.update({
            page_id: pageId,
            properties: {
                Name: {
                    title: [{ text: { content: `Error Log: ${timestamp}` } }],
                },
                Tags: {
                    multi_select: [{ name: 'Pending' }],
                }
            } as any
        });

        // Delete old blocks
        const existingBlocks = await client.blocks.children.list({ block_id: pageId });
        for (const block of existingBlocks.results) {
            await client.blocks.delete({ block_id: block.id });
        }

        // Append new blocks
        await client.blocks.children.append({
            block_id: pageId,
            children: children
        });
        
        return (await client.pages.retrieve({ page_id: pageId }) as any).url;
    };

    const tryCreateOrUpdate = async (client: Client, dbId: string, isFallback: boolean = false): Promise<string | null> => {
        try {
            const existingPageId = await findExistingPage(client, dbId);
            if (existingPageId) {
                return await updatePage(client, existingPageId);
            } else {
                const response = await client.pages.create({
                    parent: { database_id: dbId },
                    properties: {
                        Name: {
                            title: [{ text: { content: `Error Log${isFallback ? ' (Fallback)' : ''}: ${timestamp}` } }],
                        },
                        Tags: {
                            multi_select: [{ name: 'Pending' }],
                        },
                        "SlackLink": {
                            url: slackLink || null
                        }
                    } as any,
                    children: children,
                });
                return (response as any).url;
            }
        } catch (e: any) {
            return null;
        }
    };

    try {
        let url = await tryCreateOrUpdate(this.notion, targetDbId);
        
        // If initial attempt failed, try to find ANY database accessible with THIS token
        if (!url && overrideToken) {
            const bestDbId = await this.findBestDatabase(overrideToken);
            if (bestDbId && bestDbId !== targetDbId) {
                url = await tryCreateOrUpdate(this.notion, bestDbId);
            }
        }

        if (url) {
            return url;
        }
        
        throw new Error(`Failed to create page in target or alternative databases.`);
    } catch(error: any) {
        // Final Fallback to internal credentials
        if (overrideDatabaseId || overrideToken) {
            try {
                const internalToken = process.env.NOTION_API_KEY || '';
                const internalDbId = process.env.NOTION_DATABASE_ID || '';
                if (!internalDbId || !internalToken) throw new Error('Internal Notion credentials are not configured.');

                const internalClient = new Client({ auth: internalToken });
                let fallbackUrl = await tryCreateOrUpdate(internalClient, internalDbId);

                // If internal specific DB failed, try ANY DB accessible with internal token
                if (!fallbackUrl) {
                    const bestInternalDbId = await this.findBestDatabase(internalToken);
                    if (bestInternalDbId && bestInternalDbId !== internalDbId) {
                        fallbackUrl = await tryCreateOrUpdate(internalClient, bestInternalDbId);
                    }
                }

                if (fallbackUrl) {
                    return fallbackUrl;
                }
            } catch (fallbackError: any) {
                // Ignore fallback error
            }
        }
        
        throw error;
    }
  }

  public async processReadyLogs(configService: ConfigService, installationStore?: any): Promise<void> {
    try {
        console.log('🔄 Starting recovery process with OAuth tokens...');
        const channelConfigs = await configService.getAllChannelConfigs();
        console.log(`Checking ${channelConfigs.length} registered channels/databases.`);

        const processedDatabases = new Set<string>();

        for (const config of channelConfigs) {
            const databaseId = config.notionDatabaseId;
            if (!databaseId) continue;
            if (processedDatabases.has(databaseId)) continue;

            const workspaceConfig = await configService.getWorkspaceConfig(config.workspaceId);
            const token = config.notionAccessToken || workspaceConfig?.notionAccessToken;

            if (!token) {
                console.warn(`Skipping channel ${config.channelId} for database ${databaseId}: No Notion access token found.`);
                continue;
            }

            processedDatabases.add(databaseId);
            const notion = new Client({ auth: token });
            let dataSourceId = config.notionDataSourceId;

            try {
                // If dataSourceId is missing, try to fetch it
                if (!dataSourceId) {
                    const db = await notion.databases.retrieve({ database_id: databaseId }) as any;
                    if (db.data_sources && db.data_sources.length > 0) {
                        dataSourceId = db.data_sources[0].id;
                    }
                }

                if (!dataSourceId) {
                    console.warn(`Skipping database ${databaseId}: No data source ID found.`);
                    continue;
                }

                const response = await (notion as any).dataSources.query({
                    data_source_id: dataSourceId,
                    filter: {
                        property: 'Tags',
                        multi_select: {
                            contains: 'Ready'
                        }
                    }
                });

                const readyPages = response.results;
                if (readyPages.length > 0) {
                    console.log(`Found ${readyPages.length} ready pages in database ${databaseId}`);
                    for (const page of readyPages) {
                        try {
                            // Pass the token and databaseId explicitly
                            await this.handleReadyPage(page, token, databaseId, configService, installationStore); 
                        } catch (e) {
                            logger.error(`Failed to process page ${page.id}:`, e);
                        }
                    }
                }

            } catch (dbError) {
                logger.error(`Error querying database ${databaseId}:`, dbError);
            }
        }
    } catch (error) {
        logger.error("Error processing ready logs:", error);
    }
  }

  private async handleReadyPage(page: any, token: string, databaseId: string, configService: ConfigService, installationStore?: any): Promise<void> {
      // Need to use the correct token for operations
      const notion = new Client({ auth: token });
    try {
        const readyPageUrl = page.url;
        console.log(`Processing Ready page: ${readyPageUrl}`);

        // 1. Get SlackLink
        const slackLink = page.properties.SlackLink?.url || '';
        
        // 2. Get the JSON block
        const blocks = await notion.blocks.children.list({ block_id: page.id });
        const jsonBlock = blocks.results.find((b: any) => b.type === 'code' && b.code.language === 'json');

        if (!jsonBlock) {
            console.warn(`No JSON block found in page ${page.id}`);
            return;
        }

        const jsonText = (jsonBlock as any).code.rich_text.map((t: any) => t.plain_text).join('');
        const adrData = JSON.parse(jsonText) as ADRData;

        // 3. Create real ADR page
        const newUrl = await this.createADRPage(adrData, slackLink, databaseId, token);
        console.log(`✅ Created ADR Page: ${newUrl}`);

        // 4. Notify Slack if installationStore and slackLink are available
        if (installationStore && slackLink) {
            try {
                // Extract channel and ts from link (removing queries/fragments)
                const cleanLink = slackLink.split('?')[0].split('#')[0];
                console.log(`🔗 Parsing Slack link: ${cleanLink}`);
                const parts = cleanLink.split('/');
                if (parts.length >= 2) {
                    const lastPart = parts[parts.length - 1] === '' ? parts[parts.length - 2] : parts[parts.length - 1];
                    const channelPart = parts[parts.length - 1] === '' ? parts[parts.length - 3] : parts[parts.length - 2];
                    
                    if (channelPart && lastPart.startsWith('p')) {
                        const tsRaw = lastPart.substring(1);
                        const ts = tsRaw.substring(0, 10) + '.' + tsRaw.substring(10);
                        const channelId = channelPart;

                        const targetConfig = await configService.getChannelConfig(channelId);
                        if (!targetConfig || !targetConfig.workspaceId) {
                            console.warn(`⚠️ No workspace config found for parsed channelId: ${channelId}`);
                        } else {
                            const workspaceId = targetConfig.workspaceId;
                            console.log(`📡 Attempting Slack notification: channel=${channelId}, ts=${ts}, workspace=${workspaceId}`);

                            // Satisfy the InstallationQuery type explicitly
                            const installation = await installationStore.fetchInstallation({ 
                                teamId: workspaceId,
                                enterpriseId: undefined,
                                userId: undefined,
                                isEnterpriseInstall: false
                            });
                            const botToken = installation.bot?.token;
                            
                            if (botToken) {
                                const slackClient = new WebClient(botToken);
                                
                                // 診断情報の取得
                                try {
                                    const auth = await slackClient.auth.test();
                                    console.log(`🤖 Bot Identity: user=${auth.user}, userId=${auth.user_id}, team=${auth.team}, teamId=${auth.team_id}`);

                                    // チャンネル情報の取得
                                    const info = await slackClient.conversations.info({ channel: channelId });
                                    console.log(`📍 Channel Info: name=${info.channel?.name}, is_member=${info.channel?.is_member}, is_private=${info.channel?.is_private}`);

                                    if (!info.channel?.is_member && !info.channel?.is_private) {
                                        console.log(`🤝 Bot is not in public channel ${channelId}. Attempting to join...`);
                                        await slackClient.conversations.join({ channel: channelId });
                                    }
                                } catch (diagError: any) {
                                    console.warn(`⚠️ Could not fetch diagnostic info: ${diagError.message}`);
                                }

                                await slackClient.chat.postMessage({
                                    channel: channelId,
                                    thread_ts: ts,
                                    text: `✅ 【Recovery】 I've created a Notion article!\n${newUrl}`
                                });
                                console.log(`📢 Slack notification sent to ${channelId} (${ts})`);
                            }
                        }
                    } else {
                        console.warn(`⚠️ Could not parse channel or ts: ${slackLink}`);
                    }
                }
            } catch (slackError) {
                logger.error('Failed to send Slack notification:', slackError);
            }
        }

        // 5. Archive old page
        await notion.pages.update({
            page_id: page.id,
            archived: true
        });
        console.log(`🗑️  Archived Ready page: ${readyPageUrl}`);

    } catch (error) {
        logger.error(`Failed to handle ready page ${page.id}:`, error);
    }
  }

  public async listDatabases(token: string): Promise<{ id: string, title: string }[]> {
    const notion = new Client({ auth: token });
    try {
      const response = await notion.search({
        filter: {
          value: 'database',
          property: 'object'
        } as any,
        page_size: 100
      });

      return (response.results as any[]).map(db => {
        // Extract title from database properties
        const titleItems = db.title || [];
        const title = titleItems.length > 0 ? titleItems[0].plain_text : 'Untitled Database';
        return {
          id: db.id,
          title: title
        };
      });
    } catch (error) {
      logger.error('Failed to list Notion databases:', error);
      return [];
    }
  }

  public async findBestDatabase(token: string): Promise<string | null> {
    const databases = await this.listDatabases(token);
    if (databases.length === 0) return null;

    // 1. Look for a database with "ADR" in the title
    const adrDb = databases.find(db => db.title.toUpperCase().includes('ADR'));
    if (adrDb) return adrDb.id;

    // 2. Fallback to the first database found
    return databases[0].id;
  }

  public async validateDatabase(databaseId: string, token?: string): Promise<boolean> {
    const notion = token ? new Client({ auth: token }) : this.notion;
    try {
      await notion.databases.retrieve({ database_id: databaseId });
      return true;
    } catch (error) {
      logger.error(`Database validation failed for ${databaseId}:`, error);
      return false;
    }
  }

  public getAuthorizationUrl(state: string): string {
    const clientId = process.env.NOTION_CLIENT_ID;
    const redirectUri = process.env.NOTION_REDIRECT_URI;
    
    if (!clientId || !redirectUri) {
        throw new Error('Notion Client ID or Redirect URI is missing in environment variables.');
    }

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        owner: 'user',
        redirect_uri: redirectUri,
        state: state
    });

    return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  }

  public async exchangeAuthCode(code: string): Promise<any> {
    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    const redirectUri = process.env.NOTION_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error('Notion Client ID/Secret/RedirectURI is missing.');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch('https://api.notion.com/v1/oauth/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to exchange Notion token: ${error}`);
    }

    return await response.json();
  }
}
