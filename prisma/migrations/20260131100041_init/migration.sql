-- CreateTable
CREATE TABLE "ChannelConfig" (
    "id" SERIAL NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "notionDatabaseId" TEXT NOT NULL,
    "geminiApiKey" TEXT,
    "triggerEmoji" TEXT NOT NULL DEFAULT 'decision',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConfig_channelId_key" ON "ChannelConfig"("channelId");

-- CreateIndex
CREATE INDEX "ChannelConfig_workspaceId_idx" ON "ChannelConfig"("workspaceId");
