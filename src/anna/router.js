const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Modelo
const inviteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  code: { type: String, unique: true, required: true },
  scanned: { type: Boolean, default: false },
  scannedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const Invite = mongoose.models.Invite || mongoose.model('Invite', inviteSchema);

// Transporter de email
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.ANNA_SMTP_HOST,
    port: parseInt(process.env.ANNA_SMTP_PORT) || 587,
    secure: parseInt(process.env.ANNA_SMTP_PORT) === 465,
    auth: {
      user: process.env.ANNA_SMTP_USER,
      pass: process.env.ANNA_SMTP_PASS
    }
  });
}

// POST /invites
router.post('/invites', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Nombre y correo son requeridos' });
    }

    const code = uuidv4();

    const qrDataUrl = await QRCode.toDataURL(code, {
      width: 300,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });

    const invite = new Invite({ name, email, code });
    await invite.save();

    const transporter = createTransporter();
    const qrBase64 = qrDataUrl.split(',')[1];

    await transporter.sendMail({
      from: process.env.ANNA_SMTP_FROM || process.env.ANNA_SMTP_USER,
      to: email,
      subject: 'Tu invitación — Maíz que Nada',
      html: `
        <!DOCTYPE html>
        <html lang="es">
        <head><meta charset="UTF-8" /></head>
        <body style="margin:0;padding:0;background:#f5f5f5;font-family:Georgia,'Times New Roman',serif;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
            <tr>
              <td align="center" style="padding:24px 16px;">
                <table width="580" cellpadding="0" cellspacing="0" border="0"
                  style="max-width:580px;width:100%;background:#ffffff;border:6px solid #e5510a;">
                  <tr>
                    <td width="22" height="22" style="background:#e5510a;font-size:0;line-height:0;">&nbsp;</td>
                    <td style="background:#ffffff;font-size:0;line-height:0;">&nbsp;</td>
                    <td width="22" height="22" style="background:#e5510a;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                  <tr>
                    <td colspan="3" style="padding:12px 32px 0 32px;">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="50%" valign="middle" style="padding-right:16px;">
                            <img src="https://proy-anna.s3.us-east-2.amazonaws.com/logofull.png"
                                 width="210" alt="Maíz que Nada"
                                 style="display:block;max-width:210px;width:100%;height:auto;" />
                          </td>
                          <td width="50%" valign="middle" align="center"
                              style="text-align:center;color:#1a1a1a;font-family:Georgia,'Times New Roman',serif;">
                            <p style="margin:0 0 6px 0;font-size:15px;line-height:1.4;">sábado 25 de abril 2026</p>
                            <p style="margin:0 0 10px 0;font-size:15px;line-height:1.4;">4:00 p.m</p>
                            <p style="margin:0 0 14px 0;font-size:13px;line-height:1.6;color:#333;">
                              Casa Abierta:<br />
                              Ambrosio Ulloa 72, Los Maestros,<br />
                              45150 Zapopan, Jal.
                            </p>
                            <img src="https://proy-anna.s3.us-east-2.amazonaws.com/logopatro.jpeg"
                                 width="80" alt="Casa Abierta"
                                 style="display:inline-block;max-width:80px;height:auto;" />
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="3" style="padding:18px 32px 0 32px;">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="border-top:2px dashed #e5510a;font-size:0;line-height:0;">&nbsp;</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="3" align="center" style="padding:14px 0 4px 0;">
                      <img src="https://proy-anna.s3.us-east-2.amazonaws.com/logosmall.png"
                           width="36" alt=""
                           style="display:inline-block;max-width:36px;height:auto;" />
                    </td>
                  </tr>
                  <tr>
                    <td colspan="3" align="center" style="padding:24px 32px 28px 32px;">
                      <img src="cid:qrcode" width="220" height="220" alt="Código QR"
                           style="display:block;margin:0 auto;border:3px solid #1a1a2e;border-radius:6px;" />
                      <p style="margin:14px 0 0 0;font-family:Arial,sans-serif;font-size:12px;
                                color:#aaa;text-align:center;">
                        Invitación personal para <strong style="color:#555;">${name}</strong> &mdash; código único de un solo uso.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td width="22" height="22" style="background:#e5510a;font-size:0;line-height:0;">&nbsp;</td>
                    <td style="background:#ffffff;font-size:0;line-height:0;">&nbsp;</td>
                    <td width="22" height="22" style="background:#e5510a;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      attachments: [
        {
          filename: 'qr.png',
          content: qrBase64,
          encoding: 'base64',
          cid: 'qrcode'
        }
      ]
    });

    res.json({
      success: true,
      invite: { id: invite._id, name, email, code, createdAt: invite.createdAt }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /invites
router.get('/invites', async (req, res) => {
  try {
    const invites = await Invite.find().sort({ createdAt: -1 });
    res.json(invites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /scan
router.post('/scan', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Código requerido' });
    }

    const invite = await Invite.findOne({ code });

    if (!invite) {
      return res.status(404).json({ error: 'Código QR inválido' });
    }

    if (invite.scanned) {
      return res.status(409).json({
        error: 'Este código ya fue escaneado',
        scannedAt: invite.scannedAt
      });
    }

    invite.scanned = true;
    invite.scannedAt = new Date();
    await invite.save();

    res.json({ success: true, name: invite.name, email: invite.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /invites/:id
router.delete('/invites/:id', async (req, res) => {
  try {
    await Invite.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
