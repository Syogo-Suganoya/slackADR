# Contributing to Slack ADR Bot

First off, thank you for considering contributing to Slack ADR Bot! It's people like you that make Slack ADR Bot such a great tool.

## How Can I Contribute?

### Reporting Bugs
This section guides you through submitting a bug report. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related bugs.

Before creating bug reports, please check if there is already an existing issue that reports the same problem.

### Suggesting Enhancements
This section guides you through submitting an enhancement suggestion, including completely new features and minor improvements to existing functionality.

### Pull Requests
- Fork the repository and create your branch from `main`.
- If you've added code that should be tested, add tests.
- If you've changed APIs, update the documentation.
- Ensure the test suite passes.
- Make sure your code lints.

## Local Development

### Prerequisites
- Node.js >= 18.0.0
- Docker & Docker Compose
- Slack App (Create your own)
- Notion Integration (Create your own)
- Gemini API Key (Get from Google AI Studio)

### Setup Instructions
1. **Clone the repository**:
   ```sh
   git clone https://github.com/Syogo-Suganoya/slackADR.git
   cd slackADR
   ```

2. **Install dependencies**:
   ```sh
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in your own API keys and tokens.
   ```sh
   cp .env.example .env
   ```
   > [!IMPORTANT]
   > **You must create your own Slack App and Notion Integration.** Shared API keys are not provided. Please refer to `README.md` for specific property requirements of the Notion database.

4. **Start Infrastructure**:
   ```sh
   docker-compose up -d
   ```

5. **Prisma Migrations**:
   ```sh
   npx prisma migrate dev
   ```

6. **Run Development Server**:
   ```sh
   npm run dev
   ```

### Debugging with ngrok
To receive Slack events locally:
```sh
ngrok http 3000
```
Update your Slack App's Request URL with the ngrok URL (e.g., `https://xxxx.ngrok.io/slack/events`).

## Code of Conduct
Please be respectful and considerate of others when contributing to this project.
