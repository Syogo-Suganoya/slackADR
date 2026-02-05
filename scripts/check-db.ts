import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const installations = await (prisma as any).slackInstallation.findMany();
  console.log('Installations count:', installations.length);
  installations.forEach((inst: any) => {
    console.log(`Team: ${inst.teamId}, BotUserId: ${inst.botUserId}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
