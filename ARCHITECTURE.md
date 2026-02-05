# System Architecture

This document describes the system configuration and operating principles of the Slack ADR Bot.

## 1. System Overview

This diagram shows the end-to-end flow from when a discussion occurs in a Slack thread until the ADR is generated and saved in Notion.

```mermaid
graph TD
    User([User]) -- "Adds :decision: after discussion" --> Slack[Slack Workspace]
    Slack -- "Reaction Event" --> Bot[Slack ADR Bot]
    
    subgraph Bot [Slack ADR Bot]
        direction TB
        Handler[Slack Event Handler]
        AI[AI Service]
        Notion[Notion Service]
        DB[(PostgreSQL)]
    end
    
    Handler -- "Check config" --> DB
    Handler -- "Fetch thread" --> Slack
    Handler -- "Request summary" --> AI
    AI -- "Send prompt" --> Gemini[Gemini API]
    Gemini -- "JSON" --> AI
    AI -- "Request page creation" --> Notion
    Notion -- "API Call" --> NotionAPI[Notion API]
    NotionAPI -- "Create ADR" --> NotionDB[(Notion Database)]
    
    Notion -- "Return URL" --> Handler
    Handler -- "Success notification" --> Slack
```

## 2. Component Diagram

The internal components of the system and their external dependencies.

```mermaid
classDiagram
    class Index {
        +ExpressReceiver receiver
        +App app
    }
    class SlackHandler {
        +registerSlackHandlers(app)
    }
    class AIService {
        +generateADR(thread, link, config)
        -saveErrorToNotion(prompt, link)
    }
    class NotionService {
        +createADRPage(adr, link)
        +processReadyLogs()
        +validateDatabase(id)
    }
    class ConfigService {
        +getChannelConfig(channelId)
        +saveChannelConfig(config)
    }

    Index --> SlackHandler : Register
    SlackHandler --> AIService : Generate Summary
    SlackHandler --> NotionService : Create Page
    SlackHandler --> ConfigService : Get Config
    AIService --> NotionService : Save Error Log
    ConfigService --> Prisma : DB Access
```

## 3. Sequence Diagram

Details of the successful ADR generation flow and the error recovery flow.

```mermaid
sequenceDiagram
    participant U as User
    participant S as Slack
    participant B as Bot (Server)
    participant A as Gemini API
    participant N as Notion API

    %% Success Case
    Note over U, N: Success Flow
    U->>S: Reaction (:decision:)
    S->>B: reaction_added event
    B->>S: conversations.replies (Fetch thread)
    B->>A: generateContent (Prompt)
    A-->>B: ADR JSON data
    B->>N: pages.create (Create ADR)
    N-->>B: Notion page URL
    B->>S: chat.postMessage (Success notification)

    %% Error Recovery Flow
    Note over U, N: Error Recovery Flow
    B->>A: generateContent (Fail)
    A-->>B: "Error (Quota etc.)"
    B->>N: "pages.create (Create error log)"
    B->>S: "chat.postMessage (Error notification & Log URL)"
    U->>N: "Manually paste JSON & Change Tag to \"Ready\""
    Note over B: Batch process every 5 minutes (GitHub Actions)
    B->>N: "dataSources.query (Detect \"Ready\")"
    N-->>B: Page details
    B->>N: "pages.create (Create ADR & Archive old page)"
    B->>S: chat.postMessage (Success notification)
```

## 4. Data Model (ER Diagram)

The structure of the database managed by Prisma.

```mermaid
erDiagram
    SlackInstallation ||--o{ ChannelConfig : "manages"
    WorkspaceConfig ||--o{ ChannelConfig : "configures"

    SlackInstallation {
        Int id PK
        String teamId UK
        String botToken
        String appId
        DateTime updatedAt
    }

    WorkspaceConfig {
        String workspaceId PK
        String notionAccessToken
        Json notionOwner
        DateTime updatedAt
    }

    ChannelConfig {
        Int id PK
        String workspaceId FK
        String channelId UK
        String notionDatabaseId
        String triggerEmoji
        DateTime updatedAt
    }
```
