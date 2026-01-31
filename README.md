# Slack ADR Bot & Notion Recovery

Slack の会話からアーキテクチャ意思決定記録 (ADR) を自動生成し、Notion で管理するためのツールです。
AI (Gemini) を使用して議論を要約し、データベース化します。

## 🌟 主な機能
- **Slack 連携**: スレッドの `:decision:` リアクションで ADR 作成を開始。
- **AI 自動解析**: Gemini API が議論をコンテキスト、決定事項、影響に分類。
- **Notion 管理**: 整形された ADR を Notion データベースに保存。
- **自動リカバリー**: AI 解析に失敗した場合も Notion にログを残し、後から一括リカバリー可能。
