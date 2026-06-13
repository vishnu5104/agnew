# 🛡️ AgentShield

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-Passing-success.svg)](https://github.com/vishnu5104/agent-shield)

AgentShield is a lightweight, robust security shield SDK for Node.js designed to protect wallets from autonomous AI agents. By wrapping the agent's payment mechanisms, AgentShield ensures that every transaction is validated against real-time safety policies before execution.


## Core Features

- 📅 **Daily Spend Limits**: Caps daily expenditures over a rolling 24-hour period.
- 📜 **Merchant Whitelist**: Ensures transactions are only routed to verified and trusted platforms.
- ⭐️ **Reputation Scores**: Dynamically resolves risk scores for merchants via built-in registries and heuristics.
- ⚡️ **Rate Limiting**: Protects against rapid loops and runaway budget drains using a sliding window.
- 💾 **State Persistence**: Supports both `MemoryStorage` and file-based `FileStorage` for persistent auditing.

---

## Installation & Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile TypeScript:
   ```bash
   npm run build
   ```

3. Run the unit test suite:
   ```bash
   npm test
   ```

---

## Quick Start Guide

### 1. Configure the Shield
Instantiate the security shield with your parameters:

```javascript
import { AgentShield } from 'agent-shield';

const shield = new AgentShield({
  dailyLimit: 100,               // Max $100 per day
  whitelist: ['OpenAI', 'AWS'],  // Only allow OpenAI and AWS
  minReputation: 70,             // Merchant reputation threshold
  rateLimit: {
    maxRequests: 3,              // Max 3 requests
    windowMs: 10000              // Per 10 seconds
  },
  storagePath: './logs/state.json'
});
```

### 2. Wrap Agent Wallet Call
Apply security policies directly on your payment function:

```javascript
const makePayment = async (tx) => {
  return { txHash: '0xabc...' };
};

// Secures the function
const pay = shield.guard(makePayment);

try {
  const receipt = await pay({ amount: 15, merchant: 'OpenAI' });
  console.log('Payment Succeeded:', receipt.txHash);
} catch (err) {
  if (err.name === 'ShieldValidationError') {
    console.error('Blocked by Shield:', err.decision.reason);
  }
}
```

### 3. Proxy Protection (Transparent wrapping)
Protect an existing agent object. The shield intercepts the `.pay()` method transparently:

```javascript
const rawAgent = {
  name: 'AutonomousAgent',
  pay: async (tx) => `Paid $${tx.amount} to ${tx.merchant}`
};

const agent = shield.protect(rawAgent);

// Fully protected!
const result = await agent.pay({ amount: 20, merchant: 'OpenAI' });
```

---

## Running Demos

### 1. Terminal Simulation Demo
Run a step-by-step terminal simulation highlighting all rule validations:
```bash
npm run dev
```

### 2. Interactive Web Dashboard
Launch the visual security dashboard:
```bash
npm run dashboard
```
Open your browser to [http://localhost:3000](http://localhost:3000).