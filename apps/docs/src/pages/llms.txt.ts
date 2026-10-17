import type { APIRoute } from 'astro';
import { llmsTxt, textResponse } from '../lib/llms';

export const GET: APIRoute = async () => textResponse(await llmsTxt('en'));
