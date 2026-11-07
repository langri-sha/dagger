const std = @import("std");

fn add(a: i32, b: i32) i32 {
    return a + b;
}

pub fn main() void {
    std.debug.print("sum {d}\n", .{add(2, 2)});
}

test "add sums its arguments" {
    try std.testing.expectEqual(5, add(2, 2));
}
