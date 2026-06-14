// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Script} from "forge-std/Script.sol";
import {AgentShield} from "../src/AgentShield.sol";
import {AgentWallet} from "../src/AgentWallet.sol";

contract DeployAgentShield is Script {
    function setUp() public {}

    function run() public returns (AgentShield shield, AgentWallet wallet) {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));

        if (deployerPrivateKey != 0) {
            vm.startBroadcast(deployerPrivateKey);
        } else {
            vm.startBroadcast();
        }

        shield = new AgentShield();
        wallet = new AgentWallet(address(shield));

        vm.stopBroadcast();
    }
}
