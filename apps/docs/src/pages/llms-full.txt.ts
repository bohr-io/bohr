import type { APIRoute } from 'astro';
import { llmsFullTxt, textResponse } from '../lib/llms';

export const GET: APIRoute = async () => textResponse(await llmsFullTxt('en'));
