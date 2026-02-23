import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as mariadb from 'mariadb';
import dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
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
