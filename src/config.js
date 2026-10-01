import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-70b-instruct',
    fallbackModels: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'google/gemini-2.0-flash-exp:free',
      'microsoft/phi-4:free',
    ],
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  },
  
  tavily: {
    apiKey: process.env.TAVILY_API_KEY,
  },
  
  fairValue: {
    baseUrl: process.env.FAIR_VALUE_API_URL || 'https://fairvalue-api.vercel.app',
    apiKey: process.env.FAIR_VALUE_API_KEY || '',
  },
  
  outputDir: process.env.OUTPUT_DIR || '.',
};

// Validate required config
const required = [];
if (!config.openRouter.apiKey) required.push('OPENROUTER_API_KEY');
if (!config.tavily.apiKey) required.push('TAVILY_API_KEY');

if (required.length > 0) {
  console.warn(`⚠️  Missing required env vars: ${required.join(', ')}`);
  console.warn('   Copy .env.example to .env and fill in your API keys');
}