import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import dotenv from 'dotenv';
import { NotionService } from './notion';

dotenv.config();

export interface ADRData {
  title: string;
  tags: string[];
  status?: string;
  context: string;
  decision: string;
  drivers?: string[];
  alternatives_considered?: { option: string, decision: string, reasoning: string }[];
  consequences: string | string[];
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    } else {
      console.warn('GEMINI_API_KEY is not set. AI Service will operate in fallback mode.');
    }
    this.notion = new NotionService();
  }

  public async generateADR(threadText: string, slackLink: string): Promise<ADRData> {
    this.lastErrorNotionUrl = null;
    if (!this.genAI) {
      throw new Error('AI API Key is missing. Please check GEMINI_API_KEY environment variable.');
    }

    const prompt = `${this.systemPrompt}\n\nHere is the Slack conversation:\n\n${threadText}`;

    try {
      const model = this.genAI.getGenerativeModel({
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
      console.error('Error in AIService.generateADR:', error.message || error);
      
      // Save full prompt to Notion on error for manual processing
      try {
        this.lastErrorNotionUrl = await this.saveErrorToNotion(prompt, slackLink);
      } catch (innerErr) {
        console.error('Failed to save to Notion after AI error:', innerErr);
      }
      
      throw error;
    }
  }


  private async saveErrorToNotion(prompt: string, slackLink: string): Promise<string | null> {
    try {
      const url = await this.notion.createErrorLogPage(prompt, slackLink);
      console.log(`💾 Error prompt saved to Notion: ${url}`);
      return url;
    } catch (err) {
      console.error('Failed to save error prompt to Notion:', err);
      return null;
    }
  }
}
