 // server.js o index.js
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ✅ Inicializar Firebase con validación
try {
  if (!admin.apps.length) {
    const serviceAccount = {
      projectId: process.env.PROJECT_ID,
      clientEmail: process.env.CLIENT_EMAIL,
      privateKey: process.env.PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
      throw new Error('Variables de entorno de Firebase faltantes o incorrectas');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log('✅ Firebase Admin inicializado');
  }
} catch (error) {
  console.error('❌ Error al inicializar Firebase Admin:', error);
}

const db = admin.firestore();

// 🔁 Función para obtener datos del usuario
async function obtenerInfoUsuario(userId) {
  try {
    const userDoc = await db.collection('usuarios').doc(userId).get();
    if (!userDoc.exists) return null;
    const data = userDoc.data();
    return {
      nombre: data.nombre || 'Usuario',
      avatar: data.avatar || null
    };
  } catch (error) {
    console.error('Error obteniendo info usuario:', error);
    return null;
  }
}

// 📥 POST: Enviar respuesta
app.post('/api/respuestas', async (req, res) => {
  try {
    const { alertaId, remitenteUid, mensaje, destinatarioPhone, respuestaCitadaId } = req.body;

    if (!alertaId || !remitenteUid || !mensaje || !destinatarioPhone) {
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
    }

    const remitenteInfo = await obtenerInfoUsuario(remitenteUid);
    if (!remitenteInfo) return res.status(404).json({ success: false, message: 'Remitente no encontrado' });

    const telefonoLimpio = destinatarioPhone.replace(/\D/g, '').replace(/^56/, '');

    const destinatarioQuery = await db.collection('usuarios')
      .where('telefono', '==', telefonoLimpio)
      .limit(1)
      .get();

    if (destinatarioQuery.empty) {
      return res.status(404).json({ success: false, message: 'Destinatario no encontrado' });
    }

    const destinatarioDoc = destinatarioQuery.docs[0];

    const respuestaId = uuidv4();
    const respuestaData = {
      id: respuestaId,
      alertaId,
      remitenteUid,
      remitenteNombre: remitenteInfo.nombre,
      remitenteAvatar: remitenteInfo.avatar,
      destinatarioUid: destinatarioDoc.id,
      destinatarioPhone: telefonoLimpio,
      mensaje: mensaje.trim(),
      respuestaCitadaId: respuestaCitadaId || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('respuestas').doc(respuestaId).set(respuestaData);

    return res.json({
      success: true,
      respuesta: { ...respuestaData, timestamp: new Date().toISOString() }
    });

  } catch (error) {
    console.error('Error en POST /api/respuestas:', error);
    return res.status(500).json({ success: false, message: error.message || 'Error interno' });
  }
});

// 📤 GET: Obtener respuestas
app.get('/api/respuestas/:alertaId', async (req, res) => {
  try {
    const { alertaId } = req.params;
    const { userId } = req.query;

    if (!alertaId || !userId) {
      return res.status(400).json({ success: false, message: 'alertaId y userId son requeridos' });
    }

    const respuestasSnap = await db.collection('respuestas')
      .where('alertaId', '==', alertaId)
      .orderBy('timestamp', 'asc')
      .get();

    const respuestas = respuestasSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        remitenteNombre: data.remitenteNombre || 'Usuario',
        remitenteAvatar: data.remitenteAvatar,
        mensaje: data.mensaje || '',
        timestamp: data.timestamp?.toDate() || new Date(),
        esMia: data.remitenteUid === userId,
        respuestaCitadaId: data.respuestaCitadaId || null
      };
    });

    return res.json({ success: true, respuestas });
  } catch (error) {
    console.error('Error en GET /api/respuestas:', error);
    return res.status(500).json({ success: false, message: error.message || 'Error interno' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en puerto ${PORT}`);
});
