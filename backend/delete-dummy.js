// === SAFETY GUARD (added) — this script permanently deletes data. ===
if (process.env.CONFIRM_DESTRUCTIVE !== 'YES_WIPE_PRODUCTION') {
  console.error('[ABORTED] Refusing to run a destructive script. Re-run with CONFIRM_DESTRUCTIVE=YES_WIPE_PRODUCTION to delete data on purpose.');
  process.exit(1);
}
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function deleteDummyProfiles() {
  const snap = await db.collection('users').get();
  let count = 0;
  const toDelete = [];
  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data();
    if (uid.startsWith('dummy_') || data.isDummy === true) {
      toDelete.push(doc.ref);
      count++;
      console.log('Marking for deletion:', uid);
    }
  }
  if (count > 0) {
    // Firestore batch limit is 500
    for (let i = 0; i < toDelete.length; i += 500) {
      const batch = db.batch();
      toDelete.slice(i, i + 500).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
    console.log('SUCCESS: Deleted', count, 'dummy profiles from users collection');
  } else {
    console.log('No dummy profiles found in Firestore (already clean!)');
  }
  process.exit(0);
}

deleteDummyProfiles().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
