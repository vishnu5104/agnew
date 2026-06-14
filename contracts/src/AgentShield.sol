// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract AgentShield {
    // --- Custom Errors ---
    error ShieldRateLimitExceeded(uint256 activeCount, uint256 maxRequests, uint256 secUntilReset);
    error ShieldNotWhitelisted(address merchant);
    error ShieldReputationTooLow(address merchant, uint8 score, uint8 minRequired);
    error ShieldReputationTooLowString(string merchant, uint8 score, uint8 minRequired);
    error ShieldDailyLimitExceeded(uint256 amount, uint256 limit, uint256 currentSpend);
    error ShieldInvalidAmount();
    error ShieldInvalidReputationScore(uint8 score);
    error ShieldOnlyOwner();
    error ShieldInvalidAddress();

    // --- State Variables ---
    address public owner;
    
    // Limits & Configs
    uint256 public dailyLimit;              // Daily limit amount (e.g. in Wei or tokens)
    uint8 public minReputation;             // Threshold (0 - 100)
    uint256 public rateLimitMaxRequests;    // Max transactions in window
    uint256 public rateLimitWindow;         // Sliding window size in seconds

    bool public whitelistEnabled;
    mapping(address => bool) public whitelist;
    
    // Reputation registries
    mapping(address => uint8) public customAddressReputation;
    mapping(address => bool) public hasCustomAddressReputation;
    
    mapping(bytes32 => uint8) public customNameReputation;
    mapping(bytes32 => bool) public hasCustomNameReputation;

    // Trackers
    // agent => day (block.timestamp / 1 days) => spend amount
    mapping(address => mapping(uint256 => uint256)) public dailySpend;
    
    // agent => list of transaction timestamps
    mapping(address => uint256[]) public txTimestamps;
    
    // agent => index in txTimestamps where active window starts
    mapping(address => uint256) public rateLimitStartIndex;

    // --- Events ---
    event TransactionChecked(
        address indexed agent,
        address indexed merchant,
        uint256 amount,
        bool approved,
        string reason
    );
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event MinReputationUpdated(uint8 oldMin, uint8 newMin);
    event RateLimitUpdated(
        uint256 oldMaxRequests,
        uint256 oldWindow,
        uint256 newMaxRequests,
        uint256 newWindow
    );
    event WhitelistToggled(bool enabled);
    event MerchantWhitelistUpdated(address indexed merchant, bool status);
    event AddressReputationUpdated(address indexed merchant, uint8 score);
    event NameReputationUpdated(string name, uint8 score);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert ShieldOnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        
        // Defaults matching TS SDK
        dailyLimit = 100 * 10**18;         // Default: 100 base units (e.g. ether/tokens)
        minReputation = 70;                 // Minimum reputation score of 70
        rateLimitMaxRequests = 5;           // 5 requests
        rateLimitWindow = 60;               // 1 minute (60 seconds)
        whitelistEnabled = false;

        // Initialize standard merchant name reputations to match the TS registry
        _registerStandardNames();
    }

    function _registerStandardNames() internal {
        // Hashed and stored matching TS Registry
        _setNameReputation("openai", 99);
        _setNameReputation("anthropic", 98);
        _setNameReputation("stripe", 99);
        _setNameReputation("github", 97);
        _setNameReputation("aws", 98);
        _setNameReputation("amazon", 98);
        _setNameReputation("vercel", 96);
        _setNameReputation("google", 99);
        _setNameReputation("microsoft", 97);
        _setNameReputation("cloudflare", 98);
        _setNameReputation("npm", 95);
        _setNameReputation("cohere", 90);
        _setNameReputation("midjourney", 88);
        _setNameReputation("elevenlabs", 88);
        _setNameReputation("resend", 92);
        _setNameReputation("railway", 90);
        _setNameReputation("render", 90);
        _setNameReputation("heroku", 90);
        _setNameReputation("supabase", 94);
        _setNameReputation("neon", 92);
        _setNameReputation("pinecone", 92);
        _setNameReputation("mongodb", 94);
    }

    function _setNameReputation(string memory name, uint8 score) internal {
        bytes32 nameHash = keccak256(abi.encodePacked(toLower(name)));
        customNameReputation[nameHash] = score;
        hasCustomNameReputation[nameHash] = true;
    }

    // --- Configuration Setters (Owner Only) ---

    function setDailyLimit(uint256 _dailyLimit) external onlyOwner {
        emit DailyLimitUpdated(dailyLimit, _dailyLimit);
        dailyLimit = _dailyLimit;
    }

    function setMinReputation(uint8 _minReputation) external onlyOwner {
        if (_minReputation > 100) revert ShieldInvalidReputationScore(_minReputation);
        emit MinReputationUpdated(minReputation, _minReputation);
        minReputation = _minReputation;
    }

    function setRateLimit(uint256 _maxRequests, uint256 _windowSeconds) external onlyOwner {
        emit RateLimitUpdated(rateLimitMaxRequests, rateLimitWindow, _maxRequests, _windowSeconds);
        rateLimitMaxRequests = _maxRequests;
        rateLimitWindow = _windowSeconds;
    }

    function setWhitelistEnabled(bool _enabled) external onlyOwner {
        whitelistEnabled = _enabled;
        emit WhitelistToggled(_enabled);
    }

    function updateMerchantWhitelist(address merchant, bool status) external onlyOwner {
        if (merchant == address(0)) revert ShieldInvalidAddress();
        whitelist[merchant] = status;
        emit MerchantWhitelistUpdated(merchant, status);
    }

    function setAddressReputation(address merchant, uint8 score) external onlyOwner {
        if (merchant == address(0)) revert ShieldInvalidAddress();
        if (score > 100) revert ShieldInvalidReputationScore(score);
        customAddressReputation[merchant] = score;
        hasCustomAddressReputation[merchant] = true;
        emit AddressReputationUpdated(merchant, score);
    }

    function setNameReputation(string calldata name, uint8 score) external onlyOwner {
        if (score > 100) revert ShieldInvalidReputationScore(score);
        _setNameReputation(name, score);
        emit NameReputationUpdated(name, score);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ShieldInvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // --- Public Reputation Checks ---

    /**
     * @notice Resolves the reputation of an address.
     * Uses custom registered score, otherwise falls back to a deterministic address hash.
     */
    function getAddressReputation(address merchant) public view returns (uint8 score, string memory source) {
        if (hasCustomAddressReputation[merchant]) {
            return (customAddressReputation[merchant], "Registry (Address)");
        }
        // Fallback: Deterministic address-based reputation score mapped to 40-85
        bytes32 hash = keccak256(abi.encodePacked(merchant));
        uint256 absHash = uint256(hash);
        uint8 fallbackScore = uint8(40 + (absHash % 45));
        return (fallbackScore, "Heuristic (Deterministic Address Hash)");
    }

    /**
     * @notice Resolves the reputation of a merchant string name.
     * Uses custom name registry, checks for suspicious keywords, or falls back to deterministic string hash.
     */
    function getNameReputation(string memory name) public view returns (uint8 score, string memory source) {
        string memory lowerName = toLower(name);
        bytes32 nameHash = keccak256(abi.encodePacked(lowerName));

        // 1. Check registry
        if (hasCustomNameReputation[nameHash]) {
            return (customNameReputation[nameHash], "Registry (Name)");
        }

        // 2. Check heuristics: suspicious keywords
        if (isSuspicious(lowerName)) {
            return (15, "Heuristic (Suspicious Keyword Match)");
        }

        // 3. Fallback: exact deterministic hash mapping matching TS
        uint8 fallbackScore = getDeterministicScoreString(lowerName);
        return (fallbackScore, "Heuristic (Deterministic Name Hash)");
    }

    // --- Core Policy Verification & Execution ---

    /**
     * @notice Performs all policy checks and records execution data for rate limits & daily spend.
     * @param merchant The recipient/merchant address.
     * @param amount The transaction value.
     */
    function checkAndRecord(address merchant, uint256 amount) external returns (bool) {
        address agent = msg.sender;

        // 1. Check Rate Limit (sliding window)
        _checkAndRecordRateLimit(agent);

        // 2. Check Whitelist
        if (whitelistEnabled && !whitelist[merchant]) {
            revert ShieldNotWhitelisted(merchant);
        }

        // 3. Check Reputation
        (uint8 score, ) = getAddressReputation(merchant);
        if (score < minReputation) {
            revert ShieldReputationTooLow(merchant, score, minReputation);
        }

        // 4. Check Daily Limit
        uint256 today = block.timestamp / 1 days;
        uint256 currentSpend = dailySpend[agent][today];
        uint256 potentialSpend = currentSpend + amount;
        if (potentialSpend > dailyLimit) {
            revert ShieldDailyLimitExceeded(amount, dailyLimit, currentSpend);
        }

        // --- All Checks Passed: Update States ---
        dailySpend[agent][today] = potentialSpend;

        emit TransactionChecked(agent, merchant, amount, true, "Transaction approved by AgentShield");
        return true;
    }

    /**
     * @notice Checks policies for string-based merchant identifiers, records execution data.
     */
    function checkAndRecordString(string calldata merchantName, address merchantAddress, uint256 amount) external returns (bool) {
        address agent = msg.sender;

        // 1. Check Rate Limit
        _checkAndRecordRateLimit(agent);

        // 2. Check Whitelist if enabled
        if (whitelistEnabled && !whitelist[merchantAddress]) {
            revert ShieldNotWhitelisted(merchantAddress);
        }

        // 3. Check Reputation by String Name
        (uint8 score, ) = getNameReputation(merchantName);
        if (score < minReputation) {
            revert ShieldReputationTooLowString(merchantName, score, minReputation);
        }

        // 4. Check Daily Limit
        uint256 today = block.timestamp / 1 days;
        uint256 currentSpend = dailySpend[agent][today];
        uint256 potentialSpend = currentSpend + amount;
        if (potentialSpend > dailyLimit) {
            revert ShieldDailyLimitExceeded(amount, dailyLimit, currentSpend);
        }

        // --- Update States ---
        dailySpend[agent][today] = potentialSpend;

        emit TransactionChecked(agent, merchantAddress, amount, true, "Transaction approved by AgentShield");
        return true;
    }

    // --- Internal Helpers ---

    function _checkAndRecordRateLimit(address agent) internal {
        if (rateLimitMaxRequests == 0) return;

        uint256[] storage timestamps = txTimestamps[agent];
        uint256 length = timestamps.length;
        uint256 startIdx = rateLimitStartIndex[agent];
        uint256 windowStart = block.timestamp > rateLimitWindow ? block.timestamp - rateLimitWindow : 0;

        // Find the first active timestamp index in the sliding window
        uint256 firstActiveIdx = startIdx;
        while (firstActiveIdx < length && timestamps[firstActiveIdx] < windowStart) {
            firstActiveIdx++;
        }

        // Update stored index pointer to skip old records next time
        if (firstActiveIdx > startIdx) {
            rateLimitStartIndex[agent] = firstActiveIdx;
        }

        uint256 activeCount = length - firstActiveIdx;

        if (activeCount >= rateLimitMaxRequests) {
            uint256 oldestActive = timestamps[firstActiveIdx];
            uint256 secUntilReset = oldestActive + rateLimitWindow - block.timestamp;
            revert ShieldRateLimitExceeded(activeCount, rateLimitMaxRequests, secUntilReset);
        }

        // Record current attempt
        timestamps.push(block.timestamp);
    }

    function isSuspicious(string memory name) public pure returns (bool) {
        string memory lowerName = toLower(name);
        if (contains(lowerName, "scam")) return true;
        if (contains(lowerName, "hack")) return true;
        if (contains(lowerName, "free-robux")) return true;
        if (contains(lowerName, "free-crypto")) return true;
        if (contains(lowerName, "giveaway")) return true;
        if (contains(lowerName, "win-lottery")) return true;
        if (contains(lowerName, "gambling")) return true;
        if (contains(lowerName, "casino")) return true;
        if (contains(lowerName, "double-your-money")) return true;
        if (contains(lowerName, "airdrops")) return true;
        if (contains(lowerName, "phish")) return true;
        if (contains(lowerName, "bypass")) return true;
        return false;
    }

    function getDeterministicScoreString(string memory str) public pure returns (uint8) {
        bytes memory b = bytes(str);
        int32 hash = 0;
        unchecked {
            for (uint i = 0; i < b.length; i++) {
                hash = int32(uint32(uint8(b[i]))) + ((hash << 5) - hash);
            }
            int32 absHash = hash < 0 ? -hash : hash;
            if (absHash < 0) {
                absHash = type(int32).max;
            }
            return uint8(40 + (uint32(absHash) % 45));
        }
    }

    function toLower(string memory str) public pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint i = 0; i < bStr.length; i++) {
            if ((uint8(bStr[i]) >= 65) && (uint8(bStr[i]) <= 90)) {
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        return string(bLower);
    }

    function contains(string memory haystack, string memory needle) public pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (h.length < n.length) return false;
        for (uint i = 0; i <= h.length - n.length; i++) {
            bool matchFound = true;
            for (uint j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    matchFound = false;
                    break;
                }
            }
            if (matchFound) return true;
        }
        return false;
    }
}
