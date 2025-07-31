#!/bin/bash

echo "Testing MCP server shutdown behavior..."
echo "======================================="

# Test: Start server, send SIGTERM, check for clean output
echo -e "\nTest: Starting server and sending SIGTERM after 2 seconds"
echo "Expected: Only JSON-RPC output, no shutdown messages"
echo ""

# Start the server in background and capture all output
./build/mcp-process-server > output.log 2>&1 &
SERVER_PID=$!

echo "Server started with PID: $SERVER_PID"
sleep 2

echo "Sending SIGTERM to server..."
kill -TERM $SERVER_PID 2>/dev/null

# Wait a bit for shutdown
sleep 1

echo -e "\nServer output:"
echo "=============="
cat output.log
echo "=============="

# Check if server shut down
if ps -p $SERVER_PID > /dev/null 2>&1; then
    echo -e "\n⚠️  WARNING: Server still running, force killing..."
    kill -9 $SERVER_PID 2>/dev/null
else
    echo -e "\n✅ Server shut down successfully"
fi

# Check for non-JSON output
echo -e "\nChecking for non-JSON output..."
if grep -E '\[Main\]|\[.*\] (ERROR|WARNING|INFO|DEBUG):' output.log > /dev/null; then
    echo "❌ FAILED: Found log messages in output!"
    echo "These messages will break Claude Code:"
    grep -E '\[Main\]|\[.*\] (ERROR|WARNING|INFO|DEBUG):' output.log
else
    echo "✅ PASSED: No log messages found in output"
fi

# Cleanup
rm -f output.log

echo -e "\n======================================="
echo "Test complete!"