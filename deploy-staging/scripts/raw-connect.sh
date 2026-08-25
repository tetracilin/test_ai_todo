#!/bin/sh
# raw connectivity to the pinned bridge gateway from inside container
GW="${1:-172.20.0.1}"
echo "=== interfaces ==="
cat /proc/net/route | awk '{print $1, $2, $3, $8}'
echo "=== arp ==="
cat /proc/net/arp 2>/dev/null
echo "=== try TCP via node (no wget hang) ==="
node -e "
const net=require('net');
const s=net.connect(8642, process.argv[1]);
s.setTimeout(5000);
s.on('connect',()=>{console.log('CONNECT_OK'); s.end(); process.exit(0);});
s.on('error',(e)=>{console.log('CONNECT_ERR', e.code); process.exit(1);});
s.on('timeout',()=>{console.log('CONNECT_TIMEOUT'); process.exit(2);});
" "$GW"
echo "exit=$?"
