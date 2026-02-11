import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  try {
    const configs = await prisma.channelConfig.findMany();
    console.log('ChannelConfigs:', JSON.stringify(configs, null, 2));
    const workspaces = await prisma.workspaceConfig.findMany();
    console.log('WorkspaceConfigs:', JSON.stringify(workspaces, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
