// === SAFETY GUARD (added) — this script permanently deletes data. ===
if (process.env.CONFIRM_DESTRUCTIVE !== 'YES_WIPE_PRODUCTION') {
  console.error('[ABORTED] Refusing to run a destructive script. Re-run with CONFIRM_DESTRUCTIVE=YES_WIPE_PRODUCTION to delete data on purpose.');
  process.exit(1);
}
import * as admin from 'firebase-admin';

// Initialize firebase admin
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function deleteCollection(collectionPath: string) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.limit(500);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query: FirebaseFirestore.Query, resolve: any) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}

async function wipeAll() {
  const collections = ['users', 'verification_requests', 'matches', 'chats', 'messages', 'reports'];
  for (const coll of collections) {
    console.log(`Deleting collection: ${coll}`);
    await deleteCollection(coll);
  }
  console.log('Database wiped successfully.');
}

wipeAll().then(() => process.exit(0)).catch(console.error);
