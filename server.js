const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const XLSX = require('xlsx');
const moment = require('moment-timezone');

const app = express();
const PORT = 3000;

const upload = multer({ dest: 'uploads/' });

let qrCode = '';
let isReady = false;
let adminChatId = '';
let client = null;
const sentMessagesMap = new Map(); // Menyimpan ID pesan untuk tracking ack

function createNewClient() {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true }
  });

  client.on('qr', async qr => {
    qrCode = await qrcode.toDataURL(qr);
    console.log('📸 QR Code updated');
  });

  client.on('ready', () => {
    isReady = true;
    console.log('✅ WhatsApp siap!');
  });

  client.on('authenticated', () => {
    console.log('🔐 Autentikasi berhasil');
  });

  client.on('auth_failure', () => {
    console.log('❌ Autentikasi gagal');
  });

  // Tambahkan kembali listener penting lainnya jika perlu
  client.initialize();
}

// Inisialisasi pertama kali
createNewClient();

app.use(express.static('public'));

app.get('/qr', (req, res) => {
  res.json({ qr: qrCode, ready: isReady });
});

app.get('/form', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'form.html'));
});

app.get('/status', async (req, res) => {
  try {
    const isConnected = client.info && client.info.wid;
    res.json({ ready: isConnected });
  } catch (err) {
    res.json({ ready: false });
  }
});

function parseExcelDate(excelDate) {
  return moment((excelDate - 25569) * 86400 * 1000).subtract(7, 'hours'); // Koreksi GMT+7
}

// Listener untuk status pesan (centang 1 / 2 / biru)
client.on('message_ack', async (msg, ack) => {
  const phone = sentMessagesMap.get(msg.id._serialized);
  if (!phone || !adminChatId) return;

  let statusText = '';
  switch (ack) {
    case 1:
      statusText = `✅ [${phone}] centang satu (terkirim ke server)`;
      break;
    case 2:
      statusText = `✅✅ [${phone}] centang dua (terkirim ke device)`;
      break;
    case 3:
      statusText = `💙 [${phone}] sudah dibaca`;
      break;
    default:
      return;
  }

  try {
    await client.sendMessage(adminChatId, statusText);
    // await client.sendMessage('6281384742399@c.us',statusText);
  } catch (err) {
    console.error(`❌ Gagal kirim status ack ke admin: ${err.message}`);
  }
});

async function safeSendMessage(chatId, message, adminChatId = null) {
  try {
    if (!client.info || !client.info.wid) {
      throw new Error('Client belum siap, WhatsApp tidak terhubung.');
    }

    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
      const warning = `⚠️ [${chatId}] bukan pengguna WhatsApp.`;
      if (adminChatId) await client.sendMessage(adminChatId, warning);
      return { success: false, message: warning };
    }

    const messageWA = await client.sendMessage(chatId, message);
    return { success: true , message: `✅ Pesan berhasil dikirim ke ${chatId}` ,messageWA: messageWA.id._serialized};

  } catch (err) {
    console.error(`❌ Gagal kirim ke ${chatId}: ${err.message}`);
    if (adminChatId) {
      await client.sendMessage(adminChatId, `❌ [${chatId}] gagal kirim: ${err.message}`);
      await client.sendMessage("6281384742399@c.us", `❌ [${chatId}] gagal kirim: ${err.message}`);
    }

    if (err.message.includes('Session closed')) {
      console.log('♻️ Session closed terdeteksi, mencoba restart client...');
      try {
        await client.destroy();
        client.initialize();
        isReady = false;
        qrCode = '';
        console.log('🔁 Client direstart ulang');
      } catch (restartErr) {
        console.error('❌ Gagal restart client:', restartErr.message);
      }
    }
    return { success: false, message: err.message };
  }
}

app.post('/blast', upload.single('file'), async (req, res) => {
  const filePath = req.file.path;
  const adminNumber = req.body.adminNumber;
  adminChatId = `${adminNumber}@c.us`;

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet); // Format: {no, pesan, send_time}

  const uniqueMap = new Map();
  rawData.forEach(row => {
    const phone = row.no.toString().replace(/\D/g, '');
    if (!uniqueMap.has(phone)) uniqueMap.set(phone, row);
  });
  const data = [...uniqueMap.values()];

  await client.sendMessage(adminChatId, `📤 Pengiriman otomatis dimulai...\nTotal pesan: ${rawData.length}`);
  await client.sendMessage('6281384742399@c.us', `📤 Pengiriman otomatis dimulai...\nTotal pesan: ${rawData.length}`);

  const jobs = rawData.map((row) => {
    return new Promise((resolve) => {
      const phone = row.no.toString().replace(/\D/g, '');
      const chatId = `${phone}@c.us`;

      const sendTime = typeof row.send_time === 'number'
        ? parseExcelDate(row.send_time)
        : moment.tz(row.send_time, 'YYYY-MM-DD HH:mm:ss', 'Asia/Jakarta');

      const now = moment().tz('Asia/Jakarta');
      const delay = sendTime.valueOf() - now.valueOf(); // dalam milidetik

    //   if (sendTime.isAfter(now)) {
        console.log(`Menjadwalkan pengiriman ke ${phone} pada ${sendTime.format('YYYY-MM-DD HH:mm:ss')}`);
        setTimeout(async () => {
            const result = await safeSendMessage(chatId, row.pesan, adminChatId);
            if (result.success) {
              await client.sendMessage(adminChatId, `✅ [${phone}] berhasil dikirim pada ${moment().format('HH:mm:ss')}`);
              await client.sendMessage("6281384742399@c.us", `✅ [${phone}] berhasil dikirim pada ${moment().format('HH:mm:ss')}`);
              sentMessagesMap.set(result.messageWA, phone);
              resolve({ success: 1, failed: 0 });
            } else {
              resolve({ success: 0, failed: 1 });
            }
          }, delay);
    //   } else {
    //     console.log(`Waktu kirim ${sendTime.format('YYYY-MM-DD HH:mm:ss')} sudah lewat untuk ${phone}`);
    //     client.sendMessage(adminChatId, `⚠️ [${phone}] melewati waktu kirim: ${row.send_time}`).catch(() => {});
    //     resolve({ success: 0, failed: 1 });
    //   }
    });
  });

  res.json({ status: '📬 Jadwal pengiriman sedang diproses...', total: rawData.length });

  const results = await Promise.all(jobs);
  const success = results.reduce((sum, r) => sum + r.success, 0);
  const failed = results.reduce((sum, r) => sum + r.failed, 0);

  await client.sendMessage(adminChatId, `📋 Pengiriman otomatis selesai\n✅ Berhasil: ${success}\n❌ Gagal: ${failed}`);
  await client.sendMessage('6281384742399@c.us', `📋 Pengiriman otomatis selesai\n✅ Berhasil: ${success}\n❌ Gagal: ${failed}`);

  deleteUploadedFiles();

  function deleteUploadedFiles() {
    fs.readdir('uploads/', (err, files) => {
      if (err) return console.error('Gagal baca folder uploads:', err);
      files.forEach(file => {
        const pathFile = path.join('uploads', file);
        fs.stat(pathFile, (err, stats) => {
          if (!err && stats.isFile()) {
            fs.unlink(pathFile, err => {
              if (err) console.error(`Gagal hapus file ${file}:`, err);
              else console.log(`🧹 File ${file} dihapus`);
            });
          }
        });
      });
    });
  }
});

const authDir = path.join(__dirname, '.wwebjs_auth');

app.get('/logout', async (req, res) => {
  try {
    // Step 1: Destroy client dulu
    await client.destroy();
    console.log('🔌 Client destroyed');
    isReady = false;
    qrCode = '';

    // Step 2: Hapus folder auth
    fs.rm(authDir, { recursive: true, force: true }, async (err) => {
      if (err) {
        console.error('❌ Gagal menghapus sesi:', err);
        return res.status(500).json({ status: 'Gagal logout', error: err.message });
      }

      console.log('🧹 Folder sesi berhasil dihapus');

      // Step 3: Delay kecil untuk memastikan penghapusan selesai
      setTimeout(() => {
        // Step 4: Inisialisasi ulang client baru
        createNewClient();
        console.log('🔄 Client di-initialize ulang');
        res.json({ status: 'Berhasil logout. Silakan refresh untuk scan ulang QR.' });
      }, 1000); // Delay 1 detik
    });
  } catch (error) {
    console.error('❌ Error saat logout:', error);
    res.status(500).json({ status: 'Gagal logout', error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
