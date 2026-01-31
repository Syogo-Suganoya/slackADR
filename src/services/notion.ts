import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import { ADRData } from './ai';

dotenv.config();

export class NotionService {
  private notion: Client;
  private databaseId: string;
  private dataSourceId: string;

  constructor() {
    this.notion = new Client({ auth: process.env.NOTION_API_KEY });
    this.databaseId = process.env.NOTION_DATABASE_ID || '';
    this.dataSourceId = process.env.NOTION_DATASOURCE_ID || '';
    
    if (!this.databaseId) {
        console.error('NOTION_DATABASE_ID is not set!');
    }
    if (!this.dataSourceId) {
        console.warn('NOTION_DATASOURCE_ID is not set!');
    }
  }

  private cleanText(text: string): string {
    // Remove Markdown bold/italic markers
    return text.replace(/\*\*|_/g, '');
  }

  public async createADRPage(adr: ADRData, slackLink: string): Promise<string> {
    if (!this.databaseId) {
        throw new Error('Notion Database ID is missing.');
    }

    // Construct blocks
    const children: any[] = [];

    // Status (Callout)
    if (adr.status) {
        children.push({
            callout: {
                rich_text: [{ text: { content: `Status: ${adr.status}` } }],
                icon: { emoji: '📌' },
                color: 'blue_background'
            }
        });
    }

    // Context
    children.push(
        { heading_2: { rich_text: [{ text: { content: 'Context' } }] } },
        { paragraph: { rich_text: [{ text: { content: this.cleanText(adr.context) } }] } }
    );

    // Decision
    children.push(
        { heading_2: { rich_text: [{ text: { content: 'Decision' } }] } },
        { paragraph: { rich_text: [{ text: { content: this.cleanText(adr.decision) } }] } }
    );

    // Drivers
    if (adr.drivers && adr.drivers.length > 0) {
        children.push({ heading_2: { rich_text: [{ text: { content: 'Drivers' } }] } });
        adr.drivers.forEach(driver => {
            children.push({
                bulleted_list_item: {
                    rich_text: [{ text: { content: this.cleanText(driver) } }]
                }
            });
        });
    }

    // Alternatives Considered
    if (adr.alternatives_considered && adr.alternatives_considered.length > 0) {
        children.push({ heading_2: { rich_text: [{ text: { content: 'Alternatives Considered' } }] } });
        adr.alternatives_considered.forEach(alt => {
            children.push(
                {
                    heading_3: {
                        rich_text: [{ text: { content: `${this.cleanText(alt.option)} (${this.cleanText(alt.decision)})` } }]
                    }
                },
                {
                    paragraph: {
                        rich_text: [{ text: { content: this.cleanText(alt.reasoning) } }]
                    }
                }
            );
        });
    }

    // Consequences
    children.push({ heading_2: { rich_text: [{ text: { content: 'Consequences' } }] } });
    if (Array.isArray(adr.consequences)) {
        adr.consequences.forEach(cons => {
            children.push({
                bulleted_list_item: {
                    rich_text: [{ text: { content: this.cleanText(cons) } }]
                }
            });
        });
    } else {
        children.push({ paragraph: { rich_text: [{ text: { content: this.cleanText(adr.consequences) } }] } });
    }

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
            parent: { database_id: this.databaseId },
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

  public async createErrorLogPage(prompt: string, slackLink: string): Promise<string> {
    if (!this.databaseId) {
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
            parent: { database_id: this.databaseId },
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
}
