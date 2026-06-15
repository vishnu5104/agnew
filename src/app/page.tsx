'use client';

import { useState, useEffect, useRef } from 'react';

interface DecisionResult {
  success: boolean;
  txHash?: string;
  blockNumber?: string;
  gasUsed?: string;
  error?: string;
  decision: {
    approved: boolean;
    blockedBy?: string;
    reason: string;
    details?: {
      reputationScore?: number;
      reputationSource?: string;
    };
  };
  timestamp?: number;
}

interface LogEntry {
  id: string;
  timestamp: number;
  transaction: {
    merchant: string;
    amount: number;
  };
  decision: {
    approved: boolean;
    blockedBy?: string;
    reason: string;
    details?: {
      reputationScore?: number;
      reputationSource?: string;
    };
  };
  onChain?: boolean;
  txHash?: string;
  blockNumber?: string;
}

interface BlockchainStatus {
  isAnvilRunning: boolean;
  shieldAddress?: string;
  walletAddress?: string;
  dailyLimit?: number;
  minReputation?: number;
  whitelistEnabled?: boolean;
  owner?: string;
  walletOwner?: string;
  walletBalance?: string;
}

export default function Dashboard() {
  // Mode selection state
  const [mode, setMode] = useState<'sdk' | 'blockchain'>('sdk');

  // Config state
  const [dailyLimit, setDailyLimit] = useState<number>(150);
  const [minReputation, setMinReputation] = useState<number>(70);
  const [whitelist, setWhitelist] = useState<string>('');
  const [rateLimitMax, setRateLimitMax] = useState<number>(5);
  const [rateLimitWindow, setRateLimitWindow] = useState<number>(60);

  // Simulation state
  const [simMerchant, setSimMerchant] = useState<string>('');
  const [simAmount, setSimAmount] = useState<string>('');
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<DecisionResult | null>(null);

  // Status and Logs state
  const [todaySpend, setTodaySpend] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [configSaveStatus, setConfigSaveStatus] = useState<
    'idle' | 'saving' | 'success' | 'failed'
  >('idle');

  // Blockchain status state
  const [blockchainStatus, setBlockchainStatus] = useState<BlockchainStatus>({
    isAnvilRunning: false,
  });
  const [isDeployingBlockchain, setIsDeployingBlockchain] = useState<boolean>(false);
  const [blockchainError, setBlockchainError] = useState<string | null>(null);

  // Highlight border effect refs
  const simMerchantRef = useRef<HTMLInputElement>(null);
  const simAmountRef = useRef<HTMLInputElement>(null);

  // Copy to clipboard helper
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchConfig();
    fetchLogs();
    checkBlockchainStatus();

    // Poll logs and blockchain status every 3 seconds
    const interval = setInterval(() => {
      fetchLogs();
      checkBlockchainStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [mode]);

  const checkBlockchainStatus = async () => {
    try {
      const res = await fetch('/api/blockchain');
      const data = await res.json();
      setBlockchainStatus(data);
      if (data.isAnvilRunning && mode === 'blockchain') {
        // sync daily limit and min reputation with blockchain values if running
        setDailyLimit(data.dailyLimit);
        setMinReputation(data.minReputation);
        setRateLimitMax(data.rateLimit?.maxRequests || 5);
        setRateLimitWindow((data.rateLimit?.windowMs || 60000) / 1000);
      }
    } catch (err) {
      console.error('Error fetching blockchain status:', err);
    }
  };

  const handleDeployBlockchain = async () => {
    setIsDeployingBlockchain(true);
    setBlockchainError(null);
    try {
      const res = await fetch('/api/blockchain', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBlockchainStatus(data);
        fetchConfig();
        fetchLogs();
      } else {
        setBlockchainError(data.error || 'Failed to deploy contracts');
      }
    } catch (err: any) {
      setBlockchainError(err.message || 'Error occurred during deployment');
    } finally {
      setIsDeployingBlockchain(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch(`/api/config?mode=${mode}`);
      const data = await res.json();
      setDailyLimit(data.dailyLimit);
      setMinReputation(data.minReputation);
      setWhitelist(data.whitelist ? data.whitelist.join(', ') : '');
      if (data.rateLimit) {
        setRateLimitMax(data.rateLimit.maxRequests);
        setRateLimitWindow(data.rateLimit.windowMs / 1000);
      }
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch(`/api/logs?mode=${mode}`);
      const data = await res.json();
      setLogs(data.logs || []);
      setTodaySpend(data.todaySpend || 0);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigSaveStatus('saving');

    const whitelistArray = whitelist
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');

    const bodyData = {
      dailyLimit,
      minReputation,
      whitelist: whitelistArray,
      whitelistEnabled: whitelistArray.length > 0,
      rateLimit: {
        maxRequests: rateLimitMax,
        windowMs: rateLimitWindow * 1000,
      },
    };

    try {
      const res = await fetch(`/api/config?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
      });
      const data = await res.json();
      if (data.success) {
        setConfigSaveStatus('success');
        setTimeout(() => setConfigSaveStatus('idle'), 1500);
        checkBlockchainStatus();
      } else {
        setConfigSaveStatus('failed');
        setTimeout(() => setConfigSaveStatus('idle'), 1500);
      }
    } catch (err) {
      console.error('Error saving config:', err);
      setConfigSaveStatus('failed');
      setTimeout(() => setConfigSaveStatus('idle'), 1500);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const applyPreset = (merchant: string, amount: string) => {
    setSimMerchant(merchant);
    setSimAmount(amount);

    // Briefly highlight inputs
    if (simMerchantRef.current && simAmountRef.current) {
      simMerchantRef.current.style.borderColor = 'var(--accent-color)';
      simAmountRef.current.style.borderColor = 'var(--accent-color)';
      setTimeout(() => {
        if (simMerchantRef.current) simMerchantRef.current.style.borderColor = '';
        if (simAmountRef.current) simAmountRef.current.style.borderColor = '';
      }, 500);
    }
  };

  const handleSimulateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSimulating(true);

    try {
      const res = await fetch(`/api/simulate?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant: simMerchant,
          amount: Number(simAmount),
        }),
      });
      const data = await res.json();
      setSimulationResult(data);
      fetchLogs(); // refresh logs immediately
      if (mode === 'blockchain') {
        checkBlockchainStatus(); // refresh balances & details
      }
    } catch (err) {
      console.error('Error simulating transaction:', err);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleClearLogs = async () => {
    const msg = mode === 'blockchain'
      ? 'Are you sure you want to reset the smart contracts? This will redeploy them to Anvil and reset all balances, logs, and rate limits.'
      : 'Are you sure you want to reset the logs and daily spending limits?';
      
    if (!confirm(msg)) {
      return;
    }

    try {
      const res = await fetch(`/api/logs/clear?mode=${mode}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSimulationResult(null);
        fetchLogs();
        if (mode === 'blockchain') {
          checkBlockchainStatus();
        }
      }
    } catch (err) {
      console.error('Error clearing logs:', err);
    }
  };

  // Calculate budget utilization circle
  const percentage =
    dailyLimit > 0 ? Math.min(100, (todaySpend / dailyLimit) * 100) : 0;
  const deg = (percentage / 100) * 360;

  let progressColor = 'var(--accent-color)';
  if (percentage >= 100) {
    progressColor = 'var(--danger-color)';
  } else if (percentage > 75) {
    progressColor = 'var(--warning-color)';
  }

  const progressStyle = {
    background: `conic-gradient(${progressColor} ${deg}deg, rgba(255, 255, 255, 0.05) ${deg}deg)`,
  };

  // Whitelist count helper
  const whitelistCount = whitelist
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '').length;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-area">
          <div className="logo-shield">
            <i className="fa-solid fa-shield-halved"></i>
          </div>
          <div className="logo-text">
            <h1>AgentShield</h1>
            <p>Autonomous AI Agent Wallet Security Shield</p>
          </div>
        </div>

        {/* Mode Selector & Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div className="mode-toggle-container" style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-color)',
            padding: '4px',
            borderRadius: '10px',
            display: 'flex',
            gap: '4px'
          }}>
            <button
              onClick={() => { setMode('sdk'); setSimulationResult(null); }}
              className={`btn btn-sm ${mode === 'sdk' ? 'btn-primary' : 'btn-outline'}`}
              style={{ border: 'none', padding: '0.4rem 1rem' }}
            >
              <i className="fa-brands fa-js" style={{ fontSize: '0.9rem' }}></i> TypeScript SDK
            </button>
            <button
              onClick={() => { setMode('blockchain'); setSimulationResult(null); }}
              className={`btn btn-sm ${mode === 'blockchain' ? 'btn-primary' : 'btn-outline'}`}
              style={{ border: 'none', padding: '0.4rem 1rem' }}
            >
              <i className="fa-solid fa-cube" style={{ fontSize: '0.9rem' }}></i> Solidity Contract
            </button>
          </div>

          <div className="system-status" style={mode === 'blockchain' && !blockchainStatus.isAnvilRunning ? {
            background: 'rgba(244, 63, 94, 0.08)',
            border: '1px solid rgba(244, 63, 94, 0.2)',
            color: 'var(--danger-color)'
          } : {}}>
            <span className="status-pulse" style={mode === 'blockchain' && !blockchainStatus.isAnvilRunning ? {
              backgroundColor: 'var(--danger-color)',
              boxShadow: '0 0 0 0 rgba(244, 63, 94, 0.7)',
              animationName: 'pulse-danger'
            } : {}}></span>
            <span className="status-text">
              {mode === 'sdk' ? 'Shield Active (TS)' : blockchainStatus.isAnvilRunning ? 'Shield Active (EVM)' : 'Anvil Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Blockchain Status / Action Panel */}
      {mode === 'blockchain' && (
        <section className="card" style={{ borderColor: blockchainStatus.isAnvilRunning ? 'rgba(99, 102, 241, 0.25)' : 'rgba(244, 63, 94, 0.25)' }}>
          <div className="card-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <i className="fa-solid fa-network-wired" style={{ color: blockchainStatus.isAnvilRunning ? 'var(--accent-color)' : 'var(--danger-color)' }}></i>
              <h2>Local Ethereum Node (Foundry Anvil)</h2>
            </div>
            {blockchainStatus.isAnvilRunning && (
              <button
                className="btn btn-sm btn-danger-outline"
                onClick={handleDeployBlockchain}
                disabled={isDeployingBlockchain}
              >
                <i className="fa-solid fa-rotate-right"></i> Reset & Redeploy Contracts
              </button>
            )}
          </div>
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {!blockchainStatus.isAnvilRunning ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                  Anvil Ethereum Node is not running on port 8545, or the security smart contracts are not deployed.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={handleDeployBlockchain}
                  disabled={isDeployingBlockchain}
                >
                  {isDeployingBlockchain ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i> Spawning Node & Deploying Contracts...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-bolt"></i> Auto-Start Anvil & Deploy Security Contracts
                    </>
                  )}
                </button>
                {blockchainError && (
                  <p style={{ color: 'var(--danger-color)', marginTop: '1rem', fontSize: '0.85rem' }}>
                    Error: {blockchainError}
                  </p>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>AGENT SHIELD CONTRACT ADDRESS</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <code style={{ fontSize: '0.85rem', color: '#a5b4fc', fontFamily: 'monospace' }}>
                      {blockchainStatus.shieldAddress}
                    </code>
                    <button
                      className="btn btn-sm btn-outline"
                      style={{ border: 'none', padding: '2px 6px', background: 'transparent' }}
                      onClick={() => handleCopy(blockchainStatus.shieldAddress || '', 'shield')}
                    >
                      <i className={copiedText === 'shield' ? 'fa-solid fa-check' : 'fa-solid fa-copy'}></i>
                    </button>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>AGENT SMART WALLET ADDRESS</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <code style={{ fontSize: '0.85rem', color: '#a5b4fc', fontFamily: 'monospace' }}>
                      {blockchainStatus.walletAddress}
                    </code>
                    <button
                      className="btn btn-sm btn-outline"
                      style={{ border: 'none', padding: '2px 6px', background: 'transparent' }}
                      onClick={() => handleCopy(blockchainStatus.walletAddress || '', 'wallet')}
                    >
                      <i className={copiedText === 'wallet' ? 'fa-solid fa-check' : 'fa-solid fa-copy'}></i>
                    </button>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>AGENT WALLET BALANCE</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--success-color)' }}>
                      {Number(blockchainStatus.walletBalance).toFixed(4)} ETH
                    </span>
                    <span className="badge badge-success">Anvil Account #0</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Main Dashboard Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Config Panel */}
        <section className="card config-card">
          <div className="card-header">
            <i className="fa-solid fa-sliders"></i>
            <h2>Security Policies ({mode === 'sdk' ? 'JS SDK' : 'EVM Smart Contract'})</h2>
          </div>
          <form onSubmit={handleConfigSubmit} className="config-form">
            <div className="form-group">
              <label htmlFor="daily-limit">
                <span>Daily Spend Limit</span>
                <span className="label-info">Max spend per 24 hours</span>
              </label>
              <div className="input-prefix-wrapper">
                <span className="input-prefix">{mode === 'sdk' ? '$' : 'Ξ'}</span>
                <input
                  type="number"
                  id="daily-limit"
                  name="dailyLimit"
                  min="1"
                  required
                  placeholder="100"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="min-reputation">
                <span>Min Merchant Reputation</span>
                <span id="reputation-val" className="badge">
                  {minReputation}/100
                </span>
              </label>
              <input
                type="range"
                id="min-reputation"
                name="minReputation"
                min="0"
                max="100"
                step="5"
                value={minReputation}
                onChange={(e) => setMinReputation(Number(e.target.value))}
              />
              <div className="range-labels">
                <span>0 (Off)</span>
                <span>50 (Medium)</span>
                <span>100 (Paranoid)</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="whitelist-input">
                <span>Merchant Whitelist</span>
                <span className="label-info">{mode === 'sdk' ? 'Comma-separated names' : 'Contracts allow addresses only (Preset registered OpenAI)'}</span>
              </label>
              {mode === 'sdk' ? (
                <textarea
                  id="whitelist-input"
                  name="whitelist"
                  rows={3}
                  placeholder="OpenAI, Anthropic, AWS, Stripe"
                  value={whitelist}
                  onChange={(e) => setWhitelist(e.target.value)}
                ></textarea>
              ) : (
                <input
                  type="text"
                  id="whitelist-input"
                  name="whitelist"
                  placeholder="0x1234567890123456789012345678901234567890"
                  value={whitelist}
                  onChange={(e) => setWhitelist(e.target.value)}
                />
              )}
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label htmlFor="rate-limit-max">Max Tx</label>
                <input
                  type="number"
                  id="rate-limit-max"
                  name="rateLimitMax"
                  min="1"
                  required
                  placeholder="5"
                  value={rateLimitMax}
                  onChange={(e) => setRateLimitMax(Number(e.target.value))}
                />
              </div>
              <div className="form-group flex-1">
                <label htmlFor="rate-limit-window">Window (sec)</label>
                <input
                  type="number"
                  id="rate-limit-window"
                  name="rateLimitWindow"
                  min="1"
                  required
                  placeholder="60"
                  value={rateLimitWindow}
                  onChange={(e) => setRateLimitWindow(Number(e.target.value))}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              id="save-config-btn"
              disabled={isSavingConfig || (mode === 'blockchain' && !blockchainStatus.isAnvilRunning)}
              style={
                configSaveStatus === 'success'
                  ? { background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }
                  : {}
              }
            >
              {configSaveStatus === 'idle' && (
                <>
                  <i className="fa-solid fa-floppy-disk"></i> Apply Security Policies
                </>
              )}
              {configSaveStatus === 'saving' && (
                <>
                  <i className="fa-solid fa-spinner fa-spin"></i> Saving...
                </>
              )}
              {configSaveStatus === 'success' && (
                <>
                  <i className="fa-solid fa-circle-check"></i> Applied Successfully!
                </>
              )}
              {configSaveStatus === 'failed' && (
                <>
                  <i className="fa-solid fa-circle-xmark"></i> Save Failed
                </>
              )}
            </button>
          </form>
        </section>

        {/* Middle Column: Simulator */}
        <section className="card simulator-card">
          <div className="card-header">
            <i className="fa-solid fa-terminal"></i>
            <h2>Sandbox Simulator ({mode === 'sdk' ? 'TS SDK' : 'EVM Client'})</h2>
          </div>
          <div className="simulator-wrapper" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <p className="section-desc">
              {mode === 'sdk' ? (
                <>Simulate an agent invoking <code>agent.pay()</code> to test rules in real-time.</>
              ) : (
                <>Send transaction attempts through the Solidity <code>AgentWallet</code> on-chain.</>
              )}
            </p>

            <div className="quick-templates">
              <span className="template-label">Presets:</span>
              <button
                type="button"
                className="btn btn-sm btn-outline template-btn"
                onClick={() => applyPreset(mode === 'sdk' ? 'OpenAI' : '0x1234567890123456789012345678901234567890', '15')}
                disabled={mode === 'blockchain' && !blockchainStatus.isAnvilRunning}
              >
                OpenAI {mode === 'sdk' ? '($15)' : '(0x123... / 15 ETH)'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline template-btn"
                onClick={() => applyPreset(mode === 'sdk' ? 'unknown-hosting-xyz' : 'unknown-hosting-xyz', '8')}
                disabled={mode === 'blockchain' && !blockchainStatus.isAnvilRunning}
              >
                Unknown Host {mode === 'sdk' ? '($8)' : '(8 ETH)'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline template-btn"
                onClick={() => applyPreset(mode === 'sdk' ? 'free-crypto-giveaway' : 'free-crypto-giveaway', '5')}
                disabled={mode === 'blockchain' && !blockchainStatus.isAnvilRunning}
              >
                Crypto AirDrop {mode === 'sdk' ? '($5)' : '(5 ETH)'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline template-btn"
                onClick={() => applyPreset(mode === 'sdk' ? 'AWS' : '0x2222222222222222222222222222222222222222', '120')}
                disabled={mode === 'blockchain' && !blockchainStatus.isAnvilRunning}
              >
                AWS {mode === 'sdk' ? '($120)' : '(0x222... / 120 ETH)'}
              </button>
            </div>

            <form onSubmit={handleSimulateSubmit} className="simulator-form" style={{ padding: 0 }}>
              <div className="form-row">
                <div className="form-group flex-2">
                  <label htmlFor="sim-merchant">
                    {mode === 'sdk' ? 'Merchant Name / Domain' : 'Merchant Name or Ethereum Address'}
                  </label>
                  <input
                    ref={simMerchantRef}
                    type="text"
                    id="sim-merchant"
                    required
                    placeholder={mode === 'sdk' ? 'e.g. OpenAI' : 'e.g. OpenAI or 0x123...'}
                    value={simMerchant}
                    onChange={(e) => setSimMerchant(e.target.value)}
                    disabled={mode === 'blockchain' && !blockchainStatus.isAnvilRunning}
                  />
                </div>
                <div className="form-group flex-1">
                  <label htmlFor="sim-amount">Amount ({mode === 'sdk' ? '$' : 'ETH'})</label>
                  <input
                    ref={simAmountRef}
                    type="number"
                    id="sim-amount"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="10"
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    disabled={mode === 'blockchain' && !blockchainStatus.isAnvilRunning}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-accent"
                id="simulate-btn"
                disabled={isSimulating || (mode === 'blockchain' && !blockchainStatus.isAnvilRunning)}
                style={{ marginTop: '1.25rem', width: '100%' }}
              >
                {isSimulating ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Checking policies...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-play"></i> {mode === 'sdk' ? 'Trigger agent.pay()' : 'Execute On-chain Transaction'}
                  </>
                )}
              </button>
            </form>

            {/* Decision Output Area */}
            {simulationResult && (
              <div
                id="simulation-output"
                className={`simulation-output ${
                  simulationResult.success ? 'approved' : 'blocked'
                }`}
              >
                <div className="decision-banner">
                  <div className="decision-icon">
                    {simulationResult.success ? (
                      <i className="fa-solid fa-circle-check"></i>
                    ) : (
                      <i className="fa-solid fa-shield-halved"></i>
                    )}
                  </div>
                  <div className="decision-headline">
                    {simulationResult.success ? 'PAYMENT APPROVED' : 'TRANSACTION BLOCKED'}
                  </div>
                </div>
                <div className="decision-body">
                  {/* Blockchain metadata */}
                  {simulationResult.txHash && (
                    <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem', borderRadius: '6px', marginBottom: '0.5rem', border: '1px solid var(--border-color)' }}>
                      <div className="decision-row" style={{ marginBottom: '0.25rem' }}>
                        <span className="decision-label">Transaction Hash:</span>
                        <code style={{ fontSize: '0.75rem', color: '#8b5cf6', fontFamily: 'monospace' }}>
                          {simulationResult.txHash.substring(0, 20)}...
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            style={{ border: 'none', padding: '0px 4px', background: 'transparent', display: 'inline' }}
                            onClick={() => handleCopy(simulationResult.txHash || '', 'tx')}
                          >
                            <i className={copiedText === 'tx' ? 'fa-solid fa-check' : 'fa-solid fa-copy'} style={{ fontSize: '0.75rem' }}></i>
                          </button>
                        </code>
                      </div>
                      <div className="decision-row">
                        <span className="decision-label">Gas Used / Block:</span>
                        <span className="decision-val" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          <span className="badge badge-success" style={{ marginRight: '6px' }}>{simulationResult.gasUsed} gas</span>
                          Block #{simulationResult.blockNumber}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="decision-row">
                    <span className="decision-label">Rule Decision:</span>
                    <span className="decision-val">
                      {simulationResult.success ? (
                        <span className="badge badge-success">Approved</span>
                      ) : (
                        <span className="badge badge-danger">Blocked</span>
                      )}
                    </span>
                  </div>

                  {!simulationResult.success && simulationResult.decision.blockedBy && (
                    <div className="decision-row" id="decision-block-row">
                      <span className="decision-label">Triggered Rule:</span>
                      <span className="decision-val badge badge-danger" id="decision-blocked-by">
                        {simulationResult.decision.blockedBy}
                      </span>
                    </div>
                  )}

                  <div className="decision-row">
                    <span className="decision-label">Security Reason:</span>
                    <span className="decision-val" id="decision-reason" style={{ fontWeight: 500 }}>
                      {simulationResult.success
                        ? `Transaction of ${mode === 'sdk' ? '$' : 'Ξ'}${Number(simAmount)} valid spend checks. Allowed to proceed.`
                        : simulationResult.decision.reason}
                    </span>
                  </div>

                  {simulationResult.decision.details &&
                    simulationResult.decision.details.reputationScore !== undefined && (
                      <div className="decision-row" id="decision-rep-row">
                        <span className="decision-label">Merchant Reputation:</span>
                        <span className="decision-val" id="decision-reputation">
                          <span
                            className={`badge ${
                              simulationResult.decision.details.reputationScore < 50
                                ? 'badge-danger'
                                : simulationResult.decision.details.reputationScore < 75
                                ? 'badge-warning'
                                : 'badge-success'
                            }`}
                          >
                            {simulationResult.decision.details.reputationScore}/100
                          </span>{' '}
                          <small style={{ color: 'var(--text-secondary)' }}>
                            ({simulationResult.decision.details.reputationSource})
                          </small>
                        </span>
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Budget & System Status */}
        <section className="card status-card">
          <div className="card-header">
            <i className="fa-solid fa-chart-line"></i>
            <h2>Metrics & Diagnostics ({mode === 'sdk' ? 'JS SDK' : 'EVM Shield'})</h2>
          </div>
          <div className="metrics-wrapper">
            {/* Circular Progress Meter */}
            <div className="budget-progress-container">
              <div
                className="circular-progress"
                id="budget-progress-circle"
                style={progressStyle}
              >
                <div className="inner-circle">
                  <span id="budget-spent-text">{mode === 'sdk' ? '$' : 'Ξ'}{todaySpend.toFixed(2)}</span>
                  <span className="budget-total-label">
                    spent of <span id="budget-limit-text">{mode === 'sdk' ? '$' : 'Ξ'}{dailyLimit}</span>
                  </span>
                </div>
              </div>
              <h3>Daily Budget Utilization</h3>
            </div>

            {/* Policy Badges */}
            <div className="policy-status-list">
              <div className="policy-status-item" id="policy-status-daily">
                <i className="fa-solid fa-circle-check"></i>
                <div className="policy-desc">
                  <span>Daily Limit Enforcement</span>
                  <small id="policy-desc-daily">Active (Limit: {mode === 'sdk' ? '$' : 'Ξ'}{dailyLimit})</small>
                </div>
              </div>

              <div
                className={`policy-status-item ${whitelistCount === 0 ? 'disabled' : ''}`}
                id="policy-status-whitelist"
              >
                <i
                  className="fa-solid fa-circle-check"
                  style={whitelistCount === 0 ? { color: 'var(--text-muted)' } : {}}
                ></i>
                <div className="policy-desc">
                  <span>Merchant Whitelist</span>
                  <small id="policy-desc-whitelist">
                    {mode === 'blockchain' && blockchainStatus.whitelistEnabled
                      ? 'Active (On-chain Whitelist)'
                      : whitelistCount > 0
                      ? `Active (${whitelistCount} merchants)`
                      : 'Bypassed (Empty whitelist)'}
                  </small>
                </div>
              </div>

              <div
                className={`policy-status-item ${minReputation === 0 ? 'disabled' : ''}`}
                id="policy-status-reputation"
              >
                <i
                  className="fa-solid fa-circle-check"
                  style={minReputation === 0 ? { color: 'var(--text-muted)' } : {}}
                ></i>
                <div className="policy-desc">
                  <span>Reputation Score Guard</span>
                  <small id="policy-desc-reputation">
                    {minReputation > 0
                      ? `Active (Min: ${minReputation}/100)`
                      : 'Disabled (Threshold 0)'}
                  </small>
                </div>
              </div>

              <div className="policy-status-item" id="policy-status-rate">
                <i className="fa-solid fa-circle-check"></i>
                <div className="policy-desc">
                  <span>Spam & Rate Limit Protect</span>
                  <small id="policy-desc-rate">
                    Active ({rateLimitMax} tx / {rateLimitWindow}s)
                  </small>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Section: Logs */}
      <section className="card logs-card">
        <div className="card-header logs-header">
          <div className="header-left">
            <i className="fa-solid fa-list-check"></i>
            <h2>Audit & Decision Log ({mode === 'sdk' ? 'JSON logs' : 'On-chain Event Logs'})</h2>
          </div>
          <button
            className="btn btn-sm btn-danger-outline"
            id="clear-logs-btn"
            onClick={handleClearLogs}
            disabled={mode === 'blockchain' && !blockchainStatus.isAnvilRunning}
          >
            <i className="fa-solid fa-trash-can"></i> {mode === 'sdk' ? 'Clear History' : 'Reset Smart Contracts'}
          </button>
        </div>
        <div className="table-responsive">
          <table className="logs-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>{mode === 'sdk' ? 'Transaction ID' : 'Tx Hash'}</th>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Triggered Block</th>
                <th>Details & Reasoning</th>
              </tr>
            </thead>
            <tbody id="logs-tbody">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No transaction events recorded. Run a simulation above!
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const dateStr = new Date(log.timestamp).toLocaleTimeString();
                  const repScore =
                    log.decision.details?.reputationScore ??
                    (log.decision.details as any)?.reputation?.reputationScore;
                  const details = log.decision.approved
                    ? `Transaction approved.${
                        repScore ? ` Merchant Reputation: ${repScore}/100` : ''
                      }`
                    : log.decision.reason;

                  const displayId = log.onChain && log.txHash
                    ? `${log.txHash.substring(0, 10)}...`
                    : log.id;

                  return (
                    <tr key={log.id}>
                      <td>{dateStr}</td>
                      <td className="font-mono">
                        {displayId}
                        {log.onChain && log.txHash && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ border: 'none', padding: '0px 4px', background: 'transparent', display: 'inline', color: 'var(--text-muted)' }}
                            onClick={() => handleCopy(log.txHash || '', 'log-tx')}
                          >
                            <i className="fa-solid fa-copy" style={{ fontSize: '0.7rem' }}></i>
                          </button>
                        )}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {log.transaction.merchant.startsWith('0x') && log.transaction.merchant.length === 42 ? (
                          <code style={{ fontSize: '0.8rem', color: '#a5b4fc', fontFamily: 'monospace' }}>
                            {log.transaction.merchant.substring(0, 10)}...{log.transaction.merchant.substring(34)}
                          </code>
                        ) : (
                          log.transaction.merchant
                        )}
                      </td>
                      <td className="log-amount">{mode === 'sdk' ? '$' : 'Ξ'}{log.transaction.amount.toFixed(2)}</td>
                      <td>
                        {log.decision.approved ? (
                          <span className="badge badge-success">Approved</span>
                        ) : (
                          <span className="badge badge-danger">Blocked</span>
                        )}
                      </td>
                      <td>
                        {log.decision.approved ? (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        ) : (
                          <span className="badge badge-danger">{log.decision.blockedBy || 'Reverted'}</span>
                        )}
                      </td>
                      <td
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-secondary)',
                          maxWidth: '300px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={details}
                      >
                        {details}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Embedded CSS for keyframes since Next page.module might not have it */}
      <style jsx global>{`
        @keyframes pulse-danger {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 6px rgba(244, 63, 94, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(244, 63, 94, 0);
          }
        }
      `}</style>
    </div>
  );
}
