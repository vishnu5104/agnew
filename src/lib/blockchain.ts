import { createPublicClient, createWalletClient, http, Hex, decodeErrorResult, getAddress, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { spawn } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';

// Import ABIs and Bytecode
import AgentShieldJson from '../../contracts/out/AgentShield.sol/AgentShield.json';
import AgentWalletJson from '../../contracts/out/AgentWallet.sol/AgentWallet.json';

const STATE_FILE = path.join(process.cwd(), 'logs', 'deployed-contracts.json');
const ANVIL_PORT = 8545;
const ANVIL_HOST = '127.0.0.1';
const ANVIL_RPC_URL = `http://${ANVIL_HOST}:${ANVIL_PORT}`;

// First default account in Anvil
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(ANVIL_RPC_URL),
});

const walletClient = createWalletClient({
  chain: foundry,
  transport: http(ANVIL_RPC_URL),
  account,
});

// Cache for child process
let anvilProcess: any = null;

// Helper to check if Anvil port is active
export function isPortActive(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

// Ensure Anvil is running
export async function ensureAnvil(): Promise<boolean> {
  const active = await isPortActive(ANVIL_PORT, ANVIL_HOST);
  if (active) {
    return true;
  }

  console.log('Anvil not detected. Spawning local Anvil node...');
  try {
    // Ensure logs folder exists
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const proc = spawn('anvil', ['--port', String(ANVIL_PORT)], {
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
    anvilProcess = proc;

    // Wait for 2 seconds to let Anvil start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const activeNow = await isPortActive(ANVIL_PORT, ANVIL_HOST);
    if (!activeNow) {
      throw new Error('Anvil process spawned but port is still inactive.');
    }
    console.log('Anvil started successfully on port 8545.');
    return true;
  } catch (err) {
    console.error('Failed to spawn Anvil:', err);
    return false;
  }
}

interface DeployedContracts {
  shieldAddress: string;
  walletAddress: string;
  deployedAtBlock: string;
}

// Deploy smart contracts
export async function deployContracts(force: boolean = false): Promise<DeployedContracts> {
  await ensureAnvil();

  // Try to read existing deployment info
  if (!force && fs.existsSync(STATE_FILE)) {
    try {
      const state: DeployedContracts = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      // Verify contracts exist on-chain
      const codeShield = await publicClient.getBytecode({ address: state.shieldAddress as Hex });
      const codeWallet = await publicClient.getBytecode({ address: state.walletAddress as Hex });

      if (codeShield && codeShield !== '0x' && codeWallet && codeWallet !== '0x') {
        return state;
      }
    } catch (e) {
      console.log('Stale deployment state. Redeploying...');
    }
  }

  console.log('Deploying AgentShield and AgentWallet to local Anvil...');
  
  // Deploy AgentShield
  const shieldDeployHash = await walletClient.deployContract({
    abi: AgentShieldJson.abi,
    bytecode: AgentShieldJson.bytecode.object as Hex,
  });
  const shieldReceipt = await publicClient.waitForTransactionReceipt({ hash: shieldDeployHash });
  const shieldAddress = shieldReceipt.contractAddress;

  if (!shieldAddress) {
    throw new Error('AgentShield deployment failed: No contract address returned.');
  }

  // Deploy AgentWallet, passing the AgentShield address
  const walletDeployHash = await walletClient.deployContract({
    abi: AgentWalletJson.abi,
    bytecode: AgentWalletJson.bytecode.object as Hex,
    args: [shieldAddress],
  });
  const walletReceipt = await publicClient.waitForTransactionReceipt({ hash: walletDeployHash });
  const walletAddress = walletReceipt.contractAddress;

  if (!walletAddress) {
    throw new Error('AgentWallet deployment failed: No contract address returned.');
  }

  const blockNumber = await publicClient.getBlockNumber();
  const state: DeployedContracts = {
    shieldAddress,
    walletAddress,
    deployedAtBlock: blockNumber.toString(),
  };

  // Ensure logs folder exists
  const logsDir = path.dirname(STATE_FILE);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`Contracts deployed successfully. Shield: ${shieldAddress}, Wallet: ${walletAddress}`);

  // Set up standard mock merchant address reputation for testing in dashboard
  // Let's pre-register a few addresses with reputations
  // Standard merchant addresses
  await walletClient.writeContract({
    address: shieldAddress as Hex,
    abi: AgentShieldJson.abi,
    functionName: 'setAddressReputation',
    args: ['0x1234567890123456789012345678901234567890', 95], // OpenAI-like Address
  });

  return state;
}

// Fetch current on-chain config
export async function getOnChainConfig() {
  const isRunning = await isPortActive(ANVIL_PORT, ANVIL_HOST);
  if (!isRunning) {
    return null;
  }

  const state = await deployContracts();

  const dailyLimit = await publicClient.readContract({
    address: state.shieldAddress as Hex,
    abi: AgentShieldJson.abi,
    functionName: 'dailyLimit',
  });

  const minReputation = await publicClient.readContract({
    address: state.shieldAddress as Hex,
    abi: AgentShieldJson.abi,
    functionName: 'minReputation',
  });

  const rateLimitMaxRequests = await publicClient.readContract({
    address: state.shieldAddress as Hex,
    abi: AgentShieldJson.abi,
    functionName: 'rateLimitMaxRequests',
  });

  const rateLimitWindow = await publicClient.readContract({
    address: state.shieldAddress as Hex,
    abi: AgentShieldJson.abi,
    functionName: 'rateLimitWindow',
  });

  const whitelistEnabled = await publicClient.readContract({
    address: state.shieldAddress as Hex,
    abi: AgentShieldJson.abi,
    functionName: 'whitelistEnabled',
  });

  // Since solidity mappings cannot be fully iterated, we can fetch ownership and balances
  const owner = await publicClient.readContract({
    address: state.shieldAddress as Hex,
    abi: AgentShieldJson.abi,
    functionName: 'owner',
  });

  const walletOwner = await publicClient.readContract({
    address: state.walletAddress as Hex,
    abi: AgentWalletJson.abi,
    functionName: 'owner',
  });

  const walletBalance = await publicClient.getBalance({ address: state.walletAddress as Hex });

  return {
    shieldAddress: state.shieldAddress,
    walletAddress: state.walletAddress,
    dailyLimit: Number(formatEther(dailyLimit as bigint)), // display in standard tokens/dollars
    minReputation: Number(minReputation),
    rateLimit: {
      maxRequests: Number(rateLimitMaxRequests),
      windowMs: Number(rateLimitWindow) * 1000,
    },
    whitelistEnabled,
    owner,
    walletOwner,
    walletBalance: formatEther(walletBalance),
  };
}

// Update on-chain config
export async function updateOnChainConfig(config: {
  dailyLimit?: number;
  minReputation?: number;
  rateLimitMaxRequests?: number;
  rateLimitWindow?: number;
  whitelistEnabled?: boolean;
  whitelistAddresses?: string[];
}) {
  const state = await deployContracts();
  const shieldAddress = state.shieldAddress as Hex;

  // Set Daily Limit
  if (config.dailyLimit !== undefined) {
    const txHash = await walletClient.writeContract({
      address: shieldAddress,
      abi: AgentShieldJson.abi,
      functionName: 'setDailyLimit',
      args: [parseEther(String(config.dailyLimit))],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  // Set Min Reputation
  if (config.minReputation !== undefined) {
    const txHash = await walletClient.writeContract({
      address: shieldAddress,
      abi: AgentShieldJson.abi,
      functionName: 'setMinReputation',
      args: [config.minReputation],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  // Set Rate Limit
  if (config.rateLimitMaxRequests !== undefined && config.rateLimitWindow !== undefined) {
    const txHash = await walletClient.writeContract({
      address: shieldAddress,
      abi: AgentShieldJson.abi,
      functionName: 'setRateLimit',
      args: [BigInt(config.rateLimitMaxRequests), BigInt(config.rateLimitWindow)],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  // Set Whitelist Enabled
  if (config.whitelistEnabled !== undefined) {
    const txHash = await walletClient.writeContract({
      address: shieldAddress,
      abi: AgentShieldJson.abi,
      functionName: 'setWhitelistEnabled',
      args: [config.whitelistEnabled],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  // Update Merchant Whitelist Statuses
  if (config.whitelistAddresses !== undefined) {
    // Whitelist the provided addresses, remove others if we had a full state.
    // For simplicity, we just enable whitelist status for these addresses.
    for (const address of config.whitelistAddresses) {
      try {
        const formatted = getAddress(address.trim());
        const txHash = await walletClient.writeContract({
          address: shieldAddress,
          abi: AgentShieldJson.abi,
          functionName: 'updateMerchantWhitelist',
          args: [formatted, true],
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      } catch (e) {
        console.error(`Invalid whitelist address: ${address}`, e);
      }
    }
  }

  return getOnChainConfig();
}

// Simulate / execute a transaction on-chain via AgentWallet
export async function simulateOnChainTx(merchant: string, amount: number) {
  const state = await deployContracts();
  const walletAddress = state.walletAddress as Hex;
  const shieldAddress = state.shieldAddress as Hex;

  const valueInWei = parseEther(String(amount));

  // Determine if merchant input is an address
  let isAddress = false;
  let merchantAddr = '0x1234567890123456789012345678901234567890'; // fallback mock merchant address

  if (merchant.startsWith('0x') && merchant.length === 42) {
    try {
      merchantAddr = getAddress(merchant);
      isAddress = true;
    } catch (e) {
      isAddress = false;
    }
  } else {
    // Generate a semi-deterministic address based on the merchant name
    // e.g. keccak256 hash of the name, take first 20 bytes
    // For OpenAI, let's use the standard pre-configured address
    if (merchant.toLowerCase() === 'openai') {
      merchantAddr = '0x1234567890123456789012345678901234567890';
    } else {
      let sum = 0n;
      for (let i = 0; i < merchant.length; i++) {
        sum = (sum * 31n + BigInt(merchant.charCodeAt(i))) % (1n << 160n);
      }
      const hexPart = sum.toString(16).padStart(40, '0');
      merchantAddr = `0x${hexPart}`;
    }
  }

  try {
    // Give wallet contract some more ETH if balance is low (so it can execute the call)
    const walletBalance = await publicClient.getBalance({ address: walletAddress });
    if (walletBalance < valueInWei * 2n) {
      const fundTx = await walletClient.sendTransaction({
        to: walletAddress,
        value: parseEther('50'), // send 50 ETH to fund it
      });
      await publicClient.waitForTransactionReceipt({ hash: fundTx });
    }

    let txHash: Hex;

    if (isAddress) {
      // Execute address-based transaction
      console.log(`Executing AgentWallet.execute to address ${merchantAddr} with ${amount} ETH`);
      txHash = await walletClient.writeContract({
        address: walletAddress,
        abi: AgentWalletJson.abi,
        functionName: 'execute',
        args: [merchantAddr, valueInWei, '0x'],
      });
    } else {
      // Execute name-based transaction
      console.log(`Executing AgentWallet.executeWithString for "${merchant}" to address ${merchantAddr} with ${amount} ETH`);
      txHash = await walletClient.writeContract({
        address: walletAddress,
        abi: AgentWalletJson.abi,
        functionName: 'executeWithString',
        args: [merchant, merchantAddr, valueInWei, '0x'],
      });
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Try to find TransactionChecked event
    // ABI Event: TransactionChecked(address indexed agent, address indexed merchant, uint256 amount, bool approved, string reason)
    const logs = await publicClient.getContractEvents({
      address: shieldAddress,
      abi: AgentShieldJson.abi,
      eventName: 'TransactionChecked',
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
    });

    let reason = 'Transaction approved by AgentShield';
    if (logs.length > 0) {
      reason = (logs[0] as any).args?.reason || reason;
    }

    // Get name reputation if applicable
    let repScore = 80;
    let repSource = 'Fallback';

    if (!isAddress) {
      const repData = await publicClient.readContract({
        address: shieldAddress,
        abi: AgentShieldJson.abi,
        functionName: 'getNameReputation',
        args: [merchant],
      });
      repScore = Number((repData as any)[0]);
      repSource = String((repData as any)[1]);
    } else {
      const repData = await publicClient.readContract({
        address: shieldAddress,
        abi: AgentShieldJson.abi,
        functionName: 'getAddressReputation',
        args: [merchantAddr],
      });
      repScore = Number((repData as any)[0]);
      repSource = String((repData as any)[1]);
    }

    return {
      success: true,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      decision: {
        approved: true,
        reason,
        details: {
          reputationScore: repScore,
          reputationSource: repSource,
        },
      },
    };
  } catch (err: any) {
    // Extract revert error from Solidity
    console.error('On-chain execution reverted:', err);

    let blockedBy = 'SmartContract';
    let reason = 'Transaction reverted on-chain';
    let details: any = {};

    // Try to decode custom error from revert message
    try {
      const errorData = err.walk?.().data || err.data;
      if (errorData) {
        const decoded = decodeErrorResult({
          abi: AgentShieldJson.abi,
          data: errorData,
        });

        if (decoded) {
          blockedBy = decoded.errorName;
          const args = decoded.args as any;
          if (decoded.errorName === 'ShieldRateLimitExceeded') {
            reason = `Rate limit exceeded. Current requests: ${args[0]}, Max allowed: ${args[1]}. Reset in ${args[2]}s.`;
          } else if (decoded.errorName === 'ShieldNotWhitelisted') {
            reason = `Merchant address ${args[0]} is not in the security whitelist.`;
          } else if (decoded.errorName === 'ShieldReputationTooLow') {
            reason = `Merchant address ${args[0]} has a reputation of ${args[1]}/100, which is below the minimum threshold of ${args[2]}/100.`;
            details = { reputationScore: Number(args[1]), reputationSource: 'Registry (Address)' };
          } else if (decoded.errorName === 'ShieldReputationTooLowString') {
            reason = `Merchant "${args[0]}" has a reputation of ${args[1]}/100, which is below the minimum threshold of ${args[2]}/100.`;
            details = { reputationScore: Number(args[1]), reputationSource: 'Registry (Name)' };
          } else if (decoded.errorName === 'ShieldDailyLimitExceeded') {
            reason = `Daily spending limit exceeded. Tx Amount: ${formatEther(args[0])} ETH, Limit: ${formatEther(args[1])} ETH, Current Spend: ${formatEther(args[2])} ETH.`;
          } else if (decoded.errorName === 'ShieldInvalidAmount') {
            reason = 'Transaction amount must be greater than zero.';
          } else if (decoded.errorName === 'ShieldOnlyOwner') {
            reason = 'Caller is not the contract owner.';
          }
        }
      } else if (err.message && err.message.includes('ShieldOnlyOwner')) {
        blockedBy = 'ShieldOnlyOwner';
        reason = 'Caller is not the contract owner.';
      } else if (err.message && err.message.includes('ShieldReputationTooLowString')) {
        blockedBy = 'ShieldReputationTooLowString';
        reason = 'Merchant reputation too low.';
      } else if (err.message && err.message.includes('ShieldDailyLimitExceeded')) {
        blockedBy = 'ShieldDailyLimitExceeded';
        reason = 'Daily spending limit exceeded.';
      } else if (err.message && err.message.includes('ShieldRateLimitExceeded')) {
        blockedBy = 'ShieldRateLimitExceeded';
        reason = 'Rate limit exceeded.';
      } else if (err.message && err.message.includes('ShieldNotWhitelisted')) {
        blockedBy = 'ShieldNotWhitelisted';
        reason = 'Merchant not whitelisted.';
      }
    } catch (e) {
      console.log('Failed to decode revert error:', e);
    }

    return {
      success: false,
      error: err.shortMessage || err.message,
      decision: {
        approved: false,
        blockedBy,
        reason,
        details,
      },
    };
  }
}

// Fetch all TransactionChecked events from blockchain for audit logging
export async function getOnChainLogs() {
  const isRunning = await isPortActive(ANVIL_PORT, ANVIL_HOST);
  if (!isRunning) {
    return [];
  }

  const state = await deployContracts();
  const shieldAddress = state.shieldAddress as Hex;

  try {
    const blockNumber = await publicClient.getBlockNumber();
    const startBlock = BigInt(state.deployedAtBlock);
    
    // Fetch logs from deployed block to current block
    const eventLogs = await publicClient.getContractEvents({
      address: shieldAddress,
      abi: AgentShieldJson.abi,
      eventName: 'TransactionChecked',
      fromBlock: startBlock > blockNumber ? blockNumber : startBlock,
      toBlock: blockNumber,
    });

    const parsedLogs = await Promise.all(
      eventLogs.map(async (log) => {
        const args = (log as any).args || {};
        const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
        const timestamp = Number(block.timestamp) * 1000;
        
        return {
          id: `${log.transactionHash.substring(0, 10)}...`,
          timestamp,
          transaction: {
            merchant: args.merchant,
            amount: Number(formatEther(args.amount)),
          },
          decision: {
            approved: args.approved,
            blockedBy: args.approved ? undefined : 'On-Chain Policy',
            reason: args.reason,
          },
          onChain: true,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
        };
      })
    );

    // Sort descending by timestamp
    return parsedLogs.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    console.error('Error fetching on-chain logs:', err);
    return [];
  }
}

// Fetch daily spend for agent address
export async function getOnChainDailySpend() {
  const state = await deployContracts();
  const shieldAddress = state.shieldAddress as Hex;
  const agentAddress = account.address;

  try {
    const todayIndex = BigInt(Math.floor(Date.now() / 86400000));
    const spend = await publicClient.readContract({
      address: shieldAddress,
      abi: AgentShieldJson.abi,
      functionName: 'dailySpend',
      args: [agentAddress, todayIndex],
    });
    return Number(formatEther(spend as bigint));
  } catch (err) {
    console.error('Error getting daily spend:', err);
    return 0;
  }
}
