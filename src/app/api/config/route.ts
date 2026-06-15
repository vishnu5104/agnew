import { NextResponse } from 'next/server';
import { shield } from '@/lib/shield';
import { getOnChainConfig, updateOnChainConfig } from '@/lib/blockchain';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');

    if (mode === 'blockchain') {
      const config = await getOnChainConfig();
      if (config) {
        return NextResponse.json({ ...config, isBlockchain: true });
      }
    }
  } catch (e: any) {
    console.error('Error fetching blockchain config:', e);
  }

  return NextResponse.json(shield.config);
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');
    const body = await request.json();
    const { dailyLimit, whitelist, minReputation, rateLimit } = body;

    if (mode === 'blockchain') {
      const config = await updateOnChainConfig({
        dailyLimit: Number(dailyLimit),
        minReputation: Number(minReputation),
        rateLimitMaxRequests: rateLimit ? Number(rateLimit.maxRequests) : undefined,
        rateLimitWindow: rateLimit ? Number(rateLimit.windowMs) / 1000 : undefined,
        whitelistAddresses: Array.isArray(whitelist) ? whitelist : [],
        whitelistEnabled: Array.isArray(whitelist) && whitelist.length > 0,
      });
      return NextResponse.json({ success: true, config, isBlockchain: true });
    }

    shield.updateConfig({
      dailyLimit: Number(dailyLimit),
      whitelist: Array.isArray(whitelist) ? whitelist : [],
      minReputation: Number(minReputation),
      rateLimit: rateLimit
        ? {
            maxRequests: Number(rateLimit.maxRequests),
            windowMs: Number(rateLimit.windowMs),
          }
        : undefined,
    });

    return NextResponse.json({ success: true, config: shield.config });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

