// 2-node P2P sync test — SEPARATE HOME per node (temporary)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const HOME_A = mkdtempSync(join(tmpdir(), 'koshi-p2p-A-'));
const HOME_B = mkdtempSync(join(tmpdir(), 'koshi-p2p-B-'));
const envA = { ...process.env, HOME: HOME_A, NO_COLOR: '1' };
const envB = { ...process.env, HOME: HOME_B, NO_COLOR: '1' };
const KB = join(import.meta.dirname, 'bin', 'cli.js');
const CLI = (env, args) => execFileSync(process.execPath, [KB, ...args], { env, encoding: 'utf8', timeout: 30_000 });

const PORT_A = 3201;
const PORT_B = 3202;

console.log('== Node A (own HOME): register + post ==');
console.log(CLI(envA, ['register', 'alice']));
console.log(CLI(envA, ['post', 'hello from node A via p2p']));

console.log('== Node B (own HOME): register ==');
console.log(CLI(envB, ['register', 'bob']));

console.log(`== starting node A (port ${PORT_A}) ==`);
const nodeA = spawn(process.execPath, [KB, 'serve', `--port=${PORT_A}`], { env: envA, stdio: ['ignore', 'pipe', 'pipe'] });
nodeA.stdout.on('data', (d) => process.stdout.write(`[A] ${d}`));
nodeA.stderr.on('data', (d) => process.stderr.write(`[A!] ${d}`));

console.log(`== starting node B (port ${PORT_B}) ==`);
const nodeB = spawn(process.execPath, [KB, 'serve', `--port=${PORT_B}`], { env: envB, stdio: ['ignore', 'pipe', 'pipe'] });
nodeB.stdout.on('data', (d) => process.stdout.write(`[B] ${d}`));
nodeB.stderr.on('data', (d) => process.stderr.write(`[B!] ${d}`));

const getJSON = async (port, path) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`).catch(() => null);
    if (!res || !res.ok) return null;
    return res.json();
};

console.log('== waiting up to 150s for P2P discovery + sync ==');
let found = false;
for (let t = 5; t <= 150; t += 5) {
    await new Promise((r) => setTimeout(r, 5000));
    const feedA = await getJSON(PORT_A, '/api/posts/feed');
    const feedB = await getJSON(PORT_B, '/api/posts/feed');
    const p2pA = await getJSON(PORT_A, '/api/p2p/status');
    const p2pB = await getJSON(PORT_B, '/api/p2p/status');
    const aCount = feedA?.length ?? '?';
    const bCount = feedB?.length ?? '?';
    const aPeers = p2pA?.peers ?? '?';
    const bPeers = p2pB?.peers ?? '?';
    console.log(`  [t=${t}s] A feed=${aCount} B feed=${bCount} Apeers=${aPeers} Bpeers=${bPeers}`);
    if (Array.isArray(feedB) && feedB.some((p) => (p.content || '').includes('hello from node A via p2p'))) {
        found = true;
        console.log('SYNC OK: Node B received the post from Node A!');
        console.log(JSON.stringify(feedB, null, 2));
        break;
    }
}

const finalA = await getJSON(PORT_A, '/api/posts/feed');
const finalB = await getJSON(PORT_B, '/api/posts/feed');
console.log('\n=== RESULTS ===');
console.log('Node A feed:', JSON.stringify(finalA, null, 2));
console.log('Node B feed:', JSON.stringify(finalB, null, 2));
console.log('P2P sync (A->B):', found ? 'PASS' : 'FAIL');

nodeA.kill('SIGTERM');
nodeB.kill('SIGTERM');
setTimeout(() => { nodeA.kill('SIGKILL'); nodeB.kill('SIGKILL'); }, 3000);
process.exit(found ? 0 : 1);
