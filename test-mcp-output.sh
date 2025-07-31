#!/bin/bash

echo "Testing MCP server output..."
echo "==============================="

# Test 1: Run the server and capture first few lines
echo -e "\nTest 1: Checking initial output (should be JSON-RPC only)"
echo "Running: ./build/mcp-process-server"
echo "First 200 characters of output:"
timeout 2s ./build/mcp-process-server 2>&1 | head -c 200 | cat -v
echo -e "\n"

# Test 2: Send a proper initialize request
echo -e "\nTest 2: Sending initialize request"
echo "Request:"
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"0.1.0","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'
echo ""
echo "Response:"
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"0.1.0","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}' | timeout 2s ./build/mcp-process-server 2>&1 | head -n 5

echo -e "\n==============================="
echo "If you see any non-JSON output above (like '[Main] Server...' messages), the server needs fixing."
echo "The output should ONLY contain JSON-RPC messages."