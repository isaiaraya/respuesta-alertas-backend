 const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Función para obtener info del usuario
async function obtenerInfoUsuario(userId) {
  try {
    const userDoc = await db.collection('usuarios').doc(userId).get();
    if (!userDoc.exists) {
      console.warn(`Usuario no encontrado: ${userId}`);
      return null;
    }

    const userData = userDoc.data();
    return {
      nombre: userData.nombre || 'Usuario',
      avatar: userData.avatar || null
    };
  } catch (error) {
    console.error('Error obteniendo info usuario:', error);
    return null;
  }
}

// 🟢 POST: Enviar respuesta
app.post('/api/respuestas', async (req, res) => {
  try {
    const { alertaId, remitenteUid, mensaje, destinatarioPhone, respuestaCitadaId } = req.body;

    const camposRequeridos = { alertaId, remitenteUid, mensaje, destinatarioPhone };
    const camposFaltantes = Object.entries(camposRequeridos)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan campos requeridos: ${camposFaltantes.join(', ')}`
      });
    }

    const remitenteInfo = await obtenerInfoUsuario(remitenteUid);
    if (!remitenteInfo) {
      return res.status(404).json({
        success: false,
        message: 'Remitente no encontrado'
      });
    }

    const telefonoLimpio = destinatarioPhone.replace(/\D/g, '').replace(/^56/, '');

    const destinatarioQuery = await db.collection('usuarios')
      .where('telefono', '==', telefonoLimpio)
      .limit(1)
      .get();

    if (destinatarioQuery.empty) {
      return res.status(404).json({
        success: false,
        message: `Destinatario con teléfono ${telefonoLimpio} no encontrado`
      });
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
      respuestaCitadaId: respuestaCitadaId || null, // ✅ agregado
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    const batch = db.batch();
    const respuestaRef = db.collection('respuestas').doc(respuestaId);
    batch.set(respuestaRef, respuestaData);

    await batch.commit();

    return res.json({
      success: true,
      respuesta: {
        ...respuestaData,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error en POST /api/respuestas:', error);
    return res.status(500).json({
      success: false,
      message: `Error interno: ${error.message || 'Por favor revisa los logs del servidor'}`
    });
  }
});

// 🔵 GET: Obtener respuestas por alertaId
app.get('/api/respuestas/:alertaId', async (req, res) => {
  try {
    const { alertaId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere el parámetro userId'
      });
    }

    if (!alertaId || typeof alertaId !== 'string' || alertaId.length !== 36) {
      return res.status(400).json({
        success: false,
        message: 'ID de alerta inválido'
      });
    }

    const respuestasSnap = await db.collection('respuestas')
      .where('alertaId', '==', alertaId)
      .orderBy('timestamp', 'asc')
      .get();

    const respuestas = [];
    respuestasSnap.forEach(doc => {
      try {
        const data = doc.data();
        respuestas.push({
          id: doc.id,
          remitenteNombre: data.remitenteNombre || 'Usuario',
          remitenteAvatar: data.remitenteAvatar,
          mensaje: data.mensaje || '',
          timestamp: data.timestamp?.toDate().toISOString() || new Date().toISOString(),
          esMia: data.remitenteUid === userId,
          respuestaCitadaId: data.respuestaCitadaId || null // ✅ incluido en la respuesta al cliente
        });
      } catch (error) {
        console.warn(`Error procesando documento ${doc.id}:`, error);
      }
    });

    return res.json({
      success: true,
      respuestas
    });

  } catch (error) {
    console.error('Error en GET /api/respuestas:', error);
    return res.status(500).json({
      success: false,
      message: `Error al obtener respuestas: ${error.message || 'Consulta los logs para más detalles'}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor de respuestas ejecutándose en http://localhost:${PORT}`);
});

