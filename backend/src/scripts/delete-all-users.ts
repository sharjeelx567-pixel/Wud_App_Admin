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

async function deleteAllUsers() {
    console.log('Starting to delete all users...');

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

    // 2. Delete all firestore users
    console.log('Deleting users from Firestore...');
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();
    
    let firestoreDeletedCount = 0;
    const batches: Promise<any>[] = [];
    let currentBatch = db.batch();
    let operationCounter = 0;
    
    snapshot.forEach((doc: any) => {
        currentBatch.delete(doc.ref);
        operationCounter++;
        firestoreDeletedCount++;
        
        if (operationCounter === 500) {
            batches.push(currentBatch.commit());
            currentBatch = db.batch();
            operationCounter = 0;
        }
    });
    
    if (operationCounter > 0) {
        batches.push(currentBatch.commit());
    }
    
    await Promise.all(batches);
    console.log(`Total Firestore users deleted: ${firestoreDeletedCount}`);
    
    console.log('Finished deleting all users.');
    process.exit(0);
}

deleteAllUsers().catch((error: any) => {
    console.error('Error deleting users:', error);
    process.exit(1);
});
