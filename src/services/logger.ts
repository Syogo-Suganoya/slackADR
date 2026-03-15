import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

export class LoggerService {
  private logDir: string;
  private maxLines: number;
  private prisma: PrismaClient | null = null;

  constructor(logDir: string = 'logs', maxLines: number = 1000) {
    this.logDir = path.resolve(process.cwd(), logDir);
    this.maxLines = maxLines;
    this.ensureLogDir();
    
    // Prismaの初期化
    if (process.env.DATABASE_URL) {
      try {
        const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
        this.prisma = new PrismaClient({ adapter });
      } catch (err) {
        console.error('Failed to initialize Prisma adapter in LoggerService:', err);
      }
    }
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getTodayString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getLatestLogFile(): string {
    const today = this.getTodayString();
    let index = 0;
    let fileName = `${today}.log`;
    
    while (fs.existsSync(path.join(this.logDir, fileName))) {
      try {
        const content = fs.readFileSync(path.join(this.logDir, fileName), 'utf-8');
        const lines = content.split('\n').filter(line => line.length > 0).length;
        
        if (lines < this.maxLines) {
          return fileName;
        }
      } catch (err) {
        break;
      }
      
      index++;
      fileName = `${today}_${index}.log`;
    }
    
    return fileName;
  }

  public async log(level: 'INFO' | 'WARN' | 'ERROR', message: string, ...args: any[]): Promise<void> {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args)}` : '';
    const logEntry = `[${timestamp}] [${level}] ${message}${formattedArgs}\n`;
    
    // 1. ファイル保存
    try {
      const fileName = this.getLatestLogFile();
      const filePath = path.join(this.logDir, fileName);
      fs.appendFileSync(filePath, logEntry);
    } catch (err) {
      console.error('Failed to write to log file:', err);
    }
    
    // 2. DB保存
    if (this.prisma) {
      try {
        await this.prisma.systemLog.create({
          data: {
            level,
            message,
            details: args.length > 0 ? args : undefined,
          },
        });
      } catch (dbErr) {
        console.error('Failed to save log to database:', dbErr);
      }
    }

    // 3. コンソール出力
    if (level === 'ERROR') {
      console.error(logEntry.trim());
    } else if (level === 'WARN') {
      console.warn(logEntry.trim());
    } else {
      console.log(logEntry.trim());
    }
  }

  public info(message: string, ...args: any[]): void {
    this.log('INFO', message, ...args).catch(() => {});
  }

  public warn(message: string, ...args: any[]): void {
    this.log('WARN', message, ...args).catch(() => {});
  }

  public error(message: string, ...args: any[]): void {
    this.log('ERROR', message, ...args).catch(() => {});
  }
}

export const logger = new LoggerService();
