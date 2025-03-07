# Backlify

Backlify is an AI-powered no-code backend service generator that allows users to create fully functional REST APIs without writing code. Simply describe your backend requirements in natural language, and Backlify will automatically generate and deploy your API.

## Features

- 🤖 AI-powered schema generation from natural language descriptions (OpenAI or Mistral AI)
- 🔄 Automatic REST API endpoint creation
- 🗄️ Supabase database integration
- 🚀 One-click deployment to Vercel
- 🔐 Built-in JWT authentication
- 📝 Automatic API documentation
- 🔄 Version control and rollback capabilities

## Getting Started

### Prerequisites

- Node.js 16 or higher
- Supabase account
- Vercel account
- OpenAI API key or Mistral AI API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/backlify.git
cd backlify
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Fill in your environment variables in `.env`:
```
PORT=3000
NODE_ENV=development
JWT_SECRET=your_jwt_secret

# AI Provider Configuration
# Options: 'openai' or 'mistral'
AI_PROVIDER=mistral

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Mistral AI Configuration
MISTRAL_API_KEY=your_mistral_api_key
MISTRAL_MODEL=mistral-small-latest

SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
VERCEL_TOKEN=your_vercel_token
PROJECT_ID=your_project_id
```

5. Start the development server:
```bash
npm run dev
```

## Usage

### Creating a New Backend

1. Send a POST request to `/api/projects` with your backend description:
```json
{
  "prompt": "Create a blog API with posts and comments. Posts should have a title, content, and author. Comments should have content and be linked to posts.",
  "ai_provider": "mistral"
}
```

2. Backlify will:
   - Analyze your prompt using the specified AI provider
   - Generate appropriate database schema
   - Create necessary API endpoints
   - Deploy the backend to Vercel
   - Return the deployment URL and API documentation

### Managing Your Backend

- View project details: GET `/api/projects/:id`
- Update project: PUT `/api/projects/:id`
- Delete project: DELETE `/api/projects/:id`
- List deployments: GET `/api/deployments/project/:projectId`
- Rollback deployment: POST `/api/deployments/:id/rollback`

## AI Providers

Backlify supports multiple AI providers for interpreting your prompts:

### OpenAI (Default)

Uses OpenAI's GPT models for interpreting prompts and generating schemas. Provides high-quality results but may be more expensive.

### Mistral AI

Uses Mistral AI's models as an alternative to OpenAI. May offer cost benefits while still providing good quality schema generation.

To switch between providers:
1. Set the `AI_PROVIDER` in your `.env` file to your default choice
2. Specify the `ai_provider` in your API requests to override the default

## API Documentation

### Authentication Endpoints

- POST `/api/auth/register` - Register new user
- POST `/api/auth/login` - Login user
- GET `/api/auth/me` - Get current user
- POST `/api/auth/logout` - Logout user
- POST `/api/auth/reset-password` - Request password reset

### Project Endpoints

- POST `/api/projects` - Create new project
- GET `/api/projects/:id` - Get project details
- PUT `/api/projects/:id` - Update project
- DELETE `/api/projects/:id` - Delete project

### Deployment Endpoints

- GET `/api/deployments/:id` - Get deployment status
- POST `/api/deployments` - Trigger new deployment
- GET `/api/deployments/project/:projectId` - List project deployments
- POST `/api/deployments/:id/rollback` - Rollback to previous deployment

## Architecture

Backlify uses a modular architecture with the following components:

- **AI Services**: Interprets natural language prompts and generates database schemas (OpenAI or Mistral AI)
- **Supabase Service**: Handles database operations and schema management
- **Deployment Service**: Manages project generation and deployment to Vercel
- **Authentication**: JWT-based authentication using Supabase Auth

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, please open an issue in the GitHub repository or contact the maintainers.

## Supabase Setup

Backlify uses Supabase as its database. Follow these steps to set up Supabase for your project:

1. Create a Supabase account at [supabase.com](https://supabase.com) if you don't have one already.

2. Create a new project in Supabase.

3. Get your Supabase URL and API key from the project settings:
   - Go to Project Settings > API
   - Copy the "Project URL" and "anon/public" key
   - These are your `SUPABASE_URL` and `SUPABASE_KEY` respectively

4. Add them to your `.env` file:
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

5. Run the setup script to create the necessary tables and functions:
   - Go to the SQL Editor in your Supabase dashboard
   - Copy the contents of `setup/supabase-setup.sql` from this repository
   - Paste it into the SQL Editor and run it
   - This script will:
     - Create the `execute_sql` function that allows executing SQL statements
     - Create the `refresh_schema_cache` function to refresh the schema cache
     - Create the `projects` and `deployments` tables
     - Set up the necessary permissions

6. Verify the setup:
   - Go to the Table Editor in your Supabase dashboard
   - You should see the `projects` and `deployments` tables
   - When you create a backend through Backlify, you'll also see the tables for your generated API

### Troubleshooting Supabase Setup

If you encounter issues with the Supabase setup:

1. **Schema Cache Issues**: If you see errors about columns not found in the schema cache, try:
   - Running `SELECT refresh_schema_cache()` in the SQL Editor
   - Restarting your Supabase project
   - Checking that column names match exactly (including case)

2. **Permission Issues**: If you see permission errors:
   - Make sure you're using the correct API key
   - Check that the permissions in the setup script were applied correctly
   - Try running the permissions section of the setup script again

3. **SQL Execution Errors**: If SQL execution fails:
   - Check that the `execute_sql` function was created correctly
   - Verify that your Supabase instance allows executing arbitrary SQL
   - Try running a simple SQL statement directly in the SQL Editor

When you create a backend through Backlify, it will automatically create the necessary tables in your Supabase database based on the AI-generated schema. 