//! Utilities for clamping values.

/// Returns zero when the argument is negative.
pub fn clamp(value: i32) -> i32 {
    value.max(0)
}
