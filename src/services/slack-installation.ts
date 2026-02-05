import { Installation, InstallationStore } from '@slack/bolt';
import { PrismaClient } from '@prisma/client';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export class SlackInstallationStore implements InstallationStore {
  async storeInstallation<AuthVersion extends 'v1' | 'v2'>(
    installation: Installation<AuthVersion, boolean>
  ): Promise<void> {
    const data = {
      teamId: installation.team?.id,
      enterpriseId: installation.enterprise?.id,
      userId: installation.user.id,
      botToken: installation.bot?.token,
      botId: installation.bot?.id,
      botUserId: installation.bot?.userId,
      botScopes: installation.bot?.scopes?.join(','),
      userToken: installation.user.token,
      userScopes: installation.user.scopes?.join(','),
      incomingWebhookUrl: installation.incomingWebhook?.url,
      incomingWebhookChannelId: installation.incomingWebhook?.channelId,
      appId: installation.appId,
      tokenType: installation.tokenType,
      isEnterpriseInstall: installation.isEnterpriseInstall,
    };

    await (prisma as any).slackInstallation.upsert({
      where: { teamId: installation.team?.id || '' },
      update: data,
      create: data,
    });
  }

  async fetchInstallation(installQuery: {
    teamId?: string;
    enterpriseId?: string;
    userId?: string;
    isEnterpriseInstall?: boolean;
  }): Promise<Installation> {
    const record = await (prisma as any).slackInstallation.findUnique({
      where: { teamId: installQuery.teamId || '' },
    });

    if (!record) {
      throw new Error('Installation not found');
    }

    return {
      team: record.teamId ? { id: record.teamId, name: '' } : undefined,
      enterprise: record.enterpriseId ? { id: record.enterpriseId, name: '' } : undefined,
      user: {
        id: record.userId || '',
        token: record.userToken || undefined,
        scopes: record.userScopes ? record.userScopes.split(',') : undefined,
      },
      bot: record.botToken ? {
        token: record.botToken,
        id: record.botId || '',
        userId: record.botUserId || '',
        scopes: record.botScopes ? record.botScopes.split(',') : [],
      } : undefined,
      incomingWebhook: record.incomingWebhookUrl ? {
        url: record.incomingWebhookUrl,
        channelId: record.incomingWebhookChannelId || undefined,
      } : undefined,
      appId: record.appId || undefined,
      tokenType: (record.tokenType as 'bot') || undefined,
      isEnterpriseInstall: record.isEnterpriseInstall,
    };
  }

  async deleteInstallation(installQuery: {
    teamId?: string;
    enterpriseId?: string;
    userId?: string;
    isEnterpriseInstall?: boolean;
  }): Promise<void> {
    await (prisma as any).slackInstallation.delete({
      where: { teamId: installQuery.teamId || '' },
    });
  }
}
