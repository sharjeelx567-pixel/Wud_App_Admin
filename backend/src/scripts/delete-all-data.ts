// === SAFETY GUARD (added) — this script permanently deletes data. ===
if (process.env.CONFIRM_DESTRUCTIVE !== 'YES_WIPE_PRODUCTION') {
  console.error('[ABORTED] Refusing to run a destructive script. Re-run with CONFIRM_DESTRUCTIVE=YES_WIPE_PRODUCTION to delete data on purpose.');
  process.exit(1);
}
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as path from 'path';
import * as fs from 'fs';

const keyPath = path.resolve(__dirname, '../../serviceAccountKey.json');
let serviceAccount;
try {
    serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
} catch(e) {
    serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
}

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();
const auth = getAuth();

async function deleteCollection(collectionPath: string) {
    console.log(`Recursively deleting collection: ${collectionPath}...`);
    const collectionRef = db.collection(collectionPath);
    const snapshot = await collectionRef.get();
    let count = 0;
    for (const doc of snapshot.docs) {
        if (db.recursiveDelete) {
            await db.recursiveDelete(doc.ref);
        } else {
            await doc.ref.delete();
        }
        count++;
    }
    console.log(`Deleted ${count} root documents (and their subcollections) from ${collectionPath}`);
}

async function wipeAllUserData() {
    console.log('Starting to delete all users and related data...');

    // 1. Delete all auth users
    let nextPageToken;
    let authDeletedCount = 0;
    do {
        const listUsersResult = await auth.listUsers(1000, nextPageToken);
        const uids = listUsersResult.users.map((user: any) => user.uid);
        
        if (uids.length > 0) {
            const deleteResult = await auth.deleteUsers(uids);
            authDeletedCount += deleteResult.successCount;
            console.log(`Deleted ${deleteResult.successCount} users from Auth. Failed: ${deleteResult.failureCount}`);
        }
        
        nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);
    
    console.log(`Total Auth users deleted: ${authDeletedCount}`);

    // 2. Delete all related collections
    const collectionsToClear = [
        'users',
        'discover_feed_cache',
        'private_preferences',
        'compatibility_assessments',
        'connection_requests',
        'user_passes',
        'chats',
        'messages'
    ];

    for (const col of collectionsToClear) {
        await deleteCollection(col);
    }
    
    console.log('Finished deleting all users and related data.');
    process.exit(0);
}

wipeAllUserData().catch((error: any) => {
    console.error('Error wiping data:', error);
    process.exit(1);
});
