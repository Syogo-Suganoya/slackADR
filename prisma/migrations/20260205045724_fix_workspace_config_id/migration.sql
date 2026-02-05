-- CreateTable
CREATE TABLE "WorkspaceConfig" (
    "workspaceId" TEXT NOT NULL,
    "notionAccessToken" TEXT,
    "notionBotId" TEXT,
    "notionOwner" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceConfig_pkey" PRIMARY KEY ("workspaceId")
);
