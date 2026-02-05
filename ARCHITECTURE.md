# System Architecture

このドキュメントでは、Slack ADR Bot のシステム構成と動作原理について説明します。

## 1. システム全体像 (System Overview)

Slack スレッドから ADR が生成され、Notion に保存されるまでの全体的なフローです。

```mermaid
graph TD
    User([ユーザー]) -- "議論後、:decision: を追加" --> Slack[Slack Workspace]
    Slack -- "Reaction Event" --> Bot[Slack ADR Bot]
    
    subgraph Bot [Slack ADR Bot]
        direction TB
        Handler[Slack Event Handler]
        AI[AI Service]
        Notion[Notion Service]
        DB[(PostgreSQL)]
    end
    
    Handler -- "config 確認" --> DB
    Handler -- "スレッド取得" --> Slack
    Handler -- "要約依頼" --> AI
    AI -- "プロンプト送信" --> Gemini[Gemini API]
    Gemini -- "JSON" --> AI
    AI -- "ページ作成依頼" --> Notion
    Notion -- "API Call" --> NotionAPI[Notion API]
    NotionAPI -- "ADR作成" --> NotionDB[(Notion Database)]
    
    Notion -- "URL返却" --> Handler
    Handler -- "完了通知" --> Slack
```

## 2. コンポーネント構成 (Component Diagram)

システムの内部コンポーネントと外部依存関係の構成です。

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

    Index --> SlackHandler : 登録
    SlackHandler --> AIService : 要約生成
    SlackHandler --> NotionService : ページ作成
    SlackHandler --> ConfigService : 設定取得
    AIService --> NotionService : エラーログ保存
    ConfigService --> Prisma : DBアクセス
```

## 3. シーケンス図 (Sequence Diagram)

ADR 生成の成功フローと、エラー時のリカバリーフローの詳細です。

```mermaid
sequenceDiagram
    participant U as User
    participant S as Slack
    participant B as Bot (Server)
    participant A as Gemini API
    participant N as Notion API

    %% 成功ケース
    Note over U, N: 正常系フロー
    U->>S: リアクション (:decision:)
    S->>B: reaction_added イベント
    B->>S: conversations.replies (スレッド取得)
    B->>A: generateContent (プロンプト)
    A-->>B: ADR JSON データ
    B->>N: pages.create (ADR生成)
    N-->>B: Notion ページ URL
    B->>S: chat.postMessage (完了通知)

    %% エラーリカバリーフロー
    Note over U, N: エラーリカバリーフロー
    B->>A: generateContent (失敗)
    A-->>B: "Error (Quota etc.)"
    B->>N: "pages.create (エラーログ作成)"
    B->>S: "chat.postMessage (エラー通知 & ログURL)"
    U->>N: "手動で JSON 貼付 & Tag を \"Ready\" に変更"
    Note over B: 5分ごとのバッチ処理 (GitHub Actions)
    B->>N: "dataSources.query (\"Ready\" 検知)"
    N-->>B: ページ詳細
    B->>N: "pages.create (ADR生成 & 旧ページアーカイブ)"
    B->>S: chat.postMessage (完了通知)
```

## 4. データモデル (ER Diagram)

Prisma で管理されているデータベースの構造です。

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
