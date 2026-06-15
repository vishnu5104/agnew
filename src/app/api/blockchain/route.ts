import { NextResponse } from 'next/server';
import { isPortActive, getOnChainConfig, deployContracts } from '@/lib/blockchain';

export async function GET() {
  try {
    const isRunning = await isPortActive(8545, '127.0.0.1');
    if (!isRunning) {
      return NextResponse.json({ isAnvilRunning: false });
    }
    const config = await getOnChainConfig();
    return NextResponse.json({ isAnvilRunning: true, ...config });
  } catch (err: any) {
    return NextResponse.json({ isAnvilRunning: false, error: err.message });
  }
}

export async function POST() {
  try {
    await deployContracts(true); // force deploy / start anvil if needed
    const config = await getOnChainConfig();
    return NextResponse.json({ success: true, isAnvilRunning: true, ...config });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
