// === SAFETY GUARD (added) — this script permanently deletes data. ===
if (process.env.CONFIRM_DESTRUCTIVE !== 'YES_WIPE_PRODUCTION') {
  console.error('[ABORTED] Refusing to run a destructive script. Re-run with CONFIRM_DESTRUCTIVE=YES_WIPE_PRODUCTION to delete data on purpose.');
  process.exit(1);
}
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const serviceAccount = require('./serviceAccountKey.json');
initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const auth = getAuth();

async function deleteCollection(collectionPath) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.limit(500);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query, resolve) {
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

async function deleteAllAuthUsers() {
  let nextPageToken = undefined;
  do {
    const listUsersResult = await auth.listUsers(1000, nextPageToken);
    const uids = listUsersResult.users.map((userRecord) => userRecord.uid);
    if (uids.length > 0) {
      await auth.deleteUsers(uids);
      console.log(`Deleted ${uids.length} users from Firebase Auth.`);
    }
    nextPageToken = listUsersResult.pageToken;
  } while (nextPageToken);
}

async function cleanUsers() {
  console.log('Deleting users from Firestore...');
  await deleteCollection('users');
  console.log('Deleting users from Firebase Auth...');
  await deleteAllAuthUsers();
  console.log('User section cleaned successfully!');
}

cleanUsers().then(() => process.exit(0)).catch(console.error);
