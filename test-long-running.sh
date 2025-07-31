#!/bin/bash

echo "Testing MCP server for 10 seconds to ensure no periodic output..."
echo "========================================================="

# Start the server and capture output
./build/mcp-process-server > output.log 2>&1 &
SERVER_PID=$!

echo "Server started with PID: $SERVER_PID"
echo "Monitoring for 10 seconds..."

# Monitor for 10 seconds
for i in {1..10}; do
  echo -n "."
  sleep 1
done
echo ""

# Kill the server
kill -TERM $SERVER_PID 2>/dev/null
sleep 1

# Check output
echo -e "\nServer output:"
echo "=============="
cat output.log
echo "=============="

# Check file size
SIZE=$(wc -c < output.log)
echo -e "\nOutput file size: $SIZE bytes"

if [ $SIZE -gt 0 ]; then
  echo "❌ FAILED: Server produced output when it should be silent"
else
  echo "✅ PASSED: Server remained silent as expected"
fi

# Cleanup
rm -f output.log

echo -e "\n========================================================="
echo "Test complete!"