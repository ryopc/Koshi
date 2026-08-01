// Minimal corestore v7 test: does a core opened AFTER replicate() sync?
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Duplex } from 'node:stream';
import b4a from 'b4a';

const root = mkdtempSync(join(tmpdir(), 'corestore-test-'));
const dirA = join(root, 'A');
const dirB = join(root, 'B');

const { default: Corestore } = await import('corestore');
const { default: Hypercore } = await import('hypercore');

const storeA = new Corestore(dirA);
const storeB = new Corestore(dirB);

// A creates + appends to its posts core BEFORE any replication
const postsA = storeA.get({ name: 'posts' });
await postsA.ready();
await postsA.append(b4a.from(JSON.stringify({ type: 'post', content: 'hello world', id: 'p1' })));
console.log('A posts core key:', b4a.toString(postsA.key, 'hex'));
console.log('A posts length:', postsA.length);

// Set up live replication between A and B (simulating a swarm connection)
const streamA = storeA.replicate(true, { live: true });
const streamB = storeB.replicate(false, { live: true });
streamA.pipe(streamB).pipe(streamA);

// NOW B opens A's posts core by key (simulating onPeerHello after connect)
const postsB = storeB.get({ key: postsA.key });
await postsB.ready();
console.log('B opened A posts core. length before sync:', postsB.length);

// Wait a bit for replication
await new Promise((r) => setTimeout(r, 3000));
await postsB.update();
console.log('B posts core length after 3s:', postsB.length);

if (postsB.length > 0) {
    const block = JSON.parse(b4a.toString(await postsB.get(0)));
    console.log('B read block:', JSON.stringify(block));
    console.log('RESULT: PASS — late-opened remote core replicates');
} else {
    console.log('RESULT: FAIL — late-opened remote core does NOT replicate');
}

storeA.close(); storeB.close();
process.exit(0);
