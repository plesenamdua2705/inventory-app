const { admin, auth, db } = require('../_adminFirebase');
const { requireAdmin } = require('../_requireAdmin');
const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY);

module.exports = async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  try {
    const { email, displayName = '', role = 'viewer' } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!['admin','contributor','viewer'].includes(role))
      return res.status(400).json({ error: 'Invalid role' });

    // 1) Buat/ambil user di Auth
    let user;
    try {
      user = await auth.getUserByEmail(email);
      if (displayName && user.displayName !== displayName) {
        user = await auth.updateUser(user.uid, { displayName });
      }
    } catch (_) {
      user = await auth.createUser({ email, displayName, disabled: false });
    }

    // 2) Simpan role di Firestore (+ metadata)
    await db.collection('users').doc(user.uid).set({
      email, displayName, role, disabled: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: ctx.uid,
    }, { merge: true });

    // (Opsional) custom claims
    await auth.setCustomUserClaims(user.uid, { role });

    // 3) Generate reset password link (server)
    const actionCodeSettings = {
      url: process.env.RESET_CONTINUE_URL || 'https://<your-domain>/login_main.html',
      handleCodeInApp: false,
    };
    const resetLink = await auth.generatePasswordResetLink(email, actionCodeSettings); // [2](https://github.com/Shubhamsahu1101/InventoryManagementApp)

    // 4) Kirim email via SendGrid
    if (!process.env.SENDGRID_API_KEY || !process.env.MAIL_FROM) {
      return res.status(500).json({ error: 'Email sender not configured' });
    }
    const brand = process.env.APP_BRAND_NAME || 'E‑Stock';
    await sgMail.send({
      to: email,
      from: process.env.MAIL_FROM,
      subject: `${brand}: Buat/Atur Password Akun Anda`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px">
          <h2>${brand}</h2>
          <p>Halo${displayName ? ` ${displayName}` : ''},</p>
          <p>Admin telah membuatkan akun untuk Anda. Klik tombol di bawah untuk membuat/ mengatur password:</p>
          <p style="margin:24px 0">
            ${resetLink}
              Buat / Atur Password
            </a>
          </p>
          <p>Jika tombol di atas tidak bekerja, salin tautan berikut ke browser Anda:</p>
          <p>${resetLink}${resetLink}</a></p>
          <hr/>
          <p style="color:#666;font-size:12px">Email ini dikirim otomatis. Jika butuh bantuan, hubungi admin.</p>
        </div>
      `,
    });

    return res.status(201).json({ uid: user.uid, email, role, mailed: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
};
