import * as fs from 'fs';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';
import { NotionService } from './notion';

dotenv.config();

export interface ADRData {
  title: string;
  tags: string[];
  status?: string;
  date?: string;
  deciders?: string[];
  context: string;
  decision: string;
  drivers?: string[];
  alternatives_considered?: (string | { option: string, decision: string, reasoning: string })[];
  consequences: string | string[] | { positive?: string[], negative?: string[] };
  manualPrompt?: string;
}

export class AIService {
  private genAI: GoogleGenerativeAI | null = null;
  private notion: NotionService;
  public lastErrorNotionUrl: string | null = null;
  private readonly systemPrompt = `
You are an expert software architect.
Your goal is to extract an Architecture Decision Record (ADR) from a Slack conversation thread.
Generate relevant tags (e.g., "Frontend", "Database", "Security", "UX") based on the discussion content.
Output strictly valid JSON.
Do NOT use Markdown formatting (like **, _, [links], etc.) in any of the JSON string values. Output plain text only.
  `;

  constructor() {
    this.notion = new NotionService();
  }

  public async generateADR(threadText: string, slackLink: string, overrideConfig?: { geminiApiKey?: string, notionDatabaseId?: string, notionAccessToken?: string }): Promise<ADRData> {
    this.lastErrorNotionUrl = null;
    
    // Construct prompt first to save it in case of error
    const prompt = `${this.systemPrompt}\n\nHere is the Slack conversation:\n\n${threadText}`;

    let genAI: GoogleGenerativeAI | null = null;
    
    if (overrideConfig?.geminiApiKey) {
      genAI = new GoogleGenerativeAI(overrideConfig.geminiApiKey);
    }

    if (!genAI) {
      fs.appendFileSync('debug.log', `[WARN] Gemini API Key is missing. Creating Error Log page in Notion...\n`);
      try {
        this.lastErrorNotionUrl = await this.saveErrorToNotion(prompt, slackLink, overrideConfig?.notionDatabaseId, overrideConfig?.notionAccessToken);
        if (this.lastErrorNotionUrl) {
          fs.appendFileSync('debug.log', `[DEBUG] Notion error log created: ${this.lastErrorNotionUrl}\n`);
        } else {
          fs.appendFileSync('debug.log', `[ERROR] Notion error log creation returned null (possibly caught internal error)\n`);
        }
      } catch (e: any) {
        fs.appendFileSync('debug.log', `[ERROR] Failed to create Error Log page: ${e.message || e}\n`);
      }
      
      if (this.lastErrorNotionUrl) {
        throw new Error(`AI generation failed, but error log was saved to Notion. You can manually edit it and change tag to "Ready" for recovery:\n${this.lastErrorNotionUrl}`);
      } else {
        throw new Error('AI generation failed and Notion error logging also failed. Please check Notion permissions.');
      }
    }

    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING },
              tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              status: { type: SchemaType.STRING },
              context: { type: SchemaType.STRING },
              decision: { type: SchemaType.STRING },
              drivers: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              alternatives_considered: { 
                type: SchemaType.ARRAY, 
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    option: { type: SchemaType.STRING },
                    decision: { type: SchemaType.STRING },
                    reasoning: { type: SchemaType.STRING }
                  },
                  required: ["option", "decision", "reasoning"]
                }
              },
              consequences: { 
                type: SchemaType.ARRAY, 
                items: { type: SchemaType.STRING }
              }
            },
            required: ["title", "tags", "context", "decision", "consequences"]
          }
        }
      });

      const result = await model.generateContent(prompt);
      const content = result.response.text();

      if (!content) throw new Error('Empty response from AI');

      const parsed = JSON.parse(content) as ADRData;
      return parsed;
    } catch (error: any) {
      fs.appendFileSync('debug.log', `[ERROR] Error in AIService.generateADR: ${error.message || error}\n`);
      
      // Save full prompt to Notion on error for manual processing
      try {
        fs.appendFileSync('debug.log', `[DEBUG] Saving error prompt to Notion...\n`);
        this.lastErrorNotionUrl = await this.saveErrorToNotion(prompt, slackLink, overrideConfig?.notionDatabaseId, overrideConfig?.notionAccessToken);
        fs.appendFileSync('debug.log', `[DEBUG] Notion error log created after AI error: ${this.lastErrorNotionUrl}\n`);
      } catch (innerErr: any) {
        fs.appendFileSync('debug.log', `[ERROR] Failed to save to Notion after AI error: ${innerErr.message || innerErr}\n`);
      }
      
      throw error;
    }
  }


  private async saveErrorToNotion(prompt: string, slackLink: string, overrideDatabaseId?: string, notionAccessToken?: string): Promise<string | null> {
    try {
      const url = await this.notion.createErrorLogPage(prompt, slackLink, overrideDatabaseId, notionAccessToken);
      console.log(`💾 Error prompt saved to Notion: ${url}`);
      return url;
    } catch (err) {
      console.error('Failed to save error prompt to Notion:', err);
      return null;
    }
  }
}
