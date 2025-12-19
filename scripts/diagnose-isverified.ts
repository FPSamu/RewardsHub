/**
 * Script de diagnóstico para el problema de isVerified
 * 
 * Este script te ayudará a identificar por qué isVerified cambia a true automáticamente
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { UserModel } from '../src/models/user.model';

dotenv.config();

const diagnoseIsVerifiedIssue = async () => {
    console.log('\n🔍 Diagnóstico del problema de isVerified\n');

    try {
        // Conectar a MongoDB
        await mongoose.connect(process.env.MONGO_URI || '');
        console.log('✅ Conectado a MongoDB\n');

        // 1. Verificar el esquema del modelo
        console.log('📋 Esquema del modelo User:');
        const schema = UserModel.schema.obj;
        console.log('   isVerified:', schema.isVerified);
        console.log('');

        // 2. Buscar usuarios con isVerified = true sin verificationToken
        console.log('🔎 Buscando usuarios verificados sin haber usado el token...');
        const suspiciousUsers = await UserModel.find({
            isVerified: true,
            verificationToken: { $exists: true, $ne: null }
        }).exec();

        if (suspiciousUsers.length > 0) {
            console.log(`⚠️  Encontrados ${suspiciousUsers.length} usuarios sospechosos:`);
            suspiciousUsers.forEach(user => {
                console.log(`   - ${user.email} (ID: ${user._id})`);
                console.log(`     isVerified: ${user.isVerified}`);
                console.log(`     verificationToken: ${user.verificationToken ? 'Presente' : 'No presente'}`);
                console.log(`     createdAt: ${user.createdAt}`);
                console.log('');
            });
        } else {
            console.log('✅ No se encontraron usuarios sospechosos\n');
        }

        // 3. Verificar todos los usuarios
        console.log('📊 Estadísticas de usuarios:');
        const totalUsers = await UserModel.countDocuments();
        const verifiedUsers = await UserModel.countDocuments({ isVerified: true });
        const unverifiedUsers = await UserModel.countDocuments({ isVerified: false });

        console.log(`   Total de usuarios: ${totalUsers}`);
        console.log(`   Verificados: ${verifiedUsers}`);
        console.log(`   No verificados: ${unverifiedUsers}`);
        console.log('');

        // 4. Listar los últimos 5 usuarios creados
        console.log('👥 Últimos 5 usuarios creados:');
        const recentUsers = await UserModel.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select('email username isVerified verificationToken createdAt')
            .exec();

        recentUsers.forEach((user, index) => {
            console.log(`   ${index + 1}. ${user.email}`);
            console.log(`      Username: ${user.username}`);
            console.log(`      isVerified: ${user.isVerified}`);
            console.log(`      verificationToken: ${user.verificationToken ? 'Presente' : 'No presente'}`);
            console.log(`      createdAt: ${user.createdAt}`);
            console.log('');
        });

        // 5. Verificar si hay algún middleware o hook
        console.log('🔧 Middlewares de Mongoose:');
        const hooks = UserModel.schema.s.hooks;
        console.log('   Pre hooks:', Object.keys(hooks._pres || {}).length > 0 ? Object.keys(hooks._pres) : 'Ninguno');
        console.log('   Post hooks:', Object.keys(hooks._posts || {}).length > 0 ? Object.keys(hooks._posts) : 'Ninguno');
        console.log('');

        // 6. Crear un usuario de prueba y verificar su estado
        console.log('🧪 Creando usuario de prueba...');
        const testEmail = `test-${Date.now()}@example.com`;

        const testUser = await UserModel.create({
            username: 'Test User',
            email: testEmail,
            passHash: 'test-hash'
        });

        console.log(`   Usuario creado: ${testUser.email}`);
        console.log(`   isVerified inicial: ${testUser.isVerified}`);
        console.log(`   ID: ${testUser._id}`);
        console.log('');

        // Esperar 2 segundos y verificar de nuevo
        console.log('⏳ Esperando 2 segundos...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const testUserAfter = await UserModel.findById(testUser._id).exec();
        console.log(`   isVerified después de 2 segundos: ${testUserAfter?.isVerified}`);

        if (testUser.isVerified !== testUserAfter?.isVerified) {
            console.log('   ⚠️  ¡EL VALOR CAMBIÓ! Esto indica un problema.');
        } else {
            console.log('   ✅ El valor no cambió.');
        }
        console.log('');

        // Limpiar usuario de prueba
        await UserModel.findByIdAndDelete(testUser._id);
        console.log('   🗑️  Usuario de prueba eliminado\n');

        // 7. Verificar la configuración de la base de datos
        console.log('⚙️  Configuración de MongoDB:');
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const userCollection = collections.find(c => c.name === (process.env.USER_COLLECTION || 'users'));

        if (userCollection) {
            console.log(`   Colección: ${userCollection.name}`);
            console.log(`   Tipo: ${userCollection.type}`);
        }
        console.log('');

        console.log('✅ Diagnóstico completado\n');

    } catch (error) {
        console.error('❌ Error durante el diagnóstico:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Desconectado de MongoDB\n');
    }
};

// Ejecutar diagnóstico
diagnoseIsVerifiedIssue().catch(console.error);
