import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import { ADRData } from './ai';

dotenv.config();

export class NotionService {
  private notion: Client;
  private databaseId: string;
  private dataSourceId: string;

  constructor(token?: string, customDatabaseId?: string) {
    this.notion = new Client({ auth: token || process.env.NOTION_API_KEY });
    this.databaseId = customDatabaseId || process.env.NOTION_DATABASE_ID || '';
    this.dataSourceId = process.env.NOTION_DATASOURCE_ID || '';
    
    if (!this.databaseId) {
        console.error('NOTION_DATABASE_ID is not set!');
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
        console.error("Failed to create Notion page:", error);
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

    try {
        const response = await this.notion.pages.create({
            parent: { database_id: targetDatabaseId },
            properties: {
                Name: {
                    title: [
                        {
                            text: {
                                content: `Error Log: ${timestamp}`,
                            },
                        },
                    ],
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
    } catch(error) {
        console.error("Failed to create Notion error log page:", error);
        throw error;
    }
  }

  public async processReadyLogs(): Promise<void> {
    if (!this.databaseId) return;

    try {
        console.log(` Querying pages with "Ready" tag via dataSource: ${this.dataSourceId}...`);
        const response = await (this.notion as any).dataSources.query({
            data_source_id: this.dataSourceId,
            filter: {
                property: 'Tags',
                multi_select: {
                    contains: 'Ready'
                }
            }
        });

        const readyPages = (response as any).results;

        console.log(`Found ${readyPages.length} pages to process.`);

        for (const page of readyPages) {
            await this.handleReadyPage(page);
        }

    } catch (error) {
        console.error("Error processing ready logs:", error);
    }
  }

  private async handleReadyPage(page: any): Promise<void> {
    try {
        const readyPageUrl = page.url;
        console.log(`Processing Ready page: ${readyPageUrl}`);

        // 1. Get SlackLink
        const slackLink = page.properties.SlackLink?.url || '';
        
        // 2. Get the JSON block
        const blocks = await this.notion.blocks.children.list({ block_id: page.id });
        const jsonBlock = blocks.results.find((b: any) => b.type === 'code' && b.code.language === 'json');

        if (!jsonBlock) {
            console.warn(`No JSON block found in page ${page.id}`);
            return;
        }

        const jsonText = (jsonBlock as any).code.rich_text.map((t: any) => t.plain_text).join('');
        const adrData = JSON.parse(jsonText) as ADRData;

        // 3. Create real ADR page
        const newUrl = await this.createADRPage(adrData, slackLink);
        console.log(`✅ Created ADR Page: ${newUrl}`);

        // 4. Archive old page
        await this.notion.pages.update({
            page_id: page.id,
            archived: true
        });
        console.log(`🗑️  Archived Ready page: ${readyPageUrl}`);

    } catch (error) {
        console.error(`Failed to handle ready page ${page.id}:`, error);
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
      console.error('Failed to list Notion databases:', error);
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
      console.error(`Database validation failed for ${databaseId}:`, error);
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
