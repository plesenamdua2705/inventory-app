const { auth, db } = require('./_adminFirebase');

async function requireAdmin(req, res) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing ID token' });
    return null;
  }
  try {
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;
    const snap = await db.collection('users').doc(uid).get();
    const role = snap.exists ? snap.data().role : 'viewer';
    if (role !== 'admin') {
      res.status(403).json({ error: 'Admin only' });
      return null;
    }
    return { uid };
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired ID token' });
    return null;
  }
}

module.exports = { requireAdmin };
