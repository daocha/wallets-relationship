require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const WAValidator = require('multicoin-address-validator');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

// --- GLOBAL IN-MEMORY CACHE ---
const txCache = new Map();

/**
 * Fancy Address Formatter: 0x1234...abcd
 */
function shorten(addr) {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

async function getCachedTransfers(address, chain, socket) {
    if (txCache.has(address)) return txCache.get(address);

    const connections = new Map();
    socket.emit('progress', { message: `API Query: Scanning ${shorten(address)}...`, transient: true });

    try {
        if (chain === 'SOL') {
            const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${process.env.HELIUS_API_KEY}`;
            const { data } = await axios.get(url);
            (data || []).forEach(tx => {
                [...(tx.nativeTransfers || []), ...(tx.tokenTransfers || [])].forEach(t => {
                    const isSender = t.fromUserAccount === address;
                    const other = isSender ? t.toUserAccount : t.fromUserAccount;
                    if (other && other !== address) {
                        connections.set(other, { tx: tx.signature, role: isSender ? 'sent_to' : 'received_from' });
                    }
                });
            });
        } else if (chain === 'ETH') {
            const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            const { data } = await axios.get(url);
            (data.result || []).forEach(t => {
                const isSender = t.from.toLowerCase() === address.toLowerCase();
                const other = isSender ? t.to : t.from;
                if (other && other.toLowerCase() !== address.toLowerCase()) {
                    connections.set(other, { tx: t.hash, role: isSender ? 'sent_to' : 'received_from' });
                }
            });
        }
        txCache.set(address, connections);
    } catch (e) { console.error(`Error: ${e.message}`); }
    return connections;
}

io.on('connection', (socket) => {
    socket.on('check-relationship', async ({ addrA, addrB, maxHops }) => {
        try {
            const wA = identifyWallet(addrA);
            const wB = identifyWallet(addrB);
            const hops = parseInt(maxHops) || 2;
            const spamNotes = [];

            let visitedA = new Map([[addrA, { parent: null, tx: null, role: null }]]);
            let visitedB = new Map([[addrB, { parent: null, tx: null, role: null }]]);
            let queueA = [addrA];
            let queueB = [addrB];
            let meetingPoint = null;

            socket.emit('progress', { message: `Tracing path (Max Depth: ${hops} Hops)...`, transient: false });

            // The loop runs for the number of hops.
            // In a bidirectional search, we alternate sides.
            for (let step = 1; step <= hops; step++) {
                let currentSide = (step % 2 !== 0) ? 'A' : 'B';
                let currentQueue = (currentSide === 'A') ? queueA : queueB;
                let myVisited = (currentSide === 'A') ? visitedA : visitedB;
                let otherVisited = (currentSide === 'A') ? visitedB : visitedA;

                let nextQueue = [];

                for (let curr of currentQueue) {
                    const neighbors = await getCachedTransfers(curr, wA.chain, socket);
                    for (let [neighbor, info] of neighbors) {
                        if (!myVisited.has(neighbor)) {
                            myVisited.set(neighbor, { parent: curr, tx: info.tx, role: info.role });
                            nextQueue.push(neighbor);

                            // Check if frontiers meet
                            if (otherVisited.has(neighbor)) {
                                const infoA = (currentSide === 'A') ? myVisited.get(neighbor) : otherVisited.get(neighbor);
                                const infoB = (currentSide === 'B') ? myVisited.get(neighbor) : otherVisited.get(neighbor);

                                if (infoA.role === 'received_from' && infoB.role === 'received_from') {
                                    // SPAM: Both received from this address. Log as note, don't stop search.
                                    spamNotes.push({ address: neighbor, txA: infoA.tx, txB: infoB.tx });
                                } else {
                                    meetingPoint = neighbor;
                                    break;
                                }
                            }
                        }
                    }
                    if (meetingPoint) break;
                }

                if (currentSide === 'A') queueA = nextQueue; else queueB = nextQueue;
                if (meetingPoint || (queueA.length === 0 && queueB.length === 0)) break;
            }

            const formattedSpam = spamNotes.map(s => ({
                address: shorten(s.address),
                urlA: wA.txBase + s.txA,
                urlB: wA.txBase + s.txB
            }));

            if (meetingPoint) {
                const fullPath = reconstructPath(visitedA, visitedB, meetingPoint, wA.txBase);
                socket.emit('conclusion', {
                    status: `Significant Connection Found (${fullPath.length} Hops)`,
                    evidence: fullPath,
                    spamNotes: formattedSpam
                });
            } else {
                socket.emit('conclusion', {
                    status: 'No significant relationship found.',
                    evidence: [],
                    spamNotes: formattedSpam
                });
            }
        } catch (err) { socket.emit('error', err.message); }
    });
});

function reconstructPath(vA, vB, middle, base) {
    let path = [];
    let curr = middle;
    while (curr && vA.get(curr).parent) {
        const step = vA.get(curr);
        path.unshift({ pair: `${shorten(step.parent)} → ${shorten(curr)}`, url: base + step.tx });
        curr = step.parent;
    }
    curr = middle;
    while (curr && vB.get(curr).parent) {
        const step = vB.get(curr);
        path.push({ pair: `${shorten(curr)} → ${shorten(step.parent)}`, url: base + step.tx });
        curr = step.parent;
    }
    return path;
}

function identifyWallet(addr) {
    const chain = WAValidator.validate(addr, 'sol') ? 'SOL' : 'ETH';
    return {
        chain,
        txBase: chain === 'SOL' ? 'https://solscan.io/tx/' : 'https://etherscan.io/tx/',
        name: chain
    };
}

server.listen(process.env.PORT || 3000, () => console.log('Investigator Active on :3000'));
