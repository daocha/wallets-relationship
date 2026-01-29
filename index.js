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

// Add this utility function near the top of your index.js
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Address Formatter: 1234...mid...abcd (First 4, Mid 3, Last 4)
 */
function shorten(addr) {
    if (!addr || addr.length < 15) return addr;
    const len = addr.length;
    const start = addr.slice(0, 4);
    const end = addr.slice(-4);
    const midStart = Math.floor(len / 2) - 1;
    const mid = addr.slice(midStart, midStart + 3);
    return `${start}...${mid}...${end}`;
}

/**
 * Fetch Solana transfers with pagination support
 */
async function fetchSolanaTransfers(address, socket) {
    let connections = new Map();
    let lastSignature = null;
    const maxPages = 10; // Scan up to 500 transactions total

    // --- Testing Purpose, exclude Transaction ID ---
    const excludeTx = "******";

    for (let page = 1; page <= maxPages; page++) {
        socket.emit('progress', { message: `Scanning ${shorten(address)} (Page ${page})...`, transient: true });

        let url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${process.env.HELIUS_API_KEY}`;
        if (lastSignature) url += `&before=${lastSignature}`;

        try {
            const { data } = await axios.get(url);

            // Add a small delay after a successful request to respect rate limits
            await sleep(300);

            if (!data || data.length === 0) break;

            data.forEach(tx => {
                if (tx.signature === excludeTx) {
                    console.log(`[Test] Excluding transaction: ${tx.signature}`);
                    return; // Temporarily exclude this transaction
                }

                [...(tx.nativeTransfers || []), ...(tx.tokenTransfers || [])].forEach(t => {
                    const isSender = t.fromUserAccount === address;
                    const other = isSender ? t.toUserAccount : t.fromUserAccount;
                    if (other && other !== address) {
                        // Maintain original case for Solana
                        connections.set(other, {
                            tx: tx.signature,
                            role: isSender ? 'sent_to' : 'received_from'
                        });
                    }
                });
                lastSignature = tx.signature;
            });

            if (data.length < 100) break;
        } catch (e) {
            console.error(`Helius API Error: ${e.message}`);
            break;
        }
    }
    return connections;
}

async function getCachedTransfers(address, chain, socket) {
    if (txCache.has(address)) return txCache.get(address);

    let connections = new Map();
    if (chain === 'SOL') {
        connections = await fetchSolanaTransfers(address, socket);
    } else if (chain === 'ETH') {
        const addrLower = address.toLowerCase();
        for (let page = 1; page <= 2; page++) {
            const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${addrLower}&page=${page}&offset=100&sort=desc&apikey=${process.env.ETHERSCAN_API_KEY}`;
            try {
                const { data } = await axios.get(url);
                if (!data.result || data.result.length === 0) break;
                data.result.forEach(t => {
                    const isSender = t.from.toLowerCase() === addrLower;
                    const other = (isSender ? t.to : t.from).toLowerCase();
                    if (other !== addrLower) {
                        connections.set(other, { tx: t.hash, role: isSender ? 'sent_to' : 'received_from' });
                    }
                });
                if (data.result.length < 100) break;
            } catch (e) { break; }
        }
    }

    txCache.set(address, connections);
    return connections;
}

io.on('connection', (socket) => {
    socket.on('check-relationship', async ({ addrA, addrB, maxHops }) => {
        try {
            const infoA = identifyWallet(addrA);
            const hops = parseInt(maxHops) || 2;
            const spamNotes = [];

            // Case sensitivity logic
            const startA = infoA.chain === 'SOL' ? addrA : addrA.toLowerCase();
            const startB = infoA.chain === 'SOL' ? addrB : addrB.toLowerCase();

            let visitedA = new Map([[startA, { parent: null, tx: null, role: null }]]);
            let visitedB = new Map([[startB, { parent: null, tx: null, role: null }]]);
            let queueA = [startA];
            let queueB = [startB];
            let meetingPoint = null;

            socket.emit('progress', { message: `Investigating... Max Hops: ${hops}`, transient: false });

            for (let step = 1; step <= hops; step++) {
                let currentSide = (step % 2 !== 0) ? 'A' : 'B';
                let currentQueue = (currentSide === 'A') ? queueA : queueB;
                let myVisited = (currentSide === 'A') ? visitedA : visitedB;
                let otherVisited = (currentSide === 'A') ? visitedB : visitedA;
                let nextQueue = [];

                for (let curr of currentQueue) {
                    const neighbors = await getCachedTransfers(curr, infoA.chain, socket);
                    for (let [neighbor, info] of neighbors) {
                        const neighborKey = infoA.chain === 'SOL' ? neighbor : neighbor.toLowerCase();

                        if (!myVisited.has(neighborKey)) {
                            myVisited.set(neighborKey, { parent: curr, tx: info.tx, role: info.role });
                            nextQueue.push(neighborKey);

                            if (otherVisited.has(neighborKey)) {
                                const dataA = (currentSide === 'A') ? myVisited.get(neighborKey) : otherVisited.get(neighborKey);
                                const dataB = (currentSide === 'B') ? myVisited.get(neighborKey) : otherVisited.get(neighborKey);

                                if (dataA.role === 'received_from' && dataB.role === 'received_from') {
                                    spamNotes.push({ address: neighborKey, txA: dataA.tx, txB: dataB.tx });
                                } else {
                                    meetingPoint = neighborKey;
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

            const formatSpam = spamNotes.map(s => ({
                address: shorten(s.address), urlA: infoA.txBase + s.txA, urlB: infoA.txBase + s.txB
            }));

            if (meetingPoint) {
                const path = reconstructPath(visitedA, visitedB, meetingPoint, infoA.txBase);
                socket.emit('conclusion', { status: `Connection Found (${path.length} Hops)`, evidence: path, spamNotes: formatSpam });
            } else {
                socket.emit('conclusion', { status: 'No significant relationship found.', evidence: [], spamNotes: formatSpam });
            }
        } catch (err) { socket.emit('error', err.message); }
    });
});

/**
 * Reconstructs the path ensuring output is ALWAYS: Sender -> Receiver
 */
function reconstructPath(vA, vB, middle, base) {
    let path = [];

    // Trace back from middle to Source A
    let curr = middle;
    while (curr) {
        const step = vA.get(curr);
        if (!step || !step.parent) break;

        // If A side record says 'sent_to', then parent sent to curr
        // If A side record says 'received_from', then curr sent to parent
        const sender = step.role === 'sent_to' ? step.parent : curr;
        const receiver = step.role === 'sent_to' ? curr : step.parent;

        path.unshift({
            pair: `${shorten(sender)} → ${shorten(receiver)}`,
            url: base + step.tx
        });
        curr = step.parent;
    }

    // Trace from middle to Target B
    curr = middle;
    while (curr) {
        const step = vB.get(curr);
        if (!step || !step.parent) break;

        // B side logic is mirroring A:
        // If B's step role is 'sent_to', then parent (closer to B) sent to curr (closer to middle)
        // We want the arrow to always show Sender -> Receiver.
        const sender = step.role === 'sent_to' ? step.parent : curr;
        const receiver = step.role === 'sent_to' ? curr : step.parent;

        path.push({
            pair: `${shorten(sender)} → ${shorten(receiver)}`,
            url: base + step.tx
        });
        curr = step.parent;
    }
    return path;
}

function identifyWallet(addr) {
    const isSol = WAValidator.validate(addr, 'sol');
    return {
        chain: isSol ? 'SOL' : 'ETH',
        txBase: isSol ? 'https://solscan.io/tx/' : 'https://etherscan.io/tx/'
    };
}

server.listen(process.env.PORT || 3000, () => console.log('Investigator Active on :3000'));
