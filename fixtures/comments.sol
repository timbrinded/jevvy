// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Clamp {
    /// @notice Returns the greater of a and b.
    function maximum(uint a, uint b) public pure returns (uint) {
        return a > b ? a : b;
    }
}
