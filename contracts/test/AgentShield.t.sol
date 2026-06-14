// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {AgentShield} from "../src/AgentShield.sol";
import {AgentWallet} from "../src/AgentWallet.sol";

contract MockMerchant {
    receive() external payable {}
}

contract AgentShieldTest is Test {
    AgentShield public shield;
    AgentWallet public wallet;
    MockMerchant public merchant;
    MockMerchant public evilMerchant;

    address public owner;
    address public walletOwner;

    function setUp() public {
        owner = address(this);
        walletOwner = address(0x99);

        // Warp time past the initial 0/1 block timestamps to avoid rate limit underflows
        vm.warp(100000);

        shield = new AgentShield();
        
        // Deploy wallet owned by walletOwner, pointing to shield
        vm.prank(walletOwner);
        wallet = new AgentWallet(address(shield));

        merchant = new MockMerchant();
        evilMerchant = new MockMerchant();

        // Register merchant with high reputation (95) so it passes the min reputation threshold of 70
        shield.setAddressReputation(address(merchant), 95);

        // Give wallet some ether to transact
        vm.deal(address(wallet), 1000 ether);
    }

    // --- Configuration Tests ---

    function test_InitialState() public {
        assertEq(shield.owner(), owner);
        assertEq(shield.dailyLimit(), 100 * 10**18);
        assertEq(shield.minReputation(), 70);
        assertEq(shield.rateLimitMaxRequests(), 5);
        assertEq(shield.rateLimitWindow(), 60);
        assertEq(shield.whitelistEnabled(), false);
    }

    function test_SetConfiguration() public {
        shield.setDailyLimit(50 ether);
        assertEq(shield.dailyLimit(), 50 ether);

        shield.setMinReputation(80);
        assertEq(shield.minReputation(), 80);

        shield.setRateLimit(10, 120);
        assertEq(shield.rateLimitMaxRequests(), 10);
        assertEq(shield.rateLimitWindow(), 120);

        shield.setWhitelistEnabled(true);
        assertTrue(shield.whitelistEnabled());
    }

    function test_SetConfiguration_RevertNotOwner() public {
        vm.prank(address(0x1));
        vm.expectRevert(AgentShield.ShieldOnlyOwner.selector);
        shield.setDailyLimit(50 ether);
    }

    // --- Whitelist Tests ---

    function test_Whitelist_DisabledByDefault() public {
        // Even if not whitelisted, transaction passes because whitelist is disabled
        vm.prank(address(wallet));
        bool approved = shield.checkAndRecord(address(merchant), 1 ether);
        assertTrue(approved);
    }

    function test_Whitelist_Enabled() public {
        shield.setWhitelistEnabled(true);
        shield.updateMerchantWhitelist(address(merchant), true);

        // Merchant is whitelisted, should pass
        vm.prank(address(wallet));
        bool approved = shield.checkAndRecord(address(merchant), 1 ether);
        assertTrue(approved);

        // Evil merchant is not whitelisted, should revert
        vm.prank(address(wallet));
        vm.expectRevert(
            abi.encodeWithSelector(AgentShield.ShieldNotWhitelisted.selector, address(evilMerchant))
        );
        shield.checkAndRecord(address(evilMerchant), 1 ether);
    }

    // --- Reputation Tests ---

    function test_Reputation_CustomAddressReputation() public {
        // Set low reputation for merchant
        shield.setAddressReputation(address(evilMerchant), 50);
        (uint8 score, string memory source) = shield.getAddressReputation(address(evilMerchant));
        assertEq(score, 50);
        assertEq(source, "Registry (Address)");

        // Transaction should revert because score (50) < minReputation (70)
        vm.prank(address(wallet));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentShield.ShieldReputationTooLow.selector,
                address(evilMerchant),
                50,
                70
            )
        );
        shield.checkAndRecord(address(evilMerchant), 1 ether);
    }

    function test_Reputation_DeterministicAddressFallback() public {
        // Get fallback reputation of an unregistered address
        (uint8 score, string memory source) = shield.getAddressReputation(address(0x12345));
        assertEq(source, "Heuristic (Deterministic Address Hash)");
        assertTrue(score >= 40 && score <= 85);
    }

    function test_Reputation_NameRegistry() public {
        // Pre-registered "openai" has 99 reputation
        (uint8 score, string memory source) = shield.getNameReputation("openai");
        assertEq(score, 99);
        assertEq(source, "Registry (Name)");

        // Set custom name reputation
        shield.setNameReputation("my-merchant", 95);
        (score, source) = shield.getNameReputation("my-merchant");
        assertEq(score, 95);
        assertEq(source, "Registry (Name)");
    }

    function test_Reputation_NameSuspiciousKeyword() public {
        // Keyword "free-crypto" is suspicious -> returns score 15
        (uint8 score, string memory source) = shield.getNameReputation("free-crypto-giveaway");
        assertEq(score, 15);
        assertEq(source, "Heuristic (Suspicious Keyword Match)");

        // Reverts check
        vm.prank(address(wallet));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentShield.ShieldReputationTooLowString.selector,
                "free-crypto-giveaway",
                15,
                70
            )
        );
        shield.checkAndRecordString("free-crypto-giveaway", address(merchant), 1 ether);
    }

    function test_Reputation_DeterministicNameFallback() public {
        // Non-registered, non-suspicious name should fallback to deterministic score matching TS SDK logic
        (uint8 score, string memory source) = shield.getNameReputation("some-generic-merchant-xyz");
        assertEq(source, "Heuristic (Deterministic Name Hash)");
        assertTrue(score >= 40 && score <= 85);

        // Verify hash consistency
        uint8 score2 = shield.getDeterministicScoreString("some-generic-merchant-xyz");
        assertEq(score, score2);
    }

    // --- Daily Limit Tests ---

    function test_DailyLimit() public {
        // Limit is 100 ether (default). Spend 60 ether.
        vm.prank(address(wallet));
        shield.checkAndRecord(address(merchant), 60 ether);

        // Spend 30 ether (total 90). Succeeds.
        vm.prank(address(wallet));
        shield.checkAndRecord(address(merchant), 30 ether);

        // Spend another 15 ether (total 105). Exceeds daily limit.
        vm.prank(address(wallet));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentShield.ShieldDailyLimitExceeded.selector,
                15 ether,
                100 ether,
                90 ether
            )
        );
        shield.checkAndRecord(address(merchant), 15 ether);
    }

    function test_DailyLimit_ResetsNextDay() public {
        // Spend 99 ether
        vm.prank(address(wallet));
        shield.checkAndRecord(address(merchant), 99 ether);

        // Warp 1 day forward
        vm.warp(block.timestamp + 1 days);

        // Spend 50 ether. Succeeds because it's a new day.
        vm.prank(address(wallet));
        bool approved = shield.checkAndRecord(address(merchant), 50 ether);
        assertTrue(approved);
    }

    // --- Rate Limit Tests ---

    function test_RateLimit() public {
        // Max requests = 5.
        // Make 5 requests.
        for (uint i = 0; i < 5; i++) {
            vm.prank(address(wallet));
            shield.checkAndRecord(address(merchant), 1 ether);
        }

        // 6th request should fail
        vm.prank(address(wallet));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentShield.ShieldRateLimitExceeded.selector,
                5, // activeCount
                5, // maxRequests
                60 // secUntilReset
            )
        );
        shield.checkAndRecord(address(merchant), 1 ether);
    }

    function test_RateLimit_ResetsAfterWindow() public {
        // Make 5 requests
        for (uint i = 0; i < 5; i++) {
            vm.prank(address(wallet));
            shield.checkAndRecord(address(merchant), 1 ether);
        }

        // Warp 61 seconds forward (window is 60s)
        vm.warp(block.timestamp + 61);

        // 6th request succeeds now
        vm.prank(address(wallet));
        bool approved = shield.checkAndRecord(address(merchant), 1 ether);
        assertTrue(approved);
    }

    // --- Smart Wallet Execution Integration ---

    function test_Wallet_ExecutionSuccess() public {
        uint256 startBal = address(merchant).balance;
        
        vm.prank(walletOwner);
        bytes memory result = wallet.execute(payable(address(merchant)), 10 ether, "");
        
        assertEq(address(merchant).balance, startBal + 10 ether);
        assertEq(result.length, 0);
    }

    function test_Wallet_ExecutionWithStringSuccess() public {
        uint256 startBal = address(merchant).balance;
        
        vm.prank(walletOwner);
        bytes memory result = wallet.executeWithString("openai", payable(address(merchant)), 5 ether, "");
        
        assertEq(address(merchant).balance, startBal + 5 ether);
        assertEq(result.length, 0);
    }

    function test_Wallet_ExecutionFail_NotOwner() public {
        vm.prank(address(0x1));
        vm.expectRevert(AgentWallet.WalletOnlyOwner.selector);
        wallet.execute(payable(address(merchant)), 10 ether, "");
    }

    function test_Wallet_ExecutionFail_ShieldBlock() public {
        // Set low reputation for merchant
        shield.setAddressReputation(address(evilMerchant), 50);

        vm.prank(walletOwner);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentShield.ShieldReputationTooLow.selector,
                address(evilMerchant),
                50,
                70
            )
        );
        wallet.execute(payable(address(evilMerchant)), 10 ether, "");
    }
}
