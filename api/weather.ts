import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleWeather } from './handler.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const result = await handleWeather(
    req.query as { date?: string | string[]; pts?: string | string[] },
  );
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  res.status(result.status).json(result.body);
}
