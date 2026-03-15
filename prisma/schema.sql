-- CreateTable
CREATE TABLE `ChannelConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workspaceId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `notionDatabaseId` VARCHAR(191) NULL,
    `geminiApiKey` VARCHAR(191) NULL,
    `triggerEmoji` VARCHAR(191) NOT NULL DEFAULT 'decision',
    `updatedAt` DATETIME(3) NOT NULL,
    `notionDataSourceId` VARCHAR(191) NULL,
    `notionAccessToken` VARCHAR(191) NULL,
    `notionBotId` VARCHAR(191) NULL,

    UNIQUE INDEX `ChannelConfig_channelId_key`(`channelId`),
    INDEX `ChannelConfig_workspaceId_idx`(`workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkspaceConfig` (
    `workspaceId` VARCHAR(191) NOT NULL,
    `notionAccessToken` VARCHAR(191) NULL,
    `notionBotId` VARCHAR(191) NULL,
    `notionOwner` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`workspaceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SlackInstallation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `teamId` VARCHAR(191) NULL,
    `enterpriseId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `botToken` VARCHAR(191) NULL,
    `botId` VARCHAR(191) NULL,
    `botUserId` VARCHAR(191) NULL,
    `botScopes` VARCHAR(191) NULL,
    `userToken` VARCHAR(191) NULL,
    `userScopes` VARCHAR(191) NULL,
    `incomingWebhookUrl` VARCHAR(191) NULL,
    `incomingWebhookChannelId` VARCHAR(191) NULL,
    `appId` VARCHAR(191) NULL,
    `tokenType` VARCHAR(191) NULL,
    `isEnterpriseInstall` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SlackInstallation_teamId_key`(`teamId`),
    INDEX `SlackInstallation_teamId_idx`(`teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `level` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SystemLog_level_idx`(`level`),
    INDEX `SystemLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
